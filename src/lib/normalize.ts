import {nip19, type Event} from "nostr-tools"

import {
  DISCOVERY_KIND,
  type AnnouncementRecord,
  type DirectoryNodeRecord,
  type DirectoryRecordSource,
  type DiscoveryService,
  type DiscoveryTransport,
  type OverlayAdvertRecord,
  type OverlayEndpoint,
  type SearchDocument,
} from "./types"

const FIPS_OVERLAY_IDENTIFIER = "fips-overlay-v1"
const FIPS_OVERLAY_VERSION = 1
const OVERLAY_TRANSPORTS = new Set(["udp", "tcp", "tor"])

function nowSecs() {
  return Math.floor(Date.now() / 1000)
}

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

function parseExpiration(tags: string[][]) {
  const expiration = pickTagValue(tags, "expiration")

  if (!expiration) {
    return undefined
  }

  const expiresAt = Number(expiration)

  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return undefined
  }

  return Math.floor(expiresAt)
}

function isExpired(expiresAt: number | undefined, currentSecs = nowSecs()) {
  return typeof expiresAt === "number" && expiresAt <= currentSecs
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseOverlayEndpoints(value: unknown): OverlayEndpoint[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined
      }

      const record = item as Record<string, unknown>
      const transport = typeof record.transport === "string" ? record.transport.trim().toLowerCase() : ""
      const addr = typeof record.addr === "string" ? record.addr.trim() : ""

      if (!OVERLAY_TRANSPORTS.has(transport) || !addr) {
        return undefined
      }

      return {transport, addr}
    })
    .filter((endpoint): endpoint is OverlayEndpoint => Boolean(endpoint))
}

function formatServices(services: DiscoveryService[]) {
  return services.map((service) => `${service.name}:${service.port}`).join(", ")
}

function formatTransports(transports: DiscoveryTransport[]) {
  return transports.map((transport) => `${transport.protocol} ${transport.addr}:${transport.port}`).join(", ")
}

function formatOverlayEndpoint(endpoint: OverlayEndpoint) {
  const transport = endpoint.transport.toUpperCase()

  if (endpoint.transport === "udp" && endpoint.addr.toLowerCase() === "nat") {
    return "UDP NAT"
  }

  return `${transport} ${endpoint.addr}`
}

function formatOverlayEndpoints(endpoints: OverlayEndpoint[]) {
  return endpoints.map(formatOverlayEndpoint).join(" · ")
}

function collectOverlayCapabilities(overlay?: OverlayAdvertRecord) {
  if (!overlay) {
    return []
  }

  const capabilities = new Set<string>()

  for (const endpoint of overlay.endpoints) {
    capabilities.add(endpoint.transport)

    if (endpoint.addr.toLowerCase() === "nat") {
      capabilities.add("nat")
    }
  }

  if (overlay.stunServers.length > 0) {
    capabilities.add("stun")
  }

  return ["udp", "tcp", "tor", "nat", "stun"].filter((capability) => capabilities.has(capability))
}

function buildOverlaySummary(overlay: OverlayAdvertRecord) {
  return `Overlay endpoints: ${formatOverlayEndpoints(overlay.endpoints)}`
}

function buildSummary(
  targetNpub: string,
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

  return `Reachable at http://${targetNpub}.fips/`
}

function buildNodeSummary(canonical: AnnouncementRecord, overlay?: OverlayAdvertRecord) {
  const details = [canonical.summary]

  if (overlay) {
    const overlaySummary = buildOverlaySummary(overlay)

    if (overlaySummary !== canonical.summary) {
      details.push(overlaySummary)
    }
  }

  return details.filter(Boolean).join(" · ")
}

function buildBadges(hasAnnouncement: boolean, overlay?: OverlayAdvertRecord) {
  return [
    hasAnnouncement ? "announcement" : undefined,
    overlay ? "self-advert" : undefined,
    ...collectOverlayCapabilities(overlay),
  ].filter((badge): badge is string => Boolean(badge))
}

export function announcementKey(
  authorPubkey: string,
  targetNpub: string,
  source: DirectoryRecordSource = "announcement",
) {
  return `${source}:${authorPubkey}:${targetNpub}`
}

export function isRecordNewer(
  candidate: Pick<AnnouncementRecord, "createdAt" | "eventId">,
  current: Pick<AnnouncementRecord, "createdAt" | "eventId">,
) {
  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt > current.createdAt
  }

  return candidate.eventId.localeCompare(current.eventId) < 0
}

