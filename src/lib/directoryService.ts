import {SimplePool, verifyEvent, type Event, type Filter} from "nostr-tools"

import {loadDirectoryState, saveDirectoryState, saveRelaySettings} from "./db"
import {DEFAULT_RELAYS} from "./defaultRelays"
import {applyAnnouncementEvent, buildDirectoryNodes, takeLatestAnnouncements} from "./normalize"
import {buildSearchIndex, loadSearchIndex, searchDirectory, serializeSearchIndex} from "./search"
import {
  DISCOVERY_KIND,
  type AnnouncementRecord,
  type DirectoryNodeRecord,
  type DirectoryRuntime,
  type DirectorySearchResult,
  type DirectorySnapshot,
  type PublishSigner,
  type SyncState,
} from "./types"

const SYNC_MAX_WAIT_MS = 4_500
const PERSIST_DEBOUNCE_MS = 150

type SubCloser = {
  close: (reason?: string) => void
}

type RelayPool = Pick<SimplePool, "destroy" | "publish" | "querySync" | "subscribe">

const DISCOVERY_FILTER: Filter = {
  kinds: [DISCOVERY_KIND],
}

function normalizeRelays(relays: string[]) {
  return Array.from(
    new Set(
      relays
        .map((relay) => relay.trim())
        .filter(Boolean),
    ),
  )
}

function formatNodeCount(count: number) {
  return `${count} node${count === 1 ? "" : "s"}`
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return "Unknown relay error"
}

function cloneTags(tags: string[][]) {
  return tags.map((tag) => [...tag])
}

function createPool() {
  return new SimplePool({
    enablePing: true,
    enableReconnect: true,
  })
}

export class DirectoryService implements DirectoryRuntime {
  private relays: string[]
  private readonly pool: RelayPool
  private readonly listeners = new Set<() => void>()

  private announcements = new Map<string, AnnouncementRecord>()
  private nodes = new Map<string, DirectoryNodeRecord>()
  private searchIndex = buildSearchIndex([])

  private discoverySubscription?: SubCloser
  private persistTimer?: ReturnType<typeof setTimeout>
  private pendingLastSyncAt?: number
  private started = false

  private state: DirectorySnapshot

