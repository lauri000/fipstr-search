import {beforeEach, describe, expect, it} from "vitest"

import {clearDirectoryState, loadDirectoryState, saveDirectoryState} from "./db"
import {buildSearchIndex, loadSearchIndex, searchDirectory, serializeSearchIndex} from "./search"
import type {DirectoryProfileRecord, SyncState} from "./types"

function profile(overrides: Partial<DirectoryProfileRecord> = {}): DirectoryProfileRecord {
  const pubkey = overrides.pubkey ?? "a".repeat(64)
  const npub = overrides.npub ?? "npub1alpharelaysample0000000000000000000000000000000000000000000"

  return {
    pubkey,
    npub,
    eventId: overrides.eventId ?? "1".repeat(64),
    createdAt: overrides.createdAt ?? 10,
    discriminator: overrides.discriminator ?? "node-a",
    alias: overrides.alias ?? "Alpha Relay",
    summary: overrides.summary ?? "Services: http:80, relay:7777 · Transports: udp 172.20.0.10:2121",
    transports: overrides.transports ?? [{protocol: "udp", addr: "172.20.0.10", port: "2121"}],
    services: overrides.services ?? [
      {name: "http", port: "80"},
      {name: "relay", port: "7777"},
    ],
    tags: overrides.tags ?? [
      ["d", "node-a"],
      ["npub", npub],
      ["alias", "Alpha Relay"],
      ["transport", "udp", "172.20.0.10", "2121"],
      ["service", "http", "80"],
      ["service", "relay", "7777"],
    ],
    searchText:
      overrides.searchText ??
      ["Alpha Relay", "node-a", "http", "relay", "172.20.0.10", "2121", npub].join("\n"),
    url: overrides.url ?? `http://${npub}.fips/`,
  }
}

describe("search index", () => {
  beforeEach(async () => {
    await clearDirectoryState()
  })

  it("matches alias, service, transport, summary text, and npub", () => {
    const alpha = profile()
    const index = buildSearchIndex([alpha])

    expect(searchDirectory(index, "Alpha Relay")).toHaveLength(1)
    expect(searchDirectory(index, "relay")).toHaveLength(1)
    expect(searchDirectory(index, "172.20.0.10")).toHaveLength(1)
    expect(searchDirectory(index, "http:80")).toHaveLength(1)
    expect(searchDirectory(index, alpha.npub)).toHaveLength(1)
  })

  it("round-trips a serialized MiniSearch index through IndexedDB", async () => {
    const alpha = profile()
    const index = buildSearchIndex([alpha])
    const syncState: SyncState = {
      lastSyncAt: 123,
      authorStates: {
        [alpha.pubkey]: {
          eventId: alpha.eventId,
          createdAt: alpha.createdAt,
          active: true,
        },
      },
    }

    await saveDirectoryState([alpha], serializeSearchIndex(index, 1), syncState)

    const savedState = await loadDirectoryState()
    const hydrated = loadSearchIndex(savedState.searchIndex)

    expect(savedState.profiles).toHaveLength(1)
    expect(searchDirectory(hydrated, "172.20.0.10")).toHaveLength(1)
    expect(searchDirectory(hydrated, alpha.npub)[0]?.url).toBe(alpha.url)
  })
})
