# FIPS Discovery Search

Small React app for searching and boosting FIPS discovery announcements published as Nostr `kind: 37195` events.

## Requirements

- Node 20+
- `pnpm`

## Install

```bash
cd /Users/l/Projects/iris/fips-node-search
pnpm install
```

## Run

Default relay set:

```bash
pnpm dev
```

Use the local relay override (`ws://127.0.0.1:7777`):

```bash
VITE_USE_LOCAL_RELAY=true pnpm dev
```

Use the test relay override:

```bash
VITE_USE_TEST_RELAY=true pnpm dev
```

Open the app at the URL Vite prints, usually:

```text
http://127.0.0.1:5173
```

## Local Demo With The 10-Node Mesh

Start the local relay in one terminal:

```bash
cd /Users/l/Projects/iris
./fips/testing/static/scripts/start-local-relay.sh
```

Publish the demo discovery announcements from the generated `web-10` identities in a
second terminal:

```bash
cd /Users/l/Projects/iris
./fips/testing/static/scripts/publish-discovery.sh web-10
```

Then run the app against the local relay:

```bash
cd /Users/l/Projects/iris/fips-node-search
VITE_USE_LOCAL_RELAY=true pnpm dev
```

The result set is driven by `kind: 37195` discovery events on `ws://127.0.0.1:7777`.
The demo publisher also seeds extra third-party re-announcements for `Ubrrr` so
you can see score-based sorting and the re-announcement UX. The links still
point to `http://<npub>.fips/`, so clicking them from the macOS host browser
requires the host itself to resolve and route `.fips` names, not just the
containers.

## Build

```bash
pnpm build
pnpm preview
```

## Test

```bash
pnpm test
```

## What It Indexes

The app groups Nostr `kind: 37195` announcements by the tagged target
`["npub", "<fips-node-npub>"]`.

It reads the shared discovery tags:

- `["d", "<discriminator>"]`
- `["npub", "<fips-node-npub>"]`
- `["transport", "<protocol>", "<addr>", "<port>"]`
- `["service", "<name>", "<port>"]`
- `["alias", "<node-alias>"]`

For each target `npub`, the app:

- keeps the latest valid announcement per `(author pubkey, target npub)` pair
- prefers the self-announcement as the canonical display record
- falls back to the newest third-party announcement if there is no self-announcement
- counts unique announcers to produce the visible announcement score

Results stay hidden until you type a query. Non-empty queries are ranked by:

1. announcement count
2. text relevance
3. alias / `npub` as a stable tiebreaker

Each result links to:

```text
http://<npub>.fips/
```

## Signing In And Re-Announcing

The page uses a NIP-07 browser extension for signing. The login control sits in
the top-right corner so the search UI stays uncluttered.

When signed in, every result card shows a `Re-announce` or `Announce again`
button. Clicking it republishes the canonical discovery event with the same
kind, content, and tags, but with your own author pubkey, timestamp, and
signature. The score increases only if you have not already announced that
target `npub`.

## Example Discovery Event

Self-announcements and re-announcements share the same format:

```json
[
  ["d", "web-10-node-a"],
  ["npub", "npub1..."],
  ["alias", "FIPS Node A"],
  ["transport", "udp", "172.20.0.10", "2121"],
  ["service", "http", "80"]
]
```