function normalizeTaggedAnnouncementEvent(event: Event): AnnouncementRecord | null {
  const targetNpub = parseTaggedNpub(event.tags)

  if (!targetNpub) {
    return null
  }

  const authorNpub = nip19.npubEncode(event.pubkey)
  const discriminator = pickTagValue(event.tags, "d")
  const alias = pickTagValue(event.tags, "alias")
  const services = parseServices(event.tags)
  const transports = parseTransports(event.tags)
  const summary = buildSummary(targetNpub, services, transports)

  return {
    id: announcementKey(event.pubkey, targetNpub, "announcement"),
    source: "announcement",
    authorPubkey: event.pubkey,
    authorNpub,
    targetNpub,
    eventId: event.id,
    createdAt: event.created_at,
    discriminator,
    alias,
    content: event.content,
    summary,
    transports,
    services,
    tags: event.tags.map((tag) => [...tag]),
    url: `http://${targetNpub}.fips/`,
  }
}

function normalizeOverlayAdvertEvent(event: Event, currentSecs = nowSecs()): AnnouncementRecord | null {
  const discriminator = pickTagValue(event.tags, "d")

  if (discriminator !== FIPS_OVERLAY_IDENTIFIER) {
    return null
  }

  const expiresAt = parseExpiration(event.tags)

  if (isExpired(expiresAt, currentSecs)) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(event.content)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") {
    return null
  }

  const advert = parsed as Record<string, unknown>

  if (advert.identifier !== FIPS_OVERLAY_IDENTIFIER || advert.version !== FIPS_OVERLAY_VERSION) {
    return null
  }

  const endpoints = parseOverlayEndpoints(advert.endpoints)

  if (endpoints.length === 0) {
    return null
  }

  const authorNpub = nip19.npubEncode(event.pubkey)
  const overlay: OverlayAdvertRecord = {
    protocol: pickTagValue(event.tags, "protocol") ?? FIPS_OVERLAY_IDENTIFIER,
    version: pickTagValue(event.tags, "version") ?? String(FIPS_OVERLAY_VERSION),
    endpoints,
    signalRelays: parseStringArray(advert.signalRelays),
    stunServers: parseStringArray(advert.stunServers),
    expiresAt,
  }

  return {
    id: announcementKey(event.pubkey, authorNpub, "overlay"),
    source: "overlay",
    authorPubkey: event.pubkey,
    authorNpub,
    targetNpub: authorNpub,
    eventId: event.id,
    createdAt: event.created_at,
    discriminator,
    content: event.content,
    summary: buildOverlaySummary(overlay),
    transports: [],
    services: [],
    tags: event.tags.map((tag) => [...tag]),
    url: `http://${authorNpub}.fips/`,
    overlay,
  }
}

export function normalizeAnnouncementEvent(event: Event, currentSecs = nowSecs()): AnnouncementRecord | null {
  if (event.kind !== DISCOVERY_KIND) {
    return null
  }

  return normalizeTaggedAnnouncementEvent(event) ?? normalizeOverlayAdvertEvent(event, currentSecs)
}

export function normalizeCachedAnnouncementRecord(record: AnnouncementRecord): AnnouncementRecord | null {
  const source = record.source ?? "announcement"

  if (source === "overlay") {
    if (!record.overlay || !Array.isArray(record.overlay.endpoints) || record.overlay.endpoints.length === 0 || isExpired(record.overlay.expiresAt)) {
      return null
    }
  }

  return {
    ...record,
    source,
    id: announcementKey(record.authorPubkey, record.targetNpub, source),
    services: record.services ?? [],
    transports: record.transports ?? [],
    tags: record.tags ?? [],
    url: record.url ?? `http://${record.targetNpub}.fips/`,
    summary: record.summary ?? `Reachable at http://${record.targetNpub}.fips/`,
  }
}

export function applyAnnouncementEvent(
  announcements: Map<string, AnnouncementRecord>,
  event: Event,
) {
  const nextRecord = normalizeAnnouncementEvent(event)

  if (!nextRecord) {
    return false
  }

  const previous = announcements.get(nextRecord.id)

  if (previous && !isRecordNewer(nextRecord, previous)) {
    return false
  }

  announcements.set(nextRecord.id, nextRecord)
  return true
}

export function takeLatestAnnouncements(events: Event[]) {
  const latest = new Map<string, AnnouncementRecord>()

  for (const event of events) {
    applyAnnouncementEvent(latest, event)
  }

  return latest
}

