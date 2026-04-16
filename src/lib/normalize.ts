import {nip19, type Event} from "nostr-tools"

import {
  DISCOVERY_KIND,
  type AuthorState,
  type DiscoveryService,
  type DiscoveryTransport,
  type DirectoryProfileRecord,
  type EventMap,
  type SearchDocument,
} from "./types"

function pickTagValue(tags: string[][], name: string) {
  const tag = tags.find(([tagName]) => tagName === name)
  const value = tag?.[1]

  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseTaggedNpub(tags: string[][]) {
  const npub = pickTagValue(tags, "npub")

  if (!npub) {
    return undefined
  }

  try {
    const decoded = nip19.decode(npub)
    return decoded.type === "npub" ? npub : undefined
  } catch {
    return undefined
  }
}

function parseTransports(tags: string[][]): DiscoveryTransport[] {
  return tags
    .filter((tag) => tag[0] === "transport" && tag.length >= 4)
    .map(([, protocol, addr, port]) => ({
      protocol: protocol.trim(),
      addr: addr.trim(),
      port: port.trim(),
    }))
    .filter((transport) => transport.protocol && transport.addr && transport.port)
}

function parseServices(tags: string[][]): DiscoveryService[] {
  return tags
    .filter((tag) => tag[0] === "service" && tag.length >= 3)
    .map(([, name, port]) => ({
      name: name.trim(),
      port: port.trim(),
    }))
    .filter((service) => service.name && service.port)
}

function formatServices(services: DiscoveryService[]) {
  return services.map((service) => `${service.name}:${service.port}`).join(", ")
}

function formatTransports(transports: DiscoveryTransport[]) {
  return transports.map((transport) => `${transport.protocol} ${transport.addr}:${transport.port}`).join(", ")
}

function buildSummary(
  npub: string,
  services: DiscoveryService[],
  transports: DiscoveryTransport[],
) {
  const details = [
    services.length > 0 ? `Services: ${formatServices(services)}` : undefined,
    transports.length > 0 ? `Transports: ${formatTransports(transports)}` : undefined,
  ].filter(Boolean)

  if (details.length > 0) {
    return details.join(" · ")
  }

  return `Reachable at http://${npub}.fips/`
}

export function normalizeDiscoveryEvent(event: Event): DirectoryProfileRecord | null {
  if (event.kind !== DISCOVERY_KIND) {
    return null
  }

  const npub = parseTaggedNpub(event.tags)

  if (!npub) {
    return null
  }

  const discriminator = pickTagValue(event.tags, "d")
  const alias = pickTagValue(event.tags, "alias")
  const services = parseServices(event.tags)
  const transports = parseTransports(event.tags)
  const summary = buildSummary(npub, services, transports)

  return {
    pubkey: event.pubkey,
    npub,
    eventId: event.id,
    createdAt: event.created_at,
    discriminator,
    alias,
    summary,
    transports,
    services,
    tags: event.tags.map((tag) => [...tag]),
    searchText: [
      alias,
      discriminator,
      npub,
      summary,
      ...services.flatMap((service) => [service.name, service.port]),
      ...transports.flatMap((transport) => [transport.protocol, transport.addr, transport.port]),
    ]
      .filter(Boolean)
      .join("\n"),
    url: `http://${npub}.fips/`,
  }
}

export function getProfileTitle(profile: DirectoryProfileRecord) {
  return profile.alias ?? profile.npub
}

export function toSearchDocument(profile: DirectoryProfileRecord): SearchDocument {
  return {
    id: profile.pubkey,
    title: getProfileTitle(profile),
    alias: profile.alias ?? "",
    summary: profile.summary,
    services: formatServices(profile.services),
    transports: formatTransports(profile.transports),
    npub: profile.npub,
    host: `${profile.npub}.fips`,
    url: profile.url,
  }
}

function isEventNewerThanState(
  event: Pick<Event, "created_at" | "id">,
  state: Pick<AuthorState, "createdAt" | "eventId">,
) {
  if (event.created_at !== state.createdAt) {
    return event.created_at > state.createdAt
  }

  return event.id.localeCompare(state.eventId) < 0
}

export function isEventNewer(candidate: Event, current: Event) {
  if (candidate.created_at !== current.created_at) {
    return candidate.created_at > current.created_at
  }

  return candidate.id.localeCompare(current.id) < 0
}

export function takeLatestEvents(events: Event[]) {
  const latestByAuthor: EventMap = new Map()

  for (const event of events) {
    const current = latestByAuthor.get(event.pubkey)

    if (!current || isEventNewer(event, current)) {
      latestByAuthor.set(event.pubkey, event)
    }
  }

  return latestByAuthor
}

export function applyProfileEvent(
  profiles: Map<string, DirectoryProfileRecord>,
  authorStates: Map<string, AuthorState>,
  event: Event,
) {
  const currentState = authorStates.get(event.pubkey)

  if (currentState && !isEventNewerThanState(event, currentState)) {
    return false
  }

  const currentlyActive = profiles.has(event.pubkey)
  const nextProfile = normalizeDiscoveryEvent(event)

  if (!nextProfile) {
    authorStates.set(event.pubkey, {
      eventId: event.id,
      createdAt: event.created_at,
      active: false,
    })

    if (!currentlyActive) {
      return false
    }

    profiles.delete(event.pubkey)
    return true
  }

  authorStates.set(event.pubkey, {
    eventId: event.id,
    createdAt: event.created_at,
    active: true,
  })

  const previous = profiles.get(event.pubkey)

  if (previous?.eventId === nextProfile.eventId) {
    return false
  }

  profiles.set(event.pubkey, nextProfile)
  return true
}
