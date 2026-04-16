import Dexie, {type Table} from "dexie"

import type {
  DirectoryProfileRecord,
  MetaRecord,
  SearchIndexState,
  SyncState,
} from "./types"

export const SEARCH_INDEX_META_KEY = "search-index"
export const SYNC_STATE_META_KEY = "sync-state"

class DirectoryDatabase extends Dexie {
  profiles!: Table<DirectoryProfileRecord, string>
  meta!: Table<MetaRecord, string>

  constructor() {
    super("fips-node-search-discovery")

    this.version(1).stores({
      profiles: "&pubkey, createdAt, npub",
      meta: "&key",
    })
  }
}

export const db = new DirectoryDatabase()

export async function loadDirectoryState() {
  const [profiles, searchIndexRecord, syncStateRecord] = await Promise.all([
    db.profiles.toArray(),
    db.meta.get(SEARCH_INDEX_META_KEY),
    db.meta.get(SYNC_STATE_META_KEY),
  ])

  return {
    profiles,
    searchIndex: searchIndexRecord?.value as SearchIndexState | undefined,
    syncState: syncStateRecord?.value as SyncState | undefined,
  }
}

export async function saveDirectoryState(
  profiles: DirectoryProfileRecord[],
  searchIndex: SearchIndexState,
  syncState: SyncState,
) {
  const updatedAt = Date.now()

  await db.transaction("rw", db.profiles, db.meta, async () => {
    await db.profiles.clear()

    if (profiles.length > 0) {
      await db.profiles.bulkPut(profiles)
    }

    await db.meta.bulkPut([
      {key: SEARCH_INDEX_META_KEY, value: searchIndex, updatedAt},
      {key: SYNC_STATE_META_KEY, value: syncState, updatedAt},
    ])
  })
}

export async function clearDirectoryState() {
  await db.transaction("rw", db.profiles, db.meta, async () => {
    await db.profiles.clear()
    await db.meta.clear()
  })
}
