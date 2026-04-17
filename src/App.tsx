import {
  startTransition,
  type ChangeEvent,
  type FormEvent,
  useDeferredValue,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react"

import {authService} from "./lib/authService"
import {DEFAULT_RELAYS} from "./lib/defaultRelays"
import {directoryService} from "./lib/directoryService"
import type {AuthRuntime, DirectoryRuntime} from "./lib/types"

type AppProps = {
  service?: DirectoryRuntime
  auth?: AuthRuntime
}

type FlashMessage = {
  tone: "error" | "success"
  text: string
}

const SEARCH_PARAM = "q"

function snippet(text: string, maxLength = 180) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}...`
}

function shortNpub(npub?: string) {
  if (!npub || npub.length < 18) {
    return npub ?? ""
  }

  return `${npub.slice(0, 10)}…${npub.slice(-6)}`
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return "Unknown publishing error"
}

function readQueryFromLocation() {
  if (typeof window === "undefined") {
    return ""
  }

  return new URL(window.location.href).searchParams.get(SEARCH_PARAM) ?? ""
}

function nextSearchUrl(query: string) {
  const url = new URL(window.location.href)
  const normalizedQuery = query.trim()

  if (normalizedQuery) {
    url.searchParams.set(SEARCH_PARAM, normalizedQuery)
  } else {
    url.searchParams.delete(SEARCH_PARAM)
  }

  return `${url.pathname}${url.search}${url.hash}`
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" className="auth-corner__icon" fill="none" viewBox="0 0 24 24">
      <path
        d="M10.34 3.2h3.32l.42 2.02c.43.14.84.31 1.23.51l1.78-1.05 2.35 2.35-1.05 1.78c.2.39.37.8.51 1.23l2.02.42v3.32l-2.02.42c-.14.43-.31.84-.51 1.23l1.05 1.78-2.35 2.35-1.78-1.05c-.39.2-.8.37-1.23.51l-.42 2.02h-3.32l-.42-2.02a8.13 8.13 0 0 1-1.23-.51l-1.78 1.05-2.35-2.35 1.05-1.78a8.13 8.13 0 0 1-.51-1.23l-2.02-.42v-3.32l2.02-.42c.14-.43.31-.84.51-1.23L4.68 7.03l2.35-2.35 1.78 1.05c.39-.2.8-.37 1.23-.51l.3-2.02ZM12 9.1a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="auth-corner__icon" fill="none" viewBox="0 0 24 24">
      <path
        d="M15 6l-6 6 6 6M9 12h10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg aria-hidden="true" className="auth-corner__icon" fill="none" viewBox="0 0 24 24">
      <path
        d="M10 6H6.75A1.75 1.75 0 0 0 5 7.75v8.5C5 17.22 5.78 18 6.75 18H10M14 8l4 4-4 4M18 12H9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export default function App({service = directoryService, auth = authService}: AppProps) {
  const [view, setView] = useState<"search" | "settings">("search")
  const [query, setQuery] = useState(readQueryFromLocation)
  const [relayDraft, setRelayDraft] = useState("")
  const [savingRelays, setSavingRelays] = useState(false)
  const [publishingTarget, setPublishingTarget] = useState<string | null>(null)
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null)
  const authLabelId = useId()

  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  const authSnapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot)
  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = deferredQuery.trim()
  const results = trimmedQuery ? service.search(trimmedQuery, authSnapshot.pubkey) : []
  const searchActive = view === "search" && Boolean(trimmedQuery)

  useEffect(() => {
    const stop = service.start()
    return stop
  }, [service])

  useEffect(() => {
    function handlePopState() {
      startTransition(() => {
        setQuery((current) => {
          const next = readQueryFromLocation()
          return current === next ? current : next
        })
      })
    }

    window.addEventListener("popstate", handlePopState)

    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [])

  useEffect(() => {
    const nextUrl = nextSearchUrl(query)
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`

    if (currentUrl !== nextUrl) {
      window.history.replaceState(window.history.state, "", nextUrl)
    }
  }, [query])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value

    startTransition(() => {
      setQuery(nextValue)
    })
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
  }

  async function handleExtensionLogin() {
    setFlashMessage(null)
    await auth.connectWithExtension()
  }

  function handleOpenSettings() {
    setRelayDraft(snapshot.relays.join("\n"))
    setFlashMessage(null)
    setView("settings")
  }

  function handleCloseSettings() {
    setRelayDraft(snapshot.relays.join("\n"))
    setFlashMessage(null)
    setView("search")
  }

  function handleResetRelays() {
    setRelayDraft(DEFAULT_RELAYS.join("\n"))
  }

  function handleLogout() {
    auth.logout()
    setFlashMessage(null)
  }

  async function handleReannounce(targetNpub: string) {
    if (authSnapshot.status !== "authenticated") {
      setFlashMessage({
        tone: "error",
        text: "Connect your browser extension before re-announcing a node.",
      })
      return
    }

    const signer = auth.getSigner()

    if (!signer) {
      setFlashMessage({
        tone: "error",
        text: "Your signer session is no longer available. Log in again.",
      })
      return
    }

    setPublishingTarget(targetNpub)
    setFlashMessage(null)

    try {
      await service.reannounce(targetNpub, signer)
      setFlashMessage({
        tone: "success",
        text: `Published a re-announcement for ${shortNpub(targetNpub)}.`,
      })
    } catch (error) {
      setFlashMessage({
        tone: "error",
        text: errorMessage(error),
      })
    } finally {
      setPublishingTarget(null)
    }
  }

  async function handleRelaySave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingRelays(true)
    setFlashMessage(null)

    const nextRelays = relayDraft
      .split(/\r?\n/u)
      .map((relay) => relay.trim())
      .filter(Boolean)

    try {
      await service.updateRelays(nextRelays)
      setRelayDraft(nextRelays.join("\n"))
      setFlashMessage({
        tone: "success",
        text: `Saved ${nextRelays.length} relay${nextRelays.length === 1 ? "" : "s"}.`,
      })
    } catch (error) {
      setFlashMessage({
        tone: "error",
        text: errorMessage(error),
      })
    } finally {
      setSavingRelays(false)
    }
  }

  const statusText = trimmedQuery ? `${results.length} result${results.length === 1 ? "" : "s"}` : snapshot.status

  return (
    <main className={`app ${searchActive ? "app--active" : ""}`}>
      <div aria-labelledby={authLabelId} className="auth-corner" role="group">
        <span className="visually-hidden" id={authLabelId}>
          Extension login
        </span>
        {authSnapshot.status === "authenticated" ? (
          <div className="auth-corner__session">
            <p className="auth-corner__identity" title={authSnapshot.npub}>
              <span aria-hidden="true" className="auth-corner__status-dot" />
              <span className="auth-corner__identity-text">{shortNpub(authSnapshot.npub)}</span>
            </p>
            <button
              aria-label="Log out"
              className="auth-corner__button auth-corner__button--secondary auth-corner__button--icon"
              onClick={handleLogout}
              type="button"
            >
              <LogoutIcon />
            </button>
          </div>
        ) : (
          <button
            aria-label="Connect browser extension"
            className="auth-corner__button"
            disabled={authSnapshot.status === "authenticating"}
            onClick={handleExtensionLogin}
            type="button"
          >
            {authSnapshot.status === "authenticating" ? "Connecting..." : "nostr extension"}
          </button>
        )}
        <button
          aria-label={view === "settings" ? "Close settings" : "Open settings"}
          className="auth-corner__button auth-corner__button--secondary auth-corner__button--icon"
          onClick={view === "settings" ? handleCloseSettings : handleOpenSettings}
          type="button"
        >
          {view === "settings" ? <BackIcon /> : <SettingsIcon />}
        </button>
      </div>
      {view === "settings" ? (
        <section className="settings-shell" aria-label="Relay settings">
          <p className="brand brand--settings">Relay Settings</p>
          <p className="settings-copy">Choose which relays the discovery indexer should watch. Use one relay URL per line.</p>
          <form className="settings-form" onSubmit={handleRelaySave}>
            <label className="visually-hidden" htmlFor="relay-list">
              Relay list
            </label>
            <textarea
              className="relay-textarea"
              id="relay-list"
              onChange={(event) => setRelayDraft(event.target.value)}
              spellCheck={false}
              value={relayDraft}
            />
            <div className="settings-actions">
              <button className="settings-button settings-button--secondary" onClick={handleResetRelays} type="button">
                Reset defaults
              </button>
              <button className="settings-button" disabled={savingRelays} type="submit">
                {savingRelays ? "Saving..." : "Save relays"}
              </button>
            </div>
          </form>
          <p className="status">Currently watching {snapshot.relayCount} relay{snapshot.relayCount === 1 ? "" : "s"}.</p>
          {snapshot.error ? <p className="status status--error">{snapshot.error}</p> : null}
          {authSnapshot.error ? <p className="status status--error">{authSnapshot.error}</p> : null}
          {flashMessage ? <p className={`status ${flashMessage.tone === "error" ? "status--error" : "status--success"}`}>{flashMessage.text}</p> : null}
        </section>
      ) : (
        <>
          <section className="search-shell" aria-label="Search FIPS nodes">
            <p className="brand brand--wordmark">
              <img alt="" aria-hidden="true" className="brand__mark" src="/fipstr-mark.svg" />
              <span className="brand__label">fipstr</span>
              <span className="brand__pill">search</span>
            </p>
            <form action="/" className="search-form" method="get" onSubmit={handleSearchSubmit} role="search">
              <label className="visually-hidden" htmlFor="node-search">
                Search FIPS discovery announcements
              </label>
              <input
                id="node-search"
                autoComplete="off"
                autoFocus
                className="search-input"
                name={SEARCH_PARAM}
                onChange={handleChange}
                placeholder="Search by alias, service, transport, or npub"
                type="search"
                value={query}
              />
            </form>
            <p className="status">{statusText}</p>
            {snapshot.error ? <p className="status status--error">{snapshot.error}</p> : null}
            {authSnapshot.error ? <p className="status status--error">{authSnapshot.error}</p> : null}
            {flashMessage ? <p className={`status ${flashMessage.tone === "error" ? "status--error" : "status--success"}`}>{flashMessage.text}</p> : null}
          </section>

          {trimmedQuery ? (
            <section className="results" aria-label="Search results">
              {results.length > 0 ? (
                results.map((result) => {
                  const announceLabel =
                    authSnapshot.status !== "authenticated"
                      ? "Connect to announce"
                      : result.announcedByViewer
                        ? "Announce again"
                        : "Re-announce"

                  return (
                    <article className="result-card" key={result.id}>
                      <div className="result-card__header">
                        <a className="result-card__host" href={result.url}>
                          {result.host}
                        </a>
                        <p className="result-card__score">{result.announcementCount} announced</p>
                      </div>
                      <a className="result-card__title-link" href={result.url}>
                        <h2 className="result-card__title">{result.title}</h2>
                      </a>
                      {result.summary ? <p className="result-card__about">{snippet(result.summary)}</p> : null}
                      <div className="result-card__footer">
                        {result.announcedByViewer ? <p className="result-card__badge">You announced this</p> : <span />}
                        <button
                          className="announce-button"
                          disabled={publishingTarget === result.npub}
                          onClick={() => void handleReannounce(result.npub)}
                          type="button"
                        >
                          {publishingTarget === result.npub ? "Publishing..." : announceLabel}
                        </button>
                      </div>
                    </article>
                  )
                })
              ) : (
                <p className="empty-state">No matching node announcements.</p>
              )}
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}
