import Dexie, {type Table} from "dexie"

import type {AnnouncementRecord, MetaRecord, SyncState} from "./types"

const SEARCH_INDEX_META_KEY = "search-index"
export const SYNC_STATE_META_KEY = "sync-state"
export const RELAYS_META_KEY = "relays"

class DirectoryDatabase extends Dexie {
  announcements!: Table<AnnouncementRecord, string>
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

    this.version(3).stores({
      announcements: "&id, targetNpub, authorPubkey, createdAt",
      nodes: null,
      meta: "&key",
    })
  }
}

export const db = new DirectoryDatabase()

export async function loadDirectoryState() {
  const [announcements, syncStateRecord, relaysRecord] = await Promise.all([
    db.announcements.toArray(),
    db.meta.get(SYNC_STATE_META_KEY),
    db.meta.get(RELAYS_META_KEY),
  ])

  return {
    announcements,
    syncState: syncStateRecord?.value as SyncState | undefined,
    relays: relaysRecord?.value as string[] | undefined,
  }
}

export async function saveDirectoryState(
  announcements: AnnouncementRecord[],
  syncState: SyncState,
) {
  const updatedAt = Date.now()

  await db.transaction("rw", db.announcements, db.meta, async () => {
    await db.announcements.clear()

    if (announcements.length > 0) {
      await db.announcements.bulkPut(announcements)
    }

    await db.meta.delete(SEARCH_INDEX_META_KEY)
    await db.meta.put({key: SYNC_STATE_META_KEY, value: syncState, updatedAt})
  })
}

export async function clearDirectoryState() {
  await db.transaction("rw", db.announcements, db.meta, async () => {
    await db.announcements.clear()
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
