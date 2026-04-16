import {fireEvent, render, screen} from "@testing-library/react"
import {describe, expect, it, vi} from "vitest"

import App from "./App"
import type {AuthRuntime, AuthSnapshot, DirectoryRuntime, DirectorySearchResult, DirectorySnapshot, PublishSigner} from "./lib/types"

const snapshot: DirectorySnapshot = {
  status: "Loaded 1 node from cache",
  hydrated: true,
  syncing: false,
  nodesCount: 1,
  relayCount: 5,
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

function makeService(): DirectoryRuntime {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    search: (query) => (query ? results : []),
    start: () => () => undefined,
    reannounce: vi.fn(async () => undefined),
  }
}

function makeAuth(snapshotOverride: Partial<AuthSnapshot> = {}): AuthRuntime {
  const snapshotValue: AuthSnapshot = {
    status: "authenticated",
    extensionAvailable: true,
    pubkey: "a".repeat(64),
    npub: "npub1viewer00000000000000000000000000000000000000000000000000",
    method: "nsec",
    ...snapshotOverride,
  }

  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshotValue,
    connectWithExtension: vi.fn(async () => undefined),
    connectWithNsec: vi.fn(async () => undefined),
    getSigner: () =>
      snapshotValue.status === "authenticated"
        ? ({
            method: snapshotValue.method ?? "nsec",
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
    fireEvent.click(screen.getByRole("button", {name: "Log in to announce"}))

    expect(screen.getByText("Connect a signer before re-announcing a node.")).toBeInTheDocument()
  })
})
