# FIPS Discovery Search

Small React app for searching FIPS discovery announcements published as Nostr `kind: 37195` events.

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

Publish the demo node profiles from the generated `web-10` identities in a
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
The links still point to `http://<npub>.fips/`, so clicking them from the macOS
host browser requires the host itself to resolve and route `.fips` names, not
just the containers.

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

The app indexes the latest Nostr `kind: 37195` discovery announcement for each author.

```json
["d", "<discriminator>"]
```

It reads the shared discovery tags:

- `["d", "<discriminator>"]`
- `["npub", "<fips-node-npub>"]`
- `["transport", "<protocol>", "<addr>", "<port>"]`
- `["service", "<name>", "<port>"]`
- `["alias", "<node-alias>"]`

Each result links to:

```text
http://<npub>.fips/
```

## Example Discovery Event

```json
[
  ["d", "web-10-node-a"],
  ["npub", "npub1..."],
  ["alias", "FIPS Node A"],
  ["transport", "udp", "172.20.0.10", "2121"],
  ["service", "http", "80"]
]
```