  constructor(relays = DEFAULT_RELAYS, pool: RelayPool = createPool()) {
    this.relays = normalizeRelays(relays)
    this.pool = pool

    this.state = {
      status: "Loading cached directory...",
      hydrated: false,
      syncing: true,
      nodesCount: 0,
      relayCount: this.relays.length,
      relays: [...this.relays],
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  search = (query: string, viewerPubkey?: string): DirectorySearchResult[] => {
    return searchDirectory(this.searchIndex, query).map((result) => ({
      ...result,
      announcedByViewer: viewerPubkey ? this.nodes.get(result.npub)?.announcerPubkeys.includes(viewerPubkey) ?? false : false,
    }))
  }

  start = () => {
    if (this.started) {
      return this.stop
    }

    this.started = true
    void this.bootstrap()

    return this.stop
  }

  reannounce = async (targetNpub: string, signer: PublishSigner) => {
    const node = this.nodes.get(targetNpub)

    if (!node) {
      throw new Error("This node is not currently available for re-announcement.")
    }

    const signedEvent = await signer.signEvent({
      kind: DISCOVERY_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: cloneTags(node.tags),
      content: node.content,
    })

    if (signedEvent.kind !== DISCOVERY_KIND) {
      throw new Error("Signer returned the wrong event kind.")
    }

    if (!verifyEvent(signedEvent)) {
      throw new Error("Signer returned an invalid event signature.")
    }

    if (signedEvent.pubkey !== signer.pubkey) {
      throw new Error("Signer returned a mismatched public key.")
    }

    const publishResults = await Promise.allSettled(this.pool.publish(this.relays, signedEvent, {maxWait: SYNC_MAX_WAIT_MS}))
    const successCount = publishResults.filter((result) => result.status === "fulfilled").length

    if (successCount === 0) {
      const firstFailure = publishResults.find((result) => result.status === "rejected")
      throw new Error(firstFailure?.status === "rejected" ? errorMessage(firstFailure.reason) : "Failed to publish announcement.")
    }

    await this.handleIncomingEvent(signedEvent)
  }

  updateRelays = async (relays: string[]) => {
    const normalized = normalizeRelays(relays)

    if (normalized.length === 0) {
      throw new Error("Add at least one relay URL.")
    }

    const unchanged =
      normalized.length === this.relays.length &&
      normalized.every((relay, index) => relay === this.relays[index])

    await saveRelaySettings(normalized)

    if (unchanged) {
      return
    }

    this.relays = normalized
    this.setState({
      relayCount: this.relays.length,
      relays: [...this.relays],
    })

    if (!this.started) {
      return
    }

    await this.refreshRelaySubscriptions()
  }

  private stop = () => {
    if (!this.started) {
      return
    }

    this.started = false

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }

    this.discoverySubscription?.close("app stopped")
    this.discoverySubscription = undefined
    this.pool.destroy()
  }

  private emit() {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private setState(patch: Partial<DirectorySnapshot>) {
    this.state = {...this.state, ...patch}
    this.emit()
  }

  private getLiveStatusMessage() {
    if (this.nodes.size === 0) {
      return `Watching ${this.relays.length} relays for discovery announcements`
    }

    return `Watching ${this.relays.length} relays, indexed ${formatNodeCount(this.nodes.size)}`
  }

  private async bootstrap() {
    await this.hydrateFromCache()

    if (!this.started) {
      return
    }

    await this.refreshRelaySubscriptions()
  }

  private async hydrateFromCache() {
    const {announcements, nodes, searchIndex, syncState, relays} = await loadDirectoryState()

    this.relays = relays && relays.length > 0 ? normalizeRelays(relays) : normalizeRelays(DEFAULT_RELAYS)

    this.announcements = new Map(announcements.map((announcement) => [announcement.id, announcement]))
    this.nodes = new Map(nodes.map((node) => [node.npub, node]))

    if (this.nodes.size === 0 && this.announcements.size > 0) {
      this.rebuildNodesAndIndex()
    } else {
      const cachedIndex = loadSearchIndex(searchIndex)
      this.searchIndex =
        searchIndex && searchIndex.docCount === this.nodes.size
          ? cachedIndex
          : buildSearchIndex(this.nodes.values())
    }

    this.setState({
      hydrated: true,
      syncing: true,
      nodesCount: this.nodes.size,
      relayCount: this.relays.length,
      relays: [...this.relays],
      lastSyncAt: syncState?.lastSyncAt,
      error: undefined,
      status:
        this.nodes.size > 0 ? `Loaded ${formatNodeCount(this.nodes.size)} from cache` : "No cached node announcements yet",
    })
  }

  private async refreshRelaySubscriptions() {
    try {
      await this.performInitialSync()
    } catch (error) {
      this.setState({
        syncing: false,
        error: errorMessage(error),
        relayCount: this.relays.length,
        relays: [...this.relays],
        status:
          this.nodes.size > 0
            ? `Using ${formatNodeCount(this.nodes.size)} from cache while relay sync failed`
            : "Relay sync failed. Waiting for live updates",
      })
      return
    }

    if (!this.started) {
      return
    }

    this.startLiveSubscriptions()
    this.setState({
      syncing: false,
      relayCount: this.relays.length,
      relays: [...this.relays],
      status: this.getLiveStatusMessage(),
    })
  }

  private async performInitialSync() {
    this.setState({
      syncing: true,
      error: undefined,
      relayCount: this.relays.length,
      relays: [...this.relays],
      status: "Syncing discovery announcements...",
    })

    const events = await this.queryEvents(DISCOVERY_FILTER)

    this.announcements = takeLatestAnnouncements(events)
    this.rebuildNodesAndIndex()

    const syncedAt = Date.now()
    this.schedulePersist(syncedAt)

    this.setState({
      syncing: false,
      nodesCount: this.nodes.size,
      relayCount: this.relays.length,
      relays: [...this.relays],
      lastSyncAt: syncedAt,
      status: this.nodes.size > 0 ? `Indexed ${formatNodeCount(this.nodes.size)}` : "No discovery announcements found yet",
    })
  }

  private async queryEvents(filter: Filter) {
    return this.pool.querySync(this.relays, filter, {maxWait: SYNC_MAX_WAIT_MS})
  }

  private startLiveSubscriptions() {
    this.discoverySubscription?.close("refresh discovery subscription")
    this.discoverySubscription = this.pool.subscribe(this.relays, DISCOVERY_FILTER, {
      label: "fips-discovery",
      onevent: (event) => {
        void this.handleIncomingEvent(event)
      },
    })
  }

  private async handleIncomingEvent(event: Event) {
    if (!this.started || event.kind !== DISCOVERY_KIND) {
      return
    }

    const nextAnnouncements = new Map(this.announcements)
    const changed = applyAnnouncementEvent(nextAnnouncements, event)

    if (!changed) {
      return
    }

    this.announcements = nextAnnouncements
    this.rebuildNodesAndIndex()

    const syncedAt = Date.now()
    this.schedulePersist(syncedAt)
    this.setState({
      nodesCount: this.nodes.size,
      relayCount: this.relays.length,
      relays: [...this.relays],
      lastSyncAt: syncedAt,
      error: undefined,
      status: this.getLiveStatusMessage(),
    })
  }

  private rebuildNodesAndIndex() {
    this.nodes = buildDirectoryNodes(this.announcements.values())
    this.searchIndex = buildSearchIndex(this.nodes.values())
  }

  private schedulePersist(lastSyncAt: number) {
    this.pendingLastSyncAt = lastSyncAt

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      const persistedAt = this.pendingLastSyncAt ?? Date.now()
      this.pendingLastSyncAt = undefined
      void this.persistCurrentState(persistedAt)
    }, PERSIST_DEBOUNCE_MS)
  }

  private async persistCurrentState(lastSyncAt: number) {
    const syncState: SyncState = {
      lastSyncAt,
    }

    await saveDirectoryState(
      Array.from(this.announcements.values()),
      Array.from(this.nodes.values()),
      serializeSearchIndex(this.searchIndex, this.nodes.size),
      syncState,
    )
  }
}

export const directoryService = new DirectoryService()
