import type {Event} from "nostr-tools"

declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>
      signEvent: (event: Omit<Event, "id" | "sig"> & Partial<Pick<Event, "id" | "sig">>) => Promise<Event>
    }
  }
}

export {}
