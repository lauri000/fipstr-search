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
    hasAnnouncement: overrides.hasAnnouncement ?? true,
    hasOverlayAdvert: overrides.hasOverlayAdvert ?? false,
    canReannounce: overrides.canReannounce ?? true,
    badges: overrides.badges ?? ["announcement"],
    overlay: overrides.overlay,
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

  it("matches overlay endpoint, relay, capability, protocol, and npub fields", () => {
    const overlayNode = node({
      alias: undefined,
      summary: "Overlay endpoints: UDP 203.0.113.45:2121 · UDP NAT · Tor relayexample.onion:8443",
      services: [],
      transports: [],
      announcementCount: 0,
      announcerPubkeys: [],
      hasAnnouncement: false,
      hasOverlayAdvert: true,
      canReannounce: false,
      badges: ["self-advert", "udp", "tor", "nat", "stun"],
      overlay: {
        protocol: "fips-overlay-v1",
        version: "1",
        endpoints: [
          {transport: "udp", addr: "203.0.113.45:2121"},
          {transport: "udp", addr: "nat"},
          {transport: "tor", addr: "relayexample.onion:8443"},
        ],
        signalRelays: ["wss://relay.damus.io"],
        stunServers: ["stun:stun.l.google.com:19302"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    })
    const index = buildSearchIndex([overlayNode])

    expect(searchDirectory(index, "203.0.113.45")).toHaveLength(1)
    expect(searchDirectory(index, "nat")).toHaveLength(1)
    expect(searchDirectory(index, "stun")).toHaveLength(1)
    expect(searchDirectory(index, "tor")).toHaveLength(1)
    expect(searchDirectory(index, "relay.damus")).toHaveLength(1)
    expect(searchDirectory(index, "fips-overlay-v1")).toHaveLength(1)
    expect(searchDirectory(index, overlayNode.npub)).toHaveLength(1)
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
