import {describe, expect, it} from "vitest"
import type {Event} from "nostr-tools"

import {
  applyProfileEvent,
  getProfileTitle,
  normalizeDiscoveryEvent,
  takeLatestEvents,
} from "./normalize"
import type {AuthorState, DirectoryProfileRecord} from "./types"

function hex(char: string) {
  return char.repeat(64)
}

function makeEvent({
  pubkey = hex("a"),
  id = hex("1"),
  created_at = 1,
  tags = [
    ["d", "node-a"],
    ["npub", "npub1vak0mql0unjjjcrznclhx9hptvqvwq4wmk4ppy3wrfg5s283k98q2y0ktt"],
    ["alias", "Alpha Relay"],
    ["transport", "udp", "172.20.0.10", "2121"],
    ["service", "http", "80"],
  ],
  content = "",
}: Partial<Event> = {}): Event {
  return {
    kind: 37195,
    pubkey,
    id,
    sig: hex("f"),
    created_at,
    tags,
    content,
  }
}

describe("normalizeDiscoveryEvent", () => {
  it("turns a discovery announcement into a searchable directory record", () => {
    const record = normalizeDiscoveryEvent(makeEvent())

    expect(record).not.toBeNull()
    expect(record?.alias).toBe("Alpha Relay")
    expect(record?.summary).toContain("Services: http:80")
    expect(record?.url).toMatch(/^http:\/\/npub1.+\.fips\/$/)
  })

  it("ignores announcements without the required npub tag", () => {
    const record = normalizeDiscoveryEvent(makeEvent({tags: [["d", "node-a"], ["alias", "Alpha Relay"]]}))

    expect(record).toBeNull()
  })

  it("treats a newer invalid announcement as removing the active directory entry", () => {
    const profiles = new Map<string, DirectoryProfileRecord>()
    const authorStates = new Map<string, AuthorState>()
    const original = makeEvent({created_at: 10, id: hex("2")})
    const malformed = makeEvent({created_at: 11, id: hex("3"), tags: [["d", "node-a"]]})

    applyProfileEvent(profiles, authorStates, original)
    const changed = applyProfileEvent(profiles, authorStates, malformed)

    expect(changed).toBe(true)
    expect(profiles.has(original.pubkey)).toBe(false)
    expect(authorStates.get(original.pubkey)?.eventId).toBe(malformed.id)
  })

  it("falls back to npub for the result title when alias is missing", () => {
    const record = normalizeDiscoveryEvent(
      makeEvent({
        tags: [
          ["d", "node-a"],
          ["npub", "npub1vak0mql0unjjjcrznclhx9hptvqvwq4wmk4ppy3wrfg5s283k98q2y0ktt"],
          ["service", "http", "80"],
        ],
      }),
    )

    expect(record).not.toBeNull()
    expect(getProfileTitle(record!)).toBe(record?.npub)
  })
})

describe("replaceable announcement handling", () => {
  it("replaces an older announcement with a newer announcement", () => {
    const profiles = new Map<string, DirectoryProfileRecord>()
    const authorStates = new Map<string, AuthorState>()
    const older = makeEvent({created_at: 10, id: hex("4")})
    const newer = makeEvent({
      created_at: 11,
      id: hex("5"),
      tags: [
        ["d", "node-a"],
        ["npub", "npub1vak0mql0unjjjcrznclhx9hptvqvwq4wmk4ppy3wrfg5s283k98q2y0ktt"],
        ["alias", "Beta Relay"],
        ["transport", "udp", "172.20.0.10", "2121"],
        ["service", "http", "80"],
        ["service", "relay", "7777"],
      ],
    })

    applyProfileEvent(profiles, authorStates, older)
    const changed = applyProfileEvent(profiles, authorStates, newer)

    expect(changed).toBe(true)
    expect(profiles.get(older.pubkey)?.alias).toBe("Beta Relay")
    expect(authorStates.get(older.pubkey)?.eventId).toBe(newer.id)
  })

  it("removes an indexed profile when a newer event drops the required tags", () => {
    const profiles = new Map<string, DirectoryProfileRecord>()
    const authorStates = new Map<string, AuthorState>()
    const tagged = makeEvent({created_at: 10, id: hex("6")})
    const untagged = makeEvent({created_at: 11, id: hex("7"), tags: [["d", "node-a"]]})

    applyProfileEvent(profiles, authorStates, tagged)
    const changed = applyProfileEvent(profiles, authorStates, untagged)

    expect(changed).toBe(true)
    expect(profiles.has(tagged.pubkey)).toBe(false)
    expect(authorStates.get(tagged.pubkey)?.active).toBe(false)
  })

  it("collapses duplicate relay copies down to one latest event per author", () => {
    const pubkey = hex("b")
    const oldest = makeEvent({pubkey, created_at: 10, id: hex("8")})
    const newest = makeEvent({pubkey, created_at: 12, id: hex("9")})
    const sameTimestampLoser = makeEvent({pubkey, created_at: 12, id: hex("e")})

    const latestByAuthor = takeLatestEvents([oldest, sameTimestampLoser, newest])

    expect(latestByAuthor.size).toBe(1)
    expect(latestByAuthor.get(pubkey)?.id).toBe(newest.id)
  })
})
