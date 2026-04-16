import {readdir, readFile} from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import {fileURLToPath} from "node:url"

import {Relay, finalizeEvent, getPublicKey, nip19, utils} from "nostr-tools"

const DEFAULT_RELAY = "ws://127.0.0.1:7777"
const DISCOVERY_KIND = 37_195

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..", "..")
const defaultSourceDir = path.join(repoRoot, "fips", "testing", "static", "generated-configs", "web-10")
const defaultTopologyPath = path.join(repoRoot, "fips", "testing", "static", "configs", "topologies", "web-10.yaml")

function parseArgs(argv) {
  const options = {
    relay: DEFAULT_RELAY,
    source: defaultSourceDir,
    topology: defaultTopologyPath,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === "--relay") {
      options.relay = argv[index + 1]
      index += 1
      continue
    }

    if (value === "--source") {
      options.source = path.resolve(argv[index + 1])
      index += 1
      continue
    }

    if (value === "--topology") {
      options.topology = path.resolve(argv[index + 1])
      index += 1
      continue
    }

    if (value === "--dry-run") {
      options.dryRun = true
      continue
    }

    throw new Error(`Unknown argument: ${value}`)
  }

  return options
}

function extractNodeId(fileName) {
  const match = /^node-([a-z0-9_-]+)\.ya?ml$/i.exec(fileName)
  return match?.[1]
}

function extractNsecHex(configText, filePath) {
  const match = configText.match(/^\s*nsec:\s*"([0-9a-f]{64})"\s*$/im)

  if (!match) {
    throw new Error(`Could not find a 64-byte nsec in ${filePath}`)
  }

  return match[1]
}

function extractDockerIp(topologyText, nodeId) {
  const match = topologyText.match(new RegExp(`(?:^|\\n)  ${nodeId}:\\n((?:    .*\\n?)*)`, "m"))
  if (!match) {
    return undefined
  }

  const ipMatch = match[1].match(/^\s*docker_ip:\s*"([^"]+)"/m)
  return ipMatch?.[1]
}

function buildTags(nodeId, npub, dockerIp) {
  const label = nodeId.toUpperCase()
  const tags = [
    ["d", `web-10-node-${nodeId}`],
    ["npub", npub],
    ["alias", `FIPS Node ${label}`],
    ["service", "http", "80"],
  ]

  if (dockerIp) {
    tags.push(["transport", "udp", dockerIp, "2121"])
  }

  return tags
}

async function loadProfiles(sourceDir, topologyPath) {
  const entries = await readdir(sourceDir, {withFileTypes: true})
  const nodeFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => extractNodeId(fileName))
    .sort()

  const createdAtBase = Math.floor(Date.now() / 1000)
  const topologyText = await readFile(topologyPath, "utf8")
  const profiles = []

  for (const [index, fileName] of nodeFiles.entries()) {
    const nodeId = extractNodeId(fileName)

    if (!nodeId) {
      continue
    }

    const filePath = path.join(sourceDir, fileName)
    const configText = await readFile(filePath, "utf8")
    const nsecHex = extractNsecHex(configText, filePath)
    const secretKey = utils.hexToBytes(nsecHex)
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const dockerIp = extractDockerIp(topologyText, nodeId)

    const event = finalizeEvent(
      {
        kind: DISCOVERY_KIND,
        created_at: createdAtBase + index,
        tags: buildTags(nodeId, npub, dockerIp),
        content: "",
      },
      secretKey,
    )

    profiles.push({
      nodeId,
      npub,
      host: `${npub}.fips`,
      url: `http://${npub}.fips/`,
      event,
    })
  }

  return profiles
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const profiles = await loadProfiles(options.source, options.topology)

  if (profiles.length === 0) {
    throw new Error(`No node configs found in ${options.source}`)
  }

  if (options.dryRun) {
    for (const profile of profiles) {
      console.log(`${profile.nodeId}: ${profile.npub} -> ${profile.url}`)
    }
    return
  }

  const relay = await Relay.connect(options.relay)

  try {
    for (const profile of profiles) {
      await relay.publish(profile.event)
      console.log(`published ${profile.nodeId}: ${profile.npub}`)
    }
  } finally {
    relay.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
