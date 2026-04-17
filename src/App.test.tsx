import {fireEvent, render, screen} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import App from "./App"
import type {AuthRuntime, AuthSnapshot, DirectoryRuntime, DirectorySearchResult, DirectorySnapshot, PublishSigner} from "./lib/types"

const snapshot: DirectorySnapshot = {
  status: "Loaded 1 node from cache",
  hydrated: true,
  syncing: false,
  nodesCount: 1,
  relayCount: 5,
  relays: ["wss://temp.iris.to/", "wss://vault.iris.to/"],
}

const results: DirectorySearchResult[] = [
  {
    id: "npub1alpharelaysample0000000000000000000000000000000000000000000",
    title: "Alpha Relay",
    alias: "Alpha Relay",
    summary: "Services: http:80 · Transports: udp 172.20.0.10:2121",
    services: "http:80",
    transports: "udp 172.20.0.10:2121",
    npub: "npub1alpharelaysample0000000000000000000000000000000000000000000",
    host: "npub1alpharelaysample0000000000000000000000000000000000000000000.fips",
    url: "http://npub1alpharelaysample0000000000000000000000000000000000000000000.fips/",
    score: 10,
    announcementCount: 3,
    announcedByViewer: true,
  },
]

function makeService(updateRelays = vi.fn(async () => undefined)): DirectoryRuntime {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    search: (query) => (query ? results : []),
    start: () => () => undefined,
    reannounce: vi.fn(async () => undefined),
    updateRelays,
  }
}

function makeAuth(snapshotOverride: Partial<AuthSnapshot> = {}): AuthRuntime {
  const snapshotValue: AuthSnapshot = {
    status: "authenticated",
    extensionAvailable: true,
    pubkey: "a".repeat(64),
    npub: "npub1viewer00000000000000000000000000000000000000000000000000",
    method: "nip07",
    ...snapshotOverride,
  }

  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshotValue,
    connectWithExtension: vi.fn(async () => undefined),
    getSigner: () =>
      snapshotValue.status === "authenticated"
        ? ({
            method: snapshotValue.method ?? "nip07",
            pubkey: snapshotValue.pubkey!,
            npub: snapshotValue.npub!,
            signEvent: vi.fn(async () => {
              throw new Error("not used")
            }),
          } satisfies PublishSigner)
        : null,
    logout: vi.fn(),
  }
}

describe("App", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/")
  })

  afterEach(() => {
    window.history.replaceState({}, "", "/")
  })

  it("opens settings and saves relay updates through the service", () => {
    const updateRelays = vi.fn(async () => undefined)
    render(<App auth={makeAuth()} service={makeService(updateRelays)} />)

    fireEvent.click(screen.getByRole("button", {name: "Open settings"}))
    fireEvent.change(screen.getByLabelText(/relay list/i), {
      target: {value: "wss://relay.one/\nwss://relay.two/"},
    })
    fireEvent.submit(screen.getByRole("button", {name: "Save relays"}).closest("form")!)

    expect(updateRelays).toHaveBeenCalledWith(["wss://relay.one/", "wss://relay.two/"])
  })

  it("shows grouped results with score, viewer state, and an explicit http npub.fips link", () => {
    render(<App auth={makeAuth()} service={makeService()} />)

    fireEvent.change(screen.getByRole("searchbox", {name: /search fips discovery announcements/i}), {
      target: {value: "alpha"},
    })

    const link = screen.getByRole("link", {name: /npub1alpharelaysample/i})

    expect(link).toHaveAttribute(
      "href",
      "http://npub1alpharelaysample0000000000000000000000000000000000000000000.fips/",
    )
    expect(screen.getByText("3 announced")).toBeInTheDocument()
    expect(screen.getByText("You announced this")).toBeInTheDocument()
    expect(screen.getByRole("button", {name: "Announce again"})).toBeInTheDocument()
  })

  it("hydrates the search box from the q query param and keeps the URL in sync", () => {
    window.history.replaceState({}, "", "/?q=alpha")

    render(<App auth={makeAuth()} service={makeService()} />)

    const input = screen.getByRole("searchbox", {name: /search fips discovery announcements/i})

    expect(input).toHaveValue("alpha")
    expect(screen.getByText("Alpha Relay")).toBeInTheDocument()

    fireEvent.change(input, {
      target: {value: "beta relay"},
    })

    expect(window.location.search).toBe("?q=beta+relay")
  })

  it("updates the search query when browser history changes", () => {
    render(<App auth={makeAuth()} service={makeService()} />)

    const input = screen.getByRole("searchbox", {name: /search fips discovery announcements/i})

    window.history.replaceState({}, "", "/?q=alpha")
    fireEvent.popState(window)

    expect(input).toHaveValue("alpha")
  })

  it("prompts logged-out users to connect before announcing", () => {
    render(
      <App
        auth={makeAuth({
          status: "anonymous",
          pubkey: undefined,
          npub: undefined,
          method: undefined,
        })}
        service={makeService()}
      />,
    )

    fireEvent.change(screen.getByRole("searchbox", {name: /search fips discovery announcements/i}), {
      target: {value: "alpha"},
    })
    fireEvent.click(screen.getByRole("button", {name: "Connect to announce"}))

    expect(screen.getByText("Connect your browser extension before re-announcing a node.")).toBeInTheDocument()
  })
})
