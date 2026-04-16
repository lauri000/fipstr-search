import {
  startTransition,
  type ChangeEvent,
  type FormEvent,
  useDeferredValue,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"

import {authService} from "./lib/authService"
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
  const [query, setQuery] = useState("")
  const [showNsecForm, setShowNsecForm] = useState(false)
  const [nsecValue, setNsecValue] = useState("")
  const [publishingTarget, setPublishingTarget] = useState<string | null>(null)
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null)

  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  const authSnapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot)
  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = deferredQuery.trim()
  const results = trimmedQuery ? service.search(trimmedQuery, authSnapshot.pubkey) : []

  useEffect(() => {
    const stop = service.start()
    return stop
  }, [service])

  useEffect(() => {
    if (authSnapshot.status === "authenticated") {
      setShowNsecForm(false)
      setNsecValue("")
    }
  }, [authSnapshot.status])

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

  async function handleNsecSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFlashMessage(null)
    await auth.connectWithNsec(nsecValue)
  }

  function handleLogout() {
    auth.logout()
    setFlashMessage(null)
  }

  async function handleReannounce(targetNpub: string) {
    if (authSnapshot.status !== "authenticated") {
      setFlashMessage({
        tone: "error",
        text: "Connect a signer before re-announcing a node.",
      })

      if (!authSnapshot.extensionAvailable) {
        setShowNsecForm(true)
      }

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

  const statusText = trimmedQuery ? `${results.length} result${results.length === 1 ? "" : "s"}` : snapshot.status

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
        <div className="auth-panel" aria-label="Announcement signer">
          {authSnapshot.status === "authenticated" ? (
            <div className="auth-panel__connected">
              <p className="auth-chip">
                Signed in as <strong>{shortNpub(authSnapshot.npub)}</strong>
              </p>
              <p className="auth-chip auth-chip--muted">{authSnapshot.method === "nip07" ? "NIP-07 signer" : "Session nsec"}</p>
              <button className="auth-button auth-button--secondary" onClick={handleLogout} type="button">
                Log out
              </button>
            </div>
          ) : (
            <div className="auth-panel__actions">
              <button
                className="auth-button"
                disabled={authSnapshot.status === "authenticating" || !authSnapshot.extensionAvailable}
                onClick={handleExtensionLogin}
                type="button"
              >
                {authSnapshot.extensionAvailable ? "Connect with extension" : "No extension detected"}
              </button>
              <button
                className="auth-button auth-button--secondary"
                disabled={authSnapshot.status === "authenticating"}
                onClick={() => setShowNsecForm((current) => !current)}
                type="button"
              >
                Use nsec
              </button>
            </div>
          )}

          {showNsecForm && authSnapshot.status !== "authenticated" ? (
            <form className="auth-panel__nsec" onSubmit={handleNsecSubmit}>
              <label className="visually-hidden" htmlFor="nsec-input">
                Paste an nsec private key
              </label>
              <input
                className="nsec-input"
                id="nsec-input"
                onChange={(event) => setNsecValue(event.target.value)}
                placeholder="nsec1..."
                type="password"
                value={nsecValue}
              />
              <button className="auth-button" disabled={authSnapshot.status === "authenticating" || !nsecValue.trim()} type="submit">
                {authSnapshot.status === "authenticating" ? "Signing in..." : "Connect nsec"}
              </button>
            </form>
          ) : null}
        </div>
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
                  ? "Log in to announce"
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
    </main>
  )
}
