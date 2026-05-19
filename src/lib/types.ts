import type {Event} from "nostr-tools"

export const DISCOVERY_KIND = 37_195

export type DirectoryRecordSource = "announcement" | "overlay"

export type DiscoveryTransport = {
  protocol: string
  addr: string
  port: string
}

export type DiscoveryService = {
  name: string
  port: string
}

export type OverlayEndpoint = {
  transport: string
  addr: string
}

export type OverlayAdvertRecord = {
  protocol: string
  version: string
  endpoints: OverlayEndpoint[]
  signalRelays: string[]
  stunServers: string[]
  expiresAt?: number
}

export type AnnouncementRecord = {
  id: string
  source: DirectoryRecordSource
  authorPubkey: string
  authorNpub: string
  targetNpub: string
  eventId: string
  createdAt: number
  discriminator?: string
  alias?: string
  content: string
  summary: string
  transports: DiscoveryTransport[]
  services: DiscoveryService[]
  tags: string[][]
  url: string
  overlay?: OverlayAdvertRecord
}

export type DirectoryNodeRecord = {
  npub: string
  alias?: string
  summary: string
  transports: DiscoveryTransport[]
  services: DiscoveryService[]
  tags: string[][]
  content: string
  url: string
  announcementCount: number
  announcerPubkeys: string[]
  canonicalAnnouncementId: string
  canonicalEventId: string
  canonicalAuthorPubkey: string
  hasAnnouncement: boolean
  hasOverlayAdvert: boolean
  canReannounce: boolean
  badges: string[]
  overlay?: OverlayAdvertRecord
}

export type SearchDocument = {
  id: string
  title: string
  alias: string
  summary: string
  services: string
  transports: string
  npub: string
  host: string
  url: string
  announcementCount: number
  overlayEndpoints: string
  overlayRelays: string
  capabilities: string
  protocol: string
  canReannounce: boolean
  badges: string[]
}

export type DirectorySearchResult = SearchDocument & {
  score?: number
  announcedByViewer: boolean
}

export type DirectorySnapshot = {
  status: string
  hydrated: boolean
  syncing: boolean
  nodesCount: number
  relayCount: number
  relays: string[]
  error?: string
  lastSyncAt?: number
}

export type SyncState = {
  lastSyncAt?: number
}

export type MetaRecord = {
  key: string
  value: unknown
  updatedAt: number
}

export type UnsignedDiscoveryEvent = Pick<Event, "kind" | "created_at" | "tags" | "content">

export type PublishSigner = {
  method: "nip07"
  pubkey: string
  npub: string
  signEvent: (event: UnsignedDiscoveryEvent) => Promise<Event>
}

export type AuthSnapshot = {
  status: "anonymous" | "authenticating" | "authenticated"
  extensionAvailable: boolean
  error?: string
  pubkey?: string
  npub?: string
  method?: PublishSigner["method"]
}

export type DirectoryRuntime = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DirectorySnapshot
  search: (query: string, viewerPubkey?: string) => DirectorySearchResult[]
  start: () => () => void
  reannounce: (targetNpub: string, signer: PublishSigner) => Promise<void>
  updateRelays: (relays: string[]) => Promise<void>
}

export type AuthRuntime = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => AuthSnapshot
  connectWithExtension: () => Promise<void>
  getSigner: () => PublishSigner | null
  logout: () => void
}
