import Dexie, {type Table} from "dexie"

import type {
  AnnouncementRecord,
  DirectoryNodeRecord,
  MetaRecord,
  SearchIndexState,
  SyncState,
} from "./types"

export const SEARCH_INDEX_META_KEY = "search-index"
export const SYNC_STATE_META_KEY = "sync-state"
export const RELAYS_META_KEY = "relays"

class DirectoryDatabase extends Dexie {
  announcements!: Table<AnnouncementRecord, string>
  nodes!: Table<DirectoryNodeRecord, string>
  meta!: Table<MetaRecord, string>

  constructor() {
    super("fips-node-search-discovery")

    this.version(1).stores({
      profiles: "&pubkey, createdAt, npub",
      meta: "&key",
    })

    this.version(2).stores({
      announcements: "&id, targetNpub, authorPubkey, createdAt",
      nodes: "&npub, announcementCount, alias",
      meta: "&key",
    })
  }
}

export const db = new DirectoryDatabase()

export async function loadDirectoryState() {
  const [announcements, nodes, searchIndexRecord, syncStateRecord, relaysRecord] = await Promise.all([
    db.announcements.toArray(),
    db.nodes.toArray(),
    db.meta.get(SEARCH_INDEX_META_KEY),
    db.meta.get(SYNC_STATE_META_KEY),
    db.meta.get(RELAYS_META_KEY),
  ])

  return {
    announcements,
    nodes,
    searchIndex: searchIndexRecord?.value as SearchIndexState | undefined,
    syncState: syncStateRecord?.value as SyncState | undefined,
    relays: relaysRecord?.value as string[] | undefined,
  }
}

export async function saveDirectoryState(
  announcements: AnnouncementRecord[],
  nodes: DirectoryNodeRecord[],
  searchIndex: SearchIndexState,
  syncState: SyncState,
) {
  const updatedAt = Date.now()

  await db.transaction("rw", db.announcements, db.nodes, db.meta, async () => {
    await db.announcements.clear()
    await db.nodes.clear()

    if (announcements.length > 0) {
      await db.announcements.bulkPut(announcements)
    }

    if (nodes.length > 0) {
      await db.nodes.bulkPut(nodes)
    }

    await db.meta.bulkPut([
      {key: SEARCH_INDEX_META_KEY, value: searchIndex, updatedAt},
      {key: SYNC_STATE_META_KEY, value: syncState, updatedAt},
    ])
  })
}

export async function clearDirectoryState() {
  await db.transaction("rw", db.announcements, db.nodes, db.meta, async () => {
    await db.announcements.clear()
    await db.nodes.clear()
    await db.meta.clear()
  })
}

export async function loadRelaySettings() {
  const record = await db.meta.get(RELAYS_META_KEY)
  return record?.value as string[] | undefined
}

export async function saveRelaySettings(relays: string[]) {
  await db.meta.put({
    key: RELAYS_META_KEY,
    value: relays,
    updatedAt: Date.now(),
  })
}
