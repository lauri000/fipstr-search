import {beforeEach, describe, expect, it} from "vitest"

import {clearDirectoryState, loadDirectoryState, saveDirectoryState} from "./db"
import {buildSearchIndex, loadSearchIndex, searchDirectory, serializeSearchIndex} from "./search"
import type {AnnouncementRecord, DirectoryNodeRecord, SyncState} from "./types"

function announcement(overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord {
  const authorPubkey = overrides.authorPubkey ?? "a".repeat(64)
  const targetNpub = overrides.targetNpub ?? "npub1alpharelaysample0000000000000000000000000000000000000000000"

  return {
    id: overrides.id ?? `${authorPubkey}:${targetNpub}`,
    authorPubkey,
    authorNpub: overrides.authorNpub ?? "npub1announcer0000000000000000000000000000000000000000000000000",
    targetNpub,
    eventId: overrides.eventId ?? "1".repeat(64),
    createdAt: overrides.createdAt ?? 10,
    discriminator: overrides.discriminator ?? "node-a",
    alias: overrides.alias ?? "Alpha Relay",
    content: overrides.content ?? "",
    summary: overrides.summary ?? "Services: http:80 · Transports: udp 172.20.0.10:2121",
    transports: overrides.transports ?? [{protocol: "udp", addr: "172.20.0.10", port: "2121"}],
    services: overrides.services ?? [{name: "http", port: "80"}],
    tags:
      overrides.tags ??
      [
        ["d", "node-a"],
        ["npub", targetNpub],
        ["alias", "Alpha Relay"],
        ["transport", "udp", "172.20.0.10", "2121"],
        ["service", "http", "80"],
      ],
    url: overrides.url ?? `http://${targetNpub}.fips/`,
  }
}

function node(overrides: Partial<DirectoryNodeRecord> = {}): DirectoryNodeRecord {
  const npub = overrides.npub ?? "npub1alpharelaysample0000000000000000000000000000000000000000000"

  return {
    npub,
    alias: overrides.alias ?? "Alpha Relay",
    summary: overrides.summary ?? "Services: http:80 · Transports: udp 172.20.0.10:2121",
    transports: overrides.transports ?? [{protocol: "udp", addr: "172.20.0.10", port: "2121"}],
    services: overrides.services ?? [{name: "http", port: "80"}],
    tags:
      overrides.tags ??
      [
        ["d", "node-a"],
        ["npub", npub],
        ["alias", "Alpha Relay"],
        ["transport", "udp", "172.20.0.10", "2121"],
        ["service", "http", "80"],
      ],
    content: overrides.content ?? "",
    url: overrides.url ?? `http://${npub}.fips/`,
    announcementCount: overrides.announcementCount ?? 2,
    announcerPubkeys: overrides.announcerPubkeys ?? ["a".repeat(64), "b".repeat(64)],
    canonicalAnnouncementId: overrides.canonicalAnnouncementId ?? `${"a".repeat(64)}:${npub}`,
    canonicalEventId: overrides.canonicalEventId ?? "1".repeat(64),
    canonicalAuthorPubkey: overrides.canonicalAuthorPubkey ?? "a".repeat(64),
  }
}

describe("search index", () => {
  beforeEach(async () => {
    await clearDirectoryState()
  })

  it("matches alias, service, transport, summary text, and npub", () => {
    const alpha = node()
    const index = buildSearchIndex([alpha])

    expect(searchDirectory(index, "Alpha Relay")).toHaveLength(1)
    expect(searchDirectory(index, "http")).toHaveLength(1)
    expect(searchDirectory(index, "172.20.0.10")).toHaveLength(1)
    expect(searchDirectory(index, alpha.npub)).toHaveLength(1)
  })

  it("sorts grouped rows by announcement count before text score", () => {
    const lowScoreHighCount = node({
      npub: "npub1highcount00000000000000000000000000000000000000000000000",
      alias: "Ubrrr",
      announcementCount: 4,
      summary: "Services: ubrrr:80",
    })
    const highScoreLowCount = node({
      npub: "npub1lowcount000000000000000000000000000000000000000000000000",
      alias: "Ubrrr deluxe",
      announcementCount: 2,
      summary: "Services: ubrrr:80 · Transports: udp 172.20.0.50:2121",
    })

    const index = buildSearchIndex([highScoreLowCount, lowScoreHighCount])
    const results = searchDirectory(index, "ubrrr")

    expect(results[0]?.npub).toBe(lowScoreHighCount.npub)
    expect(results[1]?.npub).toBe(highScoreLowCount.npub)
  })

  it("round-trips a serialized MiniSearch index through IndexedDB", async () => {
    const alphaNode = node()
    const alphaAnnouncement = announcement({targetNpub: alphaNode.npub})
    const index = buildSearchIndex([alphaNode])
    const syncState: SyncState = {
      lastSyncAt: 123,
    }

    await saveDirectoryState([alphaAnnouncement], [alphaNode], serializeSearchIndex(index, 1), syncState)

    const savedState = await loadDirectoryState()
    const hydrated = loadSearchIndex(savedState.searchIndex)

    expect(savedState.announcements).toHaveLength(1)
    expect(savedState.nodes).toHaveLength(1)
    expect(searchDirectory(hydrated, "172.20.0.10")).toHaveLength(1)
    expect(searchDirectory(hydrated, alphaNode.npub)[0]?.url).toBe(alphaNode.url)
  })
})
