# fipstr search

React app for searching and re-announcing FIPS discovery entries published as Nostr `kind: 37195` events.

## What It Does

- indexes discovery announcements and FIPS overlay adverts locally in the browser
- groups results by target `npub`
- ranks matches by announcement count and text relevance
- links each result to `http://<npub>.fips/`
- lets signed-in users re-announce human directory entries with a NIP-07 browser extension

Relay settings and the local search cache are stored in IndexedDB.

## Event Format

The app reads two `kind: 37195` schemas.

### fipstr announcements

Human directory announcements use these tags:

- `["d", "<discriminator>"]`
- `["npub", "<fips-node-npub>"]`
- `["alias", "<node-alias>"]`
- `["service", "<name>", "<port>"]`
- `["transport", "<protocol>", "<addr>", "<port>"]`

Example:

```json
{
  "kind": 37195,
  "content": "",
  "tags": [
    ["d", "iris-client-main"],
    ["npub", "npub1..."],
    ["alias", "Iris Client"],
    ["service", "iris-client", "80"],
    ["transport", "udp", "65.108.194.165", "30001"]
  ]
}
```

The app keeps the latest valid announcement per `(author pubkey, target npub)` pair, prefers a self-announcement as the canonical display record, and counts unique announcers for the visible score.

### FIPS overlay adverts

Machine-authored FIPS daemon adverts use the event author as the node identity and follow the upstream FIPS overlay-advert schema documented in [jmcorgan/fips docs/reference/nostr-events.md](https://github.com/jmcorgan/fips/blob/master/docs/reference/nostr-events.md#kind-37195--overlay-advert).

Overlay adverts are searchable by npub, endpoint, transport, `nat`, `stun`, `tor`, relay URL, and protocol metadata. They are displayed as self-adverts and are not re-announced with browser keys.

## Commands

Install:

```bash
pnpm install
```

Run the dev server:

```bash
pnpm dev
```

Run against the local relay override:

```bash
VITE_USE_LOCAL_RELAY=true pnpm dev
```

Run against the test relay override:

```bash
VITE_USE_TEST_RELAY=true pnpm dev
```

Build:

```bash
pnpm build
```

Preview the production build:

```bash
pnpm preview
```

Run tests:

```bash
pnpm test
```
