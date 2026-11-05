import type { SearchResult } from '../types'

export function looksLikeEncryptedSearchValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (!value.includes(':')) return false

  const parts = value.split(':')
  return parts.length >= 3 && parts[parts.length - 1] === 'v1'
}

export function needsSearchResultEnrichment(result: SearchResult): boolean {
  if (!result.presenter?.title) return true
  if (looksLikeEncryptedSearchValue(result.presenter.title)) return true
  if (looksLikeEncryptedSearchValue(result.presenter.subtitle)) return true
  if (!result.url && (!result.links || result.links.length === 0)) return true
  return false
}
