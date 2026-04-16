import {fireEvent, render, screen} from "@testing-library/react"
import {describe, expect, it} from "vitest"

import App from "./App"
import type {DirectoryRuntime, DirectorySearchResult, DirectorySnapshot} from "./lib/types"

const snapshot: DirectorySnapshot = {
  status: "Loaded 1 node announcement from cache",
  hydrated: true,
  syncing: false,
  profilesCount: 1,
  relayCount: 5,
}

const results: DirectorySearchResult[] = [
  {
    id: "a".repeat(64),
    title: "Alpha Relay",
    alias: "Alpha Relay",
    summary: "Services: http:80 · Transports: udp 172.20.0.10:2121",
    services: "http:80",
    transports: "udp 172.20.0.10:2121",
    npub: "npub1alpharelaysample0000000000000000000000000000000000000000000",
    host: "npub1alpharelaysample0000000000000000000000000000000000000000000.fips",
    url: "http://npub1alpharelaysample0000000000000000000000000000000000000000000.fips/",
    score: 10,
  },
]

function makeService(): DirectoryRuntime {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    search: (query) => (query ? results : []),
    start: () => () => undefined,
  }
}

describe("App", () => {
  it("shows cached results without waiting for network and links to the explicit http npub.fips URL", () => {
    render(<App service={makeService()} />)

    expect(screen.queryByRole("link")).toBeNull()

    fireEvent.change(screen.getByRole("searchbox", {name: /search fips discovery announcements/i}), {
      target: {value: "alpha"},
    })

    const link = screen.getByRole("link")

    expect(link).toHaveAttribute(
      "href",
      "http://npub1alpharelaysample0000000000000000000000000000000000000000000.fips/",
    )
    expect(link).toHaveTextContent("npub1alpharelaysample0000000000000000000000000000000000000000000.fips")
    expect(link).toHaveTextContent("Services: http:80")
  })
})
