import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"

import {AuthService} from "./authService"

describe("AuthService", () => {
  beforeEach(() => {
    delete window.nostr
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports a missing extension without authenticating", async () => {
    const auth = new AuthService()

    await auth.connectWithExtension()

    expect(auth.getSnapshot().status).toBe("anonymous")
    expect(auth.getSnapshot().error).toBe("No NIP-07 signer was detected in this browser.")
    expect(auth.getSigner()).toBeNull()
  })

  it("uses a NIP-07 extension signer when available and forgets it on logout", async () => {
    const auth = new AuthService()
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)

    window.nostr = {
      getPublicKey: vi.fn(async () => pubkey),
      signEvent: vi.fn(async (event) => finalizeEvent(event, secretKey)),
    }

    await auth.connectWithExtension()

    const snapshot = auth.getSnapshot()
    const signer = auth.getSigner()
    const signed = await signer?.signEvent({
      kind: 37195,
      created_at: 123,
      tags: [["npub", nip19.npubEncode(pubkey)]],
      content: "",
    })

    expect(snapshot.status).toBe("authenticated")
    expect(snapshot.method).toBe("nip07")
    expect(window.nostr.getPublicKey).toHaveBeenCalled()
    expect(window.nostr.signEvent).toHaveBeenCalled()
    expect(signed?.pubkey).toBe(pubkey)

    auth.logout()

    expect(auth.getSnapshot().status).toBe("anonymous")
    expect(auth.getSigner()).toBeNull()
  })

  it("recognizes an extension that appears after startup", async () => {
    vi.useFakeTimers()

    const auth = new AuthService()
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)

    auth.subscribe(() => undefined)

    expect(auth.getSnapshot().extensionAvailable).toBe(false)

    window.setTimeout(() => {
      window.nostr = {
        getPublicKey: vi.fn(async () => pubkey),
        signEvent: vi.fn(async (event) => finalizeEvent(event, secretKey)),
      }
    }, 300)

    await vi.advanceTimersByTimeAsync(600)

    expect(auth.getSnapshot().extensionAvailable).toBe(true)
  })

  it("waits briefly for a late-injected extension before failing", async () => {
    vi.useFakeTimers()

    const auth = new AuthService()
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)

    window.setTimeout(() => {
      window.nostr = {
        getPublicKey: vi.fn(async () => pubkey),
        signEvent: vi.fn(async (event) => finalizeEvent(event, secretKey)),
      }
    }, 300)

    const connectPromise = auth.connectWithExtension()
    await vi.advanceTimersByTimeAsync(600)
    await connectPromise

    expect(auth.getSnapshot().status).toBe("authenticated")
    expect(auth.getSnapshot().pubkey).toBe(pubkey)
  })
})
