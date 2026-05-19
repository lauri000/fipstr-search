import {describe, expect, it} from "vitest"
import {nip19, type Event} from "nostr-tools"

import {
  announcementKey,
  applyAnnouncementEvent,
  buildDirectoryNodes,
  getNodeTitle,
  normalizeAnnouncementEvent,
  takeLatestAnnouncements,
} from "./normalize"
import type {AnnouncementRecord} from "./types"

function hex(char: string) {
  return char.repeat(64)
}

function npubFor(pubkey: string) {
  return nip19.npubEncode(pubkey)
}

function makeEvent({
  pubkey = hex("a"),
  id = hex("1"),
  created_at = 1,
  targetNpub = npubFor(hex("a")),
  tags,
  content = "",
}: Partial<Event> & {targetNpub?: string} = {}): Event {
  return {
    kind: 37195,
    pubkey,
    id,
    sig: hex("f"),
    created_at,
    tags:
      tags ??
      [
        ["d", "node-a"],
        ["npub", targetNpub],
        ["alias", "Alpha Relay"],
        ["transport", "udp", "172.20.0.10", "2121"],
        ["service", "http", "80"],
      ],
    content,
  }
}

function makeOverlayEvent({
  pubkey = hex("a"),
  id = hex("f"),
  created_at = 100,
  tags,
  content,
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
}: Partial<Event> & {expiresAt?: number} = {}): Event {
  return {
    kind: 37195,
    pubkey,
    id,
    sig: hex("e"),
    created_at,
    tags:
      tags ??
      [
        ["d", "fips-overlay-v1"],
        ["protocol", "fips-overlay-v1"],
        ["version", "1"],
        ["expiration", String(expiresAt)],
      ],
    content:
      content ??
      JSON.stringify({
        identifier: "fips-overlay-v1",
        version: 1,
        endpoints: [
          {transport: "udp", addr: "203.0.113.45:2121"},
          {transport: "udp", addr: "nat"},
          {transport: "tor", addr: "relayexample.onion:8443"},
        ],
        signalRelays: ["wss://relay.damus.io"],
        stunServers: ["stun:stun.l.google.com:19302"],
      }),
  }
}

describe("normalizeAnnouncementEvent", () => {
  it("turns a discovery announcement into an announcement record", () => {
    const event = makeEvent()
    const record = normalizeAnnouncementEvent(event)

    expect(record).not.toBeNull()
    expect(record?.source).toBe("announcement")
    expect(record?.targetNpub).toBe(npubFor(event.pubkey))
    expect(record?.id).toBe(announcementKey(event.pubkey, npubFor(event.pubkey)))
    expect(record?.summary).toContain("Services: http:80")
  })

  it("ignores announcements without the required npub tag", () => {
    const record = normalizeAnnouncementEvent(makeEvent({tags: [["d", "node-a"], ["alias", "Alpha Relay"]]}))

    expect(record).toBeNull()
  })

  it("turns a valid FIPS overlay advert into an overlay record", () => {
    const event = makeOverlayEvent()
    const record = normalizeAnnouncementEvent(event)

    expect(record).not.toBeNull()
    expect(record?.source).toBe("overlay")
    expect(record?.targetNpub).toBe(npubFor(event.pubkey))
    expect(record?.id).toBe(announcementKey(event.pubkey, npubFor(event.pubkey), "overlay"))
    expect(record?.overlay?.endpoints).toHaveLength(3)
    expect(record?.overlay?.signalRelays).toEqual(["wss://relay.damus.io"])
    expect(record?.overlay?.stunServers).toEqual(["stun:stun.l.google.com:19302"])
    expect(record?.summary).toContain("Overlay endpoints: UDP 203.0.113.45:2121")
  })

  it("ignores malformed or expired FIPS overlay adverts", () => {
    const currentSecs = 1_000
    const cases = [
      makeOverlayEvent({content: "{not json"}),
      makeOverlayEvent({
        content: JSON.stringify({
          identifier: "wrong",
          version: 1,
          endpoints: [{transport: "udp", addr: "203.0.113.45:2121"}],
        }),
      }),
      makeOverlayEvent({
        content: JSON.stringify({
          identifier: "fips-overlay-v1",
          version: 2,
          endpoints: [{transport: "udp", addr: "203.0.113.45:2121"}],
        }),
      }),
      makeOverlayEvent({
        content: JSON.stringify({
          identifier: "fips-overlay-v1",
          version: 1,
          endpoints: [],
        }),
      }),
      makeOverlayEvent({expiresAt: 999}),
    ]

    for (const event of cases) {
      expect(normalizeAnnouncementEvent(event, currentSecs)).toBeNull()
    }
  })
})

