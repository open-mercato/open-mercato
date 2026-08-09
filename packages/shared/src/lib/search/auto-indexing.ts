import { parseBooleanToken } from '../boolean'

/**
 * Module id backing the tenant-scoped vector auto-indexing switch. Kept as `vector`
 * (rather than `search`) for backwards compatibility with rows written before the
 * search module absorbed the vector settings.
 */
export const SEARCH_AUTO_INDEX_CONFIG_MODULE = 'vector'
export const SEARCH_AUTO_INDEX_CONFIG_KEY = 'auto_index_enabled'

/**
 * Instance-wide kill switch for vector auto-indexing. Lives in `@open-mercato/shared`
 * so consumers outside `@open-mercato/search` (for example the query index status page)
 * can report vector coverage honestly without duplicating the env-var contract.
 */
export function envDisablesAutoIndexing(): boolean {
  const raw =
    process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING ??
    process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
  if (!raw) return false
  return parseBooleanToken(raw) === true
}
