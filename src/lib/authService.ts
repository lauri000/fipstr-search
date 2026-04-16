import {finalizeEvent, getPublicKey, nip19, verifyEvent} from "nostr-tools"

import type {AuthRuntime, AuthSnapshot, PublishSigner, UnsignedDiscoveryEvent} from "./types"

function extensionAvailable() {
  return (
    typeof window !== "undefined" &&
    typeof window.nostr?.getPublicKey === "function" &&
    typeof window.nostr?.signEvent === "function"
  )
}

function snapshotWithAvailability(snapshot: Omit<AuthSnapshot, "extensionAvailable">): AuthSnapshot {
  return {
    ...snapshot,
    extensionAvailable: extensionAvailable(),
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
  private state: AuthSnapshot = snapshotWithAvailability({
    status: "anonymous",
  })

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
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
    if (!extensionAvailable()) {
      this.setState({
        status: "anonymous",
        error: "No NIP-07 signer was detected in this browser.",
      })
      return
    }

    this.setState({
      status: "authenticating",
    })

    try {
      const extension = window.nostr

      if (!extension) {
        throw new Error("No NIP-07 signer was detected in this browser.")
      }

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

  async connectWithNsec(nsec: string) {
    this.setState({
      status: "authenticating",
    })

    try {
      const trimmed = nsec.trim()
      const decoded = nip19.decode(trimmed)

      if (decoded.type !== "nsec") {
        throw new Error("Expected an nsec private key.")
      }

      const secretKey = decoded.data
      const pubkey = getPublicKey(secretKey)
      const npub = nip19.npubEncode(pubkey)
      const signer: PublishSigner = {
        method: "nsec",
        pubkey,
        npub,
        signEvent: async (eventTemplate: UnsignedDiscoveryEvent) => finalizeEvent(eventTemplate, secretKey),
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
}

export const authService = new AuthService()