describe("grouped discovery aggregation", () => {
  it("collapses self-announcement and third-party re-announcement into one target row", () => {
    const selfPubkey = hex("a")
    const thirdPartyPubkey = hex("b")
    const targetNpub = npubFor(selfPubkey)
    const self = makeEvent({pubkey: selfPubkey, targetNpub, id: hex("1"), created_at: 10})
    const repost = makeEvent({pubkey: thirdPartyPubkey, targetNpub, id: hex("2"), created_at: 11})

    const announcements = takeLatestAnnouncements([self, repost])
    const nodes = buildDirectoryNodes(announcements.values())
    const node = nodes.get(targetNpub)

    expect(nodes.size).toBe(1)
    expect(node?.announcementCount).toBe(2)
    expect(node?.canonicalAuthorPubkey).toBe(selfPubkey)
    expect(getNodeTitle(node!)).toBe("Alpha Relay")
  })

  it("counts unique announcers rather than raw events", () => {
    const targetPubkey = hex("c")
    const authorPubkey = hex("d")
    const targetNpub = npubFor(targetPubkey)
    const announcements = new Map<string, AnnouncementRecord>()
    const older = makeEvent({pubkey: authorPubkey, targetNpub, id: hex("3"), created_at: 10})
    const newer = makeEvent({pubkey: authorPubkey, targetNpub, id: hex("4"), created_at: 11})

    applyAnnouncementEvent(announcements, older)
    applyAnnouncementEvent(announcements, newer)

    const node = buildDirectoryNodes(announcements.values()).get(targetNpub)

    expect(announcements.size).toBe(1)
    expect(node?.announcementCount).toBe(1)
    expect(node?.canonicalEventId).toBe(newer.id)
  })

  it("lets one author announce multiple targets", () => {
    const authorPubkey = hex("e")
    const targetOne = npubFor(hex("1"))
    const targetTwo = npubFor(hex("2"))
    const announcements = takeLatestAnnouncements([
      makeEvent({pubkey: authorPubkey, targetNpub: targetOne, id: hex("5")}),
      makeEvent({pubkey: authorPubkey, targetNpub: targetTwo, id: hex("6")}),
    ])

    const nodes = buildDirectoryNodes(announcements.values())

    expect(nodes.size).toBe(2)
    expect(nodes.get(targetOne)?.announcementCount).toBe(1)
    expect(nodes.get(targetTwo)?.announcementCount).toBe(1)
  })

  it("falls back to the newest third-party announcement when there is no self-announcement", () => {
    const targetNpub = npubFor(hex("7"))
    const older = makeEvent({
      pubkey: hex("8"),
      targetNpub,
      id: hex("7"),
      created_at: 10,
      tags: [
        ["d", "target-x"],
        ["npub", targetNpub],
        ["alias", "Old Mirror"],
        ["service", "http", "80"],
      ],
    })
    const newer = makeEvent({
      pubkey: hex("9"),
      targetNpub,
      id: hex("8"),
      created_at: 12,
      tags: [
        ["d", "target-x"],
        ["npub", targetNpub],
        ["alias", "New Mirror"],
        ["service", "http", "80"],
      ],
    })

    const node = buildDirectoryNodes(takeLatestAnnouncements([older, newer]).values()).get(targetNpub)

    expect(node?.alias).toBe("New Mirror")
    expect(node?.canonicalEventId).toBe(newer.id)
  })

  it("collapses duplicate relay copies down to one latest announcement per author and target", () => {
    const pubkey = hex("b")
    const targetNpub = npubFor(hex("f"))
    const oldest = makeEvent({pubkey, targetNpub, created_at: 10, id: hex("8")})
    const newest = makeEvent({pubkey, targetNpub, created_at: 12, id: hex("9")})
    const sameTimestampLoser = makeEvent({pubkey, targetNpub, created_at: 12, id: hex("e")})

    const latestAnnouncements = takeLatestAnnouncements([oldest, sameTimestampLoser, newest])
    const record = latestAnnouncements.get(announcementKey(pubkey, targetNpub))

    expect(latestAnnouncements.size).toBe(1)
    expect(record?.eventId).toBe(newest.id)
  })

  it("builds an overlay-only node from a FIPS overlay advert", () => {
    const event = makeOverlayEvent({pubkey: hex("a")})
    const announcements = takeLatestAnnouncements([event])
    const targetNpub = npubFor(event.pubkey)
    const node = buildDirectoryNodes(announcements.values()).get(targetNpub)

    expect(node?.hasAnnouncement).toBe(false)
    expect(node?.hasOverlayAdvert).toBe(true)
    expect(node?.canReannounce).toBe(false)
    expect(node?.announcementCount).toBe(0)
    expect(node?.badges).toEqual(["self-advert", "udp", "tor", "nat", "stun"])
    expect(node?.summary).toContain("Overlay endpoints: UDP 203.0.113.45:2121")
  })

  it("merges a human announcement and overlay advert for the same node", () => {
    const pubkey = hex("a")
    const targetNpub = npubFor(pubkey)
    const announcement = makeEvent({pubkey, targetNpub, id: hex("1"), created_at: 10})
    const overlay = makeOverlayEvent({pubkey, id: hex("2"), created_at: 11})
    const announcements = takeLatestAnnouncements([announcement, overlay])
    const node = buildDirectoryNodes(announcements.values()).get(targetNpub)

    expect(announcements.size).toBe(2)
    expect(node?.hasAnnouncement).toBe(true)
    expect(node?.hasOverlayAdvert).toBe(true)
    expect(node?.canReannounce).toBe(true)
    expect(getNodeTitle(node!)).toBe("Alpha Relay")
    expect(node?.summary).toContain("Services: http:80")
    expect(node?.summary).toContain("Overlay endpoints")
    expect(node?.badges).toEqual(["announcement", "self-advert", "udp", "tor", "nat", "stun"])
  })

  it("keeps self-announcements and self-adverts from colliding in the cache key", () => {
    const pubkey = hex("c")
    const targetNpub = npubFor(pubkey)
    const announcement = makeEvent({pubkey, targetNpub, id: hex("a"), created_at: 10})
    const overlay = makeOverlayEvent({pubkey, id: hex("b"), created_at: 11})
    const announcements = takeLatestAnnouncements([announcement, overlay])

    expect(announcements.has(announcementKey(pubkey, targetNpub, "announcement"))).toBe(true)
    expect(announcements.has(announcementKey(pubkey, targetNpub, "overlay"))).toBe(true)
  })
})
