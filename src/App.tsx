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

export default function App({service = directoryService, auth = authService}: AppProps) {
  const [view, setView] = useState<"search" | "settings">("search")
  const [query, setQuery] = useState("")
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

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value

    startTransition(() => {
      setQuery(nextValue)
    })
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
          <>
            <p className="auth-corner__identity">Connected {shortNpub(authSnapshot.npub)}</p>
            <button className="auth-corner__button auth-corner__button--secondary" onClick={handleLogout} type="button">
              Log out
            </button>
          </>
        ) : (
          <button
            aria-label={authSnapshot.extensionAvailable ? "Connect browser extension" : "Browser extension not detected"}
            className="auth-corner__button"
            disabled={authSnapshot.status === "authenticating" || !authSnapshot.extensionAvailable}
            onClick={handleExtensionLogin}
            type="button"
          >
            {authSnapshot.status === "authenticating"
              ? "Connecting..."
              : authSnapshot.extensionAvailable
                ? "Connect"
                : "No extension"}
          </button>
        )}
        <button className="auth-corner__button auth-corner__button--secondary" onClick={view === "settings" ? handleCloseSettings : handleOpenSettings} type="button">
          {view === "settings" ? "Back" : "Settings"}
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
