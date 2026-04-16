import {SimplePool, type Event, type Filter} from "nostr-tools"

import {loadDirectoryState, saveDirectoryState} from "./db"
import {DEFAULT_RELAYS} from "./defaultRelays"
import {applyProfileEvent, isEventNewer, takeLatestEvents} from "./normalize"
import {buildSearchIndex, loadSearchIndex, searchDirectory, serializeSearchIndex} from "./search"
import {
  DISCOVERY_KIND,
  type AuthorState,
  type DirectoryProfileRecord,
  type DirectoryRuntime,
  type DirectorySearchResult,
  type DirectorySnapshot,
  type SyncState,
} from "./types"

const SYNC_MAX_WAIT_MS = 4_500
const PERSIST_DEBOUNCE_MS = 150

type SubCloser = {
  close: (reason?: string) => void
}

const DISCOVERY_FILTER: Filter = {
  kinds: [DISCOVERY_KIND],
}

function formatProfileCount(count: number) {
  return `${count} node announcement${count === 1 ? "" : "s"}`
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return "Unknown relay error"
}

export class DirectoryService implements DirectoryRuntime {
  private readonly relays: string[]
  private readonly pool: SimplePool
  private readonly listeners = new Set<() => void>()

  private profiles = new Map<string, DirectoryProfileRecord>()
  private authorStates = new Map<string, AuthorState>()
  private searchIndex = buildSearchIndex([])

  private discoverySubscription?: SubCloser
  private persistTimer?: ReturnType<typeof setTimeout>
  private pendingLastSyncAt?: number
  private started = false

  private state: DirectorySnapshot

  constructor(relays = DEFAULT_RELAYS) {
    this.relays = relays
    this.pool = new SimplePool({
      enablePing: true,
      enableReconnect: true,
    })

    this.state = {
      status: "Loading cached directory...",
      hydrated: false,
      syncing: true,
      profilesCount: 0,
      relayCount: this.relays.length,
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  search = (query: string): DirectorySearchResult[] => {
    return searchDirectory(this.searchIndex, query).map(({score, terms, queryTerms, match, ...storedFields}) => ({
      ...storedFields,
      score,
    })) as DirectorySearchResult[]
  }

  start = () => {
    if (this.started) {
      return this.stop
    }

    this.started = true
    void this.bootstrap()

    return this.stop
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
    if (this.profiles.size === 0) {
      return `Watching ${this.relays.length} relays for discovery announcements`
    }

    return `Watching ${this.relays.length} relays, indexed ${formatProfileCount(this.profiles.size)}`
  }

  private async bootstrap() {
    await this.hydrateFromCache()

    if (!this.started) {
      return
    }

    try {
      await this.performInitialSync()
    } catch (error) {
      this.setState({
        syncing: false,
        error: errorMessage(error),
        status:
          this.profiles.size > 0
            ? `Using ${formatProfileCount(this.profiles.size)} from cache while relay sync failed`
            : "Relay sync failed. Waiting for live updates",
      })
    }

    if (!this.started) {
      return
    }

    this.startLiveSubscriptions()
    this.setState({
      syncing: false,
      status: this.getLiveStatusMessage(),
    })
  }

  private async hydrateFromCache() {
    const {profiles, searchIndex, syncState} = await loadDirectoryState()

    this.profiles = new Map(profiles.map((profile) => [profile.pubkey, profile]))
    this.authorStates = new Map(Object.entries(syncState?.authorStates ?? {}))

    for (const profile of profiles) {
      const current = this.authorStates.get(profile.pubkey)

      if (
        !current ||
        profile.createdAt > current.createdAt ||
        (profile.createdAt === current.createdAt && profile.eventId.localeCompare(current.eventId) < 0)
      ) {
        this.authorStates.set(profile.pubkey, {
          eventId: profile.eventId,
          createdAt: profile.createdAt,
          active: true,
        })
      }
    }

    const cachedIndex = loadSearchIndex(searchIndex)
    this.searchIndex =
      searchIndex && searchIndex.docCount === profiles.length
        ? cachedIndex
        : buildSearchIndex(this.profiles.values())

    this.setState({
      hydrated: true,
      syncing: true,
      profilesCount: profiles.length,
      lastSyncAt: syncState?.lastSyncAt,
      error: undefined,
      status:
        profiles.length > 0 ? `Loaded ${formatProfileCount(profiles.length)} from cache` : "No cached node announcements yet",
    })
  }

  private async performInitialSync() {
    this.setState({
      syncing: true,
      error: undefined,
      status: "Syncing discovery announcements...",
    })

    const events = await this.queryEvents(DISCOVERY_FILTER)
    const latestByAuthor = takeLatestEvents(events)
    const nextProfiles = new Map<string, DirectoryProfileRecord>()
    const nextAuthorStates = new Map<string, AuthorState>()

    for (const event of latestByAuthor.values()) {
      applyProfileEvent(nextProfiles, nextAuthorStates, event)
    }

    this.profiles = nextProfiles
    this.authorStates = nextAuthorStates

    this.rebuildSearchIndex()
    const syncedAt = Date.now()
    this.schedulePersist(syncedAt)

    this.setState({
      syncing: false,
      profilesCount: this.profiles.size,
      lastSyncAt: syncedAt,
      status:
        this.profiles.size > 0 ? `Indexed ${formatProfileCount(this.profiles.size)}` : "No discovery announcements found yet",
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
        void this.handleLiveEvent(event)
      },
    })
  }

  private async handleLiveEvent(event: Event) {
    if (!this.started || event.kind !== DISCOVERY_KIND) {
      return
    }

    const wasActive = this.profiles.has(event.pubkey)
    const nextProfiles = new Map(this.profiles)
    const nextAuthorStates = new Map(this.authorStates)
    const changed = applyProfileEvent(nextProfiles, nextAuthorStates, event)
    const isActive = nextProfiles.has(event.pubkey)

    if (!changed && wasActive === isActive) {
      this.authorStates = nextAuthorStates
      return
    }

    this.profiles = nextProfiles
    this.authorStates = nextAuthorStates

    if (changed) {
      this.rebuildSearchIndex()
    }

    const syncedAt = Date.now()
    this.schedulePersist(syncedAt)
    this.setState({
      profilesCount: this.profiles.size,
      lastSyncAt: syncedAt,
      error: undefined,
      status: this.getLiveStatusMessage(),
    })
  }

  private rebuildSearchIndex() {
    this.searchIndex = buildSearchIndex(this.profiles.values())
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
      authorStates: Object.fromEntries(this.authorStates.entries()),
    }

    await saveDirectoryState(
      Array.from(this.profiles.values()),
      serializeSearchIndex(this.searchIndex, this.profiles.size),
      syncState,
    )
  }
}

export const directoryService = new DirectoryService()
