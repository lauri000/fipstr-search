import {startTransition, type ChangeEvent, useDeferredValue, useEffect, useState, useSyncExternalStore} from "react"

import {directoryService} from "./lib/directoryService"
import type {DirectoryRuntime} from "./lib/types"

type AppProps = {
  service?: DirectoryRuntime
}

function snippet(text: string, maxLength = 180) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}...`
}

export default function App({service = directoryService}: AppProps) {
  const [query, setQuery] = useState("")
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = deferredQuery.trim()
  const results = trimmedQuery ? service.search(trimmedQuery) : []

  useEffect(() => {
    const stop = service.start()
    return stop
  }, [service])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value

    startTransition(() => {
      setQuery(nextValue)
    })
  }

  const statusText = trimmedQuery
    ? `${results.length} result${results.length === 1 ? "" : "s"}`
    : snapshot.status

  return (
    <main className={`app ${trimmedQuery ? "app--active" : ""}`}>
      <section className="search-shell" aria-label="Search FIPS nodes">
        <p className="brand">FIPS Node Search</p>
        <label className="visually-hidden" htmlFor="node-search">
          Search FIPS discovery announcements
        </label>
        <input
          id="node-search"
          autoComplete="off"
          autoFocus
          className="search-input"
          name="node-search"
          onChange={handleChange}
          placeholder="Search by alias, service, transport, or npub"
          type="search"
          value={query}
        />
        <p className="status">{statusText}</p>
        {snapshot.error ? <p className="status status--error">{snapshot.error}</p> : null}
      </section>

      {trimmedQuery ? (
        <section className="results" aria-label="Search results">
          {results.length > 0 ? (
            results.map((result) => (
              <a className="result-card" href={result.url} key={result.id}>
                <p className="result-card__host">{result.host}</p>
                <h2 className="result-card__title">{result.title}</h2>
                {result.summary ? <p className="result-card__about">{snippet(result.summary)}</p> : null}
              </a>
            ))
          ) : (
            <p className="empty-state">No matching node announcements.</p>
          )}
        </section>
      ) : null}
    </main>
  )
}
