import type {Event} from "nostr-tools"

export const DISCOVERY_KIND = 37_195
export const SEARCH_INDEX_VERSION = 2

export type DiscoveryTransport = {
  protocol: string
  addr: string
  port: string
}

export type DiscoveryService = {
  name: string
  port: string
}

export type DirectoryProfileRecord = {
  pubkey: string
  npub: string
  eventId: string
  createdAt: number
  discriminator?: string
  alias?: string
  summary: string
  transports: DiscoveryTransport[]
  services: DiscoveryService[]
  tags: string[][]
  searchText: string
  url: string
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
}

export type DirectorySearchResult = SearchDocument & {
  score?: number
}

export type DirectorySnapshot = {
  status: string
  hydrated: boolean
  syncing: boolean
  profilesCount: number
  relayCount: number
  error?: string
  lastSyncAt?: number
}

export type SearchIndexState = {
  version: number
  indexJson: unknown
  updatedAt: number
  docCount: number
}

export type AuthorState = {
  eventId: string
  createdAt: number
  active: boolean
}

export type SyncState = {
  lastSyncAt?: number
  authorStates: Record<string, AuthorState>
}

export type MetaRecord = {
  key: string
  value: unknown
  updatedAt: number
}

export type DirectoryRuntime = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DirectorySnapshot
  search: (query: string) => DirectorySearchResult[]
  start: () => () => void
}

export type EventMap = Map<string, Event>
