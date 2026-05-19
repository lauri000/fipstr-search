import {beforeEach, describe, expect, it} from "vitest"

import {clearDirectoryState, db, loadDirectoryState, saveDirectoryState, SYNC_STATE_META_KEY} from "./db"
import type {AnnouncementRecord, SyncState} from "./types"

function announcement(overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord {
  const authorPubkey = overrides.authorPubkey ?? "a".repeat(64)
  const targetNpub = overrides.targetNpub ?? "npub1cachedrelay000000000000000000000000000000000000000000000"

  return {
    id: overrides.id ?? `${authorPubkey}:${targetNpub}`,
    source: overrides.source ?? "announcement",
    authorPubkey,
    authorNpub: overrides.authorNpub ?? "npub1announcer0000000000000000000000000000000000000000000000000",
    targetNpub,
    eventId: overrides.eventId ?? "1".repeat(64),
    createdAt: overrides.createdAt ?? 10,
    discriminator: overrides.discriminator ?? "node-a",
    alias: overrides.alias ?? "Cached Relay",
    content: overrides.content ?? "",
    summary: overrides.summary ?? "Services: http:80",
    transports: overrides.transports ?? [],
    services: overrides.services ?? [{name: "http", port: "80"}],
    tags:
      overrides.tags ??
      [
        ["d", "node-a"],
        ["npub", targetNpub],
        ["alias", "Cached Relay"],
        ["service", "http", "80"],
      ],
    url: overrides.url ?? `http://${targetNpub}.fips/`,
  }
}

describe("directory persistence", () => {
  beforeEach(async () => {
    await clearDirectoryState()
  })

  it("persists only announcements and sync metadata as authoritative directory state", async () => {
    const syncState: SyncState = {lastSyncAt: 123}

    await saveDirectoryState([announcement()], syncState)

    const savedState = await loadDirectoryState()
    const metaKeys = (await db.meta.toArray()).map((record) => record.key)

    expect(savedState.announcements).toHaveLength(1)
    expect(savedState.syncState).toEqual(syncState)
    expect("nodes" in savedState).toBe(false)
    expect("searchIndex" in savedState).toBe(false)
    expect(metaKeys).toContain(SYNC_STATE_META_KEY)
    expect(metaKeys).not.toContain("search-index")
  })
})
