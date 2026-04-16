import {nip19, type Event} from "nostr-tools"

import {
  DISCOVERY_KIND,
  type AnnouncementRecord,
  type DirectoryNodeRecord,
  type DiscoveryService,
  type DiscoveryTransport,
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

export function announcementKey(authorPubkey: string, targetNpub: string) {
  return `${authorPubkey}:${targetNpub}`
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

export function normalizeAnnouncementEvent(event: Event): AnnouncementRecord | null {
  if (event.kind !== DISCOVERY_KIND) {
    return null
  }

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
    id: announcementKey(event.pubkey, targetNpub),
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
  const selfAnnouncements = announcements.filter((announcement) => announcement.authorNpub === announcement.targetNpub)
  const candidates = selfAnnouncements.length > 0 ? selfAnnouncements : announcements

  return candidates.reduce((current, candidate) => {
    if (!current) {
      return candidate
    }

    return isRecordNewer(candidate, current) ? candidate : current
  })
}

export function buildDirectoryNodes(announcements: Iterable<AnnouncementRecord>) {
  const byTarget = new Map<string, AnnouncementRecord[]>()

  for (const announcement of announcements) {
    const list = byTarget.get(announcement.targetNpub)

    if (list) {
      list.push(announcement)
    } else {
      byTarget.set(announcement.targetNpub, [announcement])
    }
  }

  const nodes = new Map<string, DirectoryNodeRecord>()

  for (const [targetNpub, records] of byTarget.entries()) {
    const canonical = chooseCanonicalAnnouncement(records)

    if (!canonical) {
      continue
    }

    const announcerPubkeys = Array.from(new Set(records.map((record) => record.authorPubkey))).sort()

    nodes.set(targetNpub, {
      npub: targetNpub,
      alias: canonical.alias,
      summary: canonical.summary,
      transports: canonical.transports.map((transport) => ({...transport})),
      services: canonical.services.map((service) => ({...service})),
      tags: canonical.tags.map((tag) => [...tag]),
      content: canonical.content,
      url: canonical.url,
      announcementCount: announcerPubkeys.length,
      announcerPubkeys,
      canonicalAnnouncementId: canonical.id,
      canonicalEventId: canonical.eventId,
      canonicalAuthorPubkey: canonical.authorPubkey,
    })
  }

  return nodes
}

export function getNodeTitle(node: DirectoryNodeRecord) {
  return node.alias ?? node.npub
}

export function toSearchDocument(node: DirectoryNodeRecord): SearchDocument {
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
  }
}
