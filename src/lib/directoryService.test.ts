import {beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event} from "nostr-tools"

import {clearDirectoryState, loadRelaySettings} from "./db"
import {DirectoryService} from "./directoryService"
import type {PublishSigner} from "./types"

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function waitForBootstrap(service: DirectoryService) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await flush()

    if (!service.getSnapshot().syncing) {
      return
    }
  }

  throw new Error("Directory service did not finish bootstrapping")
}

describe("DirectoryService", () => {
  beforeEach(async () => {
    await clearDirectoryState()
  })

  it("publishes a cloned re-announcement and updates grouped score without double-counting the same announcer", async () => {
    const targetSecretKey = generateSecretKey()
    const targetPubkey = getPublicKey(targetSecretKey)
    const targetNpub = nip19.npubEncode(targetPubkey)
    const baseEvent = finalizeEvent(
      {
        kind: 37195,
        created_at: 10,
        tags: [
          ["d", "web-10-node-j"],
          ["npub", targetNpub],
          ["alias", "Ubrrr"],
          ["service", "ubrrr", "80"],
          ["transport", "udp", "172.20.0.19", "2121"],
        ],
        content: "",
      },
      targetSecretKey,
    )

    let lastPublishedEvent: Event | undefined
    const fakePool = {
      destroy: vi.fn(),
      publish: vi.fn((_relays: string[], event: Event) => {
        lastPublishedEvent = event
        return [Promise.resolve("")]
      }),
      querySync: vi.fn(async () => [baseEvent]),
      subscribe: vi.fn(() => ({
        close: () => undefined,
      })),
    }

    const service = new DirectoryService(["ws://relay.example"], fakePool as never)
    const stop = service.start()
    await waitForBootstrap(service)

    const announcerSecretKey = generateSecretKey()
    const announcerPubkey = getPublicKey(announcerSecretKey)
    const signer: PublishSigner = {
      method: "nip07",
      pubkey: announcerPubkey,
      npub: nip19.npubEncode(announcerPubkey),
      signEvent: async (event) => finalizeEvent(event, announcerSecretKey),
    }

    await service.reannounce(targetNpub, signer)
    await service.reannounce(targetNpub, signer)

    const [result] = service.search("ubrrr", announcerPubkey)

    expect(lastPublishedEvent?.tags).toEqual(baseEvent.tags)
    expect(lastPublishedEvent?.content).toBe(baseEvent.content)
    expect(result?.announcementCount).toBe(2)
    expect(result?.announcedByViewer).toBe(true)
    expect(fakePool.publish).toHaveBeenCalledTimes(2)

    stop()
  })

  it("persists updated relay settings and resyncs against the new relay set", async () => {
    const firstEvent = finalizeEvent(
      {
        kind: 37195,
        created_at: 10,
        tags: [
          ["d", "web-10-node-a"],
          ["npub", nip19.npubEncode(getPublicKey(generateSecretKey()))],
          ["alias", "Alpha Relay"],
        ],
        content: "",
      },
      generateSecretKey(),
    )

    const secondEvent = finalizeEvent(
      {
        kind: 37195,
        created_at: 11,
        tags: [
          ["d", "web-10-node-b"],
          ["npub", nip19.npubEncode(getPublicKey(generateSecretKey()))],
          ["alias", "Beta Relay"],
        ],
        content: "",
      },
      generateSecretKey(),
    )

    const fakePool = {
      destroy: vi.fn(),
      publish: vi.fn(() => [Promise.resolve("")]),
      querySync: vi
        .fn()
        .mockImplementationOnce(async (relays: string[]) => {
          expect(relays).toEqual(["wss://relay.one/"])
          return [firstEvent]
        })
        .mockImplementationOnce(async (relays: string[]) => {
          expect(relays).toEqual(["wss://relay.two/", "wss://relay.three/"])
          return [secondEvent]
        }),
      subscribe: vi.fn(() => ({
        close: () => undefined,
      })),
    }

    const service = new DirectoryService(["wss://relay.one/"], fakePool as never)
    const stop = service.start()
    await waitForBootstrap(service)

    await service.updateRelays(["wss://relay.two/", "wss://relay.three/"])
    await flush()

    expect(service.getSnapshot().relays).toEqual(["wss://relay.two/", "wss://relay.three/"])
    expect(service.search("Beta Relay")).toHaveLength(1)
    expect(await loadRelaySettings()).toEqual(["wss://relay.two/", "wss://relay.three/"])
    expect(fakePool.querySync).toHaveBeenCalledTimes(2)
    expect(fakePool.subscribe).toHaveBeenLastCalledWith(
      ["wss://relay.two/", "wss://relay.three/"],
      expect.any(Object),
      expect.objectContaining({label: "fips-discovery"}),
    )

    stop()
  })
})
