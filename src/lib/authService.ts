import {nip19, verifyEvent} from "nostr-tools"

import type {AuthRuntime, AuthSnapshot, PublishSigner, UnsignedDiscoveryEvent} from "./types"

const EXTENSION_WAIT_MS = 4_000
const EXTENSION_POLL_MS = 250
const EXTENSION_MONITOR_MS = 20_000

const DEFAULT_MISSING_EXTENSION_ERROR = "No NIP-07 signer was detected in this browser."

type NostrExtension = NonNullable<Window["nostr"]>
type NostrAwareGlobal = typeof globalThis & {
  nostr?: Window["nostr"]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function hasSignerMethods(value: unknown): value is NostrExtension {
  if (!isRecord(value)) {
    return false
  }

  try {
    return typeof Reflect.get(value, "getPublicKey") === "function" && typeof Reflect.get(value, "signEvent") === "function"
  } catch {
    return false
  }
}

function firefoxMissingExtensionError() {
  if (typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)) {
    return `${DEFAULT_MISSING_EXTENSION_ERROR} If you're using Firefox, install nos2x-fox or reload after granting this site extension access.`
  }

  return DEFAULT_MISSING_EXTENSION_ERROR
}

function getNostrExtension() {
  if (typeof window === "undefined") {
    return undefined
  }

  const candidates = [window.nostr, window.wrappedJSObject?.nostr, (globalThis as NostrAwareGlobal).nostr]

  for (const candidate of candidates) {
    if (hasSignerMethods(candidate)) {
      return candidate
    }
  }

  return undefined
}

function snapshotWithAvailability(snapshot: Omit<AuthSnapshot, "extensionAvailable">): AuthSnapshot {
  return {
    ...snapshot,
    extensionAvailable: Boolean(getNostrExtension()),
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return "Unknown signer error"
}

export class AuthService implements AuthRuntime {
  private readonly listeners = new Set<() => void>()
  private signer: PublishSigner | null = null
  private monitorInterval?: ReturnType<typeof setInterval>
  private monitorTimeout?: ReturnType<typeof setTimeout>
  private monitoringReady = false
  private state: AuthSnapshot = snapshotWithAvailability({
    status: "anonymous",
  })

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    this.ensureMonitoring()
    this.refreshExtensionAvailability()
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  getSigner = () => this.signer

  logout = () => {
    this.signer = null
    this.setState({
      status: "anonymous",
    })
  }

  async connectWithExtension() {
    this.ensureMonitoring()

    const extension = await this.waitForExtension()

    if (!extension) {
      this.setState({
        status: "anonymous",
        error: firefoxMissingExtensionError(),
      })
      return
    }

    this.setState({
      status: "authenticating",
    })

    try {
      const pubkey = await extension.getPublicKey()
      const npub = nip19.npubEncode(pubkey)
      const signer: PublishSigner = {
        method: "nip07",
        pubkey,
        npub,
        signEvent: async (eventTemplate: UnsignedDiscoveryEvent) => {
          const signed = await extension.signEvent({
            ...eventTemplate,
            pubkey,
          })

          if (signed.pubkey !== pubkey) {
            throw new Error("The signer returned a different public key.")
          }

          if (!verifyEvent(signed)) {
            throw new Error("The signer returned an invalid signature.")
          }

          return signed
        },
      }

      this.signer = signer
      this.setState({
        status: "authenticated",
        pubkey,
        npub,
        method: signer.method,
      })
    } catch (error) {
      this.signer = null
      this.setState({
        status: "anonymous",
        error: errorMessage(error),
      })
    }
  }

  private emit() {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private setState(nextState: Omit<AuthSnapshot, "extensionAvailable">) {
    this.state = snapshotWithAvailability({
      ...nextState,
    })
    this.emit()
  }

  private ensureMonitoring() {
    if (this.monitoringReady || typeof window === "undefined") {
      return
    }

    this.monitoringReady = true

    const refresh = () => {
      const available = this.refreshExtensionAvailability()

      if (available) {
        this.stopPolling()
      } else {
        this.startPolling()
      }
    }

    window.addEventListener("focus", refresh)
    window.addEventListener("pageshow", refresh)
    window.addEventListener("load", refresh, {once: true})

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", refresh)
    }

    this.startPolling()
    queueMicrotask(refresh)
  }

  private refreshExtensionAvailability() {
    const available = Boolean(getNostrExtension())
    const nextError =
      available && this.state.status === "anonymous" && this.state.error?.startsWith(DEFAULT_MISSING_EXTENSION_ERROR)
        ? undefined
        : this.state.error

    if (available === this.state.extensionAvailable && nextError === this.state.error) {
      return available
    }

    this.state = {
      ...this.state,
      extensionAvailable: available,
      error: nextError,
    }
    this.emit()
    return available
  }

  private startPolling() {
    if (this.monitorInterval || typeof window === "undefined") {
      return
    }

    this.monitorInterval = window.setInterval(() => {
      if (this.refreshExtensionAvailability()) {
        this.stopPolling()
      }
    }, EXTENSION_POLL_MS)

    this.monitorTimeout = window.setTimeout(() => {
      this.stopPolling()
    }, EXTENSION_MONITOR_MS)
  }

  private stopPolling() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = undefined
    }

    if (this.monitorTimeout) {
      clearTimeout(this.monitorTimeout)
      this.monitorTimeout = undefined
    }
  }

  private async waitForExtension(timeoutMs = EXTENSION_WAIT_MS) {
    const existing = getNostrExtension()

    if (existing || typeof window === "undefined") {
      return existing
    }

    return new Promise<typeof window.nostr | undefined>((resolve) => {
      const deadline = Date.now() + timeoutMs
      const interval = window.setInterval(() => {
        const extension = getNostrExtension()

        if (extension || Date.now() >= deadline) {
          clearInterval(interval)
          this.refreshExtensionAvailability()
          resolve(extension)
        }
      }, EXTENSION_POLL_MS)
    })
  }
}

export const authService = new AuthService()
