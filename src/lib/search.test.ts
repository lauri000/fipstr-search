import {describe, expect, it} from "vitest"

import {buildSearchIndex, searchDirectory} from "./search"
import type {DirectoryNodeRecord} from "./types"

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

  it("returns no results for blank queries", () => {
    const index = buildSearchIndex([node()])

    expect(searchDirectory(index, "")).toEqual([])
    expect(searchDirectory(index, "   ")).toEqual([])
  })
})
