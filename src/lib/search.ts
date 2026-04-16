import MiniSearch, {type AsPlainObject, type Options} from "minisearch"

import {SEARCH_INDEX_VERSION, type DirectoryProfileRecord, type SearchIndexState, type SearchDocument} from "./types"
import {toSearchDocument} from "./normalize"

export const SEARCH_OPTIONS = {
  fields: ["title", "alias", "summary", "services", "transports", "npub"],
  storeFields: ["title", "alias", "summary", "services", "transports", "npub", "host", "url"],
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

export function createSearchIndex(documents: SearchDocument[] = []) {
  const index = new MiniSearch<SearchDocument>(SEARCH_OPTIONS)

  if (documents.length > 0) {
    index.addAll(documents)
  }

  return index
}

export function buildSearchIndex(profiles: Iterable<DirectoryProfileRecord>) {
  return createSearchIndex(Array.from(profiles, toSearchDocument))
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

export function searchDirectory(index: MiniSearch<SearchDocument>, query: string) {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  return index.search(trimmed, {
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
}
