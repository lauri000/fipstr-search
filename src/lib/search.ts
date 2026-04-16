import MiniSearch, {type AsPlainObject, type Options} from "minisearch"

import {SEARCH_INDEX_VERSION, type DirectoryNodeRecord, type SearchIndexState, type SearchDocument} from "./types"
import {toSearchDocument} from "./normalize"

export const SEARCH_OPTIONS = {
  fields: ["title", "alias", "summary", "services", "transports", "npub"],
  storeFields: ["title", "alias", "summary", "services", "transports", "npub", "host", "url", "announcementCount"],
  searchOptions: {
    boost: {
      title: 4,
      alias: 4,
      services: 3,
      npub: 2,
      transports: 2,
    },
    prefix: true,
  },
} satisfies Options<SearchDocument>

type StoredSearchResult = SearchDocument & {
  score: number
}

export function createSearchIndex(documents: SearchDocument[] = []) {
  const index = new MiniSearch<SearchDocument>(SEARCH_OPTIONS)

  if (documents.length > 0) {
    index.addAll(documents)
  }

  return index
}

export function buildSearchIndex(nodes: Iterable<DirectoryNodeRecord>) {
  return createSearchIndex(Array.from(nodes, toSearchDocument))
}

export function serializeSearchIndex(index: MiniSearch<SearchDocument>, docCount: number): SearchIndexState {
  return {
    version: SEARCH_INDEX_VERSION,
    indexJson: index.toJSON(),
    updatedAt: Date.now(),
    docCount,
  }
}

export function loadSearchIndex(savedState?: SearchIndexState) {
  if (!savedState || savedState.version !== SEARCH_INDEX_VERSION) {
    return createSearchIndex()
  }

  try {
    return MiniSearch.loadJS(savedState.indexJson as AsPlainObject, SEARCH_OPTIONS)
  } catch {
    return createSearchIndex()
  }
}

function sortResults(a: StoredSearchResult, b: StoredSearchResult) {
  if (a.announcementCount !== b.announcementCount) {
    return b.announcementCount - a.announcementCount
  }

  if (a.score !== b.score) {
    return b.score - a.score
  }

  const titleCompare = a.title.localeCompare(b.title)

  if (titleCompare !== 0) {
    return titleCompare
  }

  return a.npub.localeCompare(b.npub)
}

export function searchDirectory(index: MiniSearch<SearchDocument>, query: string) {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  const rawResults = index.search(trimmed, {
    prefix: trimmed.length >= 2,
    fuzzy: trimmed.length > 3 ? 0.2 : false,
    boost: {
      title: 4,
      alias: 4,
      services: 3,
      npub: 2,
      transports: 2,
    },
  })

  return (rawResults as unknown as StoredSearchResult[]).sort(sortResults)
}