function chooseCanonicalAnnouncement(announcements: AnnouncementRecord[]) {
  if (announcements.length === 0) {
    return undefined
  }

  const selfAnnouncements = announcements.filter((announcement) => announcement.authorNpub === announcement.targetNpub)
  const candidates = selfAnnouncements.length > 0 ? selfAnnouncements : announcements

  return candidates.reduce<AnnouncementRecord | undefined>((current, candidate) => {
    if (!current) {
      return candidate
    }

    return isRecordNewer(candidate, current) ? candidate : current
  }, undefined)
}

function chooseOverlayAdvert(records: AnnouncementRecord[]) {
  const overlays = records.filter((record) => record.source === "overlay" && record.overlay && !isExpired(record.overlay.expiresAt))

  return overlays.reduce<AnnouncementRecord | undefined>((current, candidate) => {
    if (!current) {
      return candidate
    }

    return isRecordNewer(candidate, current) ? candidate : current
  }, undefined)
}

export function buildDirectoryNodes(announcements: Iterable<AnnouncementRecord>) {
  const byTarget = new Map<string, AnnouncementRecord[]>()

  for (const announcement of announcements) {
    const normalized = normalizeCachedAnnouncementRecord(announcement)

    if (!normalized) {
      continue
    }

    const list = byTarget.get(normalized.targetNpub)

    if (list) {
      list.push(normalized)
    } else {
      byTarget.set(normalized.targetNpub, [normalized])
    }
  }

  const nodes = new Map<string, DirectoryNodeRecord>()

  for (const [targetNpub, records] of byTarget.entries()) {
    const announcementRecords = records.filter((record) => record.source === "announcement")
    const canonicalAnnouncement = chooseCanonicalAnnouncement(announcementRecords)
    const overlayRecord = chooseOverlayAdvert(records)
    const canonical = canonicalAnnouncement ?? overlayRecord

    if (!canonical) {
      continue
    }

    const overlay = overlayRecord?.overlay
    const announcerPubkeys = Array.from(new Set(announcementRecords.map((record) => record.authorPubkey))).sort()
    const hasAnnouncement = announcementRecords.length > 0

    nodes.set(targetNpub, {
      npub: targetNpub,
      alias: canonicalAnnouncement?.alias,
      summary: buildNodeSummary(canonical, overlay),
      transports: canonicalAnnouncement?.transports.map((transport) => ({...transport})) ?? [],
      services: canonicalAnnouncement?.services.map((service) => ({...service})) ?? [],
      tags: canonical.tags.map((tag) => [...tag]),
      content: canonical.content,
      url: canonical.url,
      announcementCount: announcerPubkeys.length,
      announcerPubkeys,
      canonicalAnnouncementId: canonical.id,
      canonicalEventId: canonical.eventId,
      canonicalAuthorPubkey: canonical.authorPubkey,
      hasAnnouncement,
      hasOverlayAdvert: Boolean(overlay),
      canReannounce: hasAnnouncement,
      badges: buildBadges(hasAnnouncement, overlay),
      overlay: overlay
        ? {
            ...overlay,
            endpoints: overlay.endpoints.map((endpoint) => ({...endpoint})),
            signalRelays: [...overlay.signalRelays],
            stunServers: [...overlay.stunServers],
          }
        : undefined,
    })
  }

  return nodes
}

export function getNodeTitle(node: DirectoryNodeRecord) {
  return node.alias ?? node.npub
}

export function toSearchDocument(node: DirectoryNodeRecord): SearchDocument {
  const overlayEndpoints = node.overlay ? formatOverlayEndpoints(node.overlay.endpoints) : ""
  const overlayRelays = node.overlay ? [...node.overlay.signalRelays, ...node.overlay.stunServers].join(" ") : ""
  const capabilities = node.badges.join(" ")
  const protocol = node.overlay ? `${node.overlay.protocol} version ${node.overlay.version}` : ""

  return {
    id: node.npub,
    title: getNodeTitle(node),
    alias: node.alias ?? "",
    summary: node.summary,
    services: formatServices(node.services),
    transports: formatTransports(node.transports),
    npub: node.npub,
    host: `${node.npub}.fips`,
    url: node.url,
    announcementCount: node.announcementCount,
    overlayEndpoints,
    overlayRelays,
    capabilities,
    protocol,
    canReannounce: node.canReannounce,
    badges: [...node.badges],
  }
}
