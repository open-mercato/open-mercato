export function buildHrefWithReturnTo(href: string, returnTo?: string | null): string {
  const normalizedHref = typeof href === 'string' ? href.trim() : ''
  const normalizedReturnTo = typeof returnTo === 'string' ? returnTo.trim() : ''

  if (!normalizedHref.length || !normalizedReturnTo.length) {
    return normalizedHref
  }

  const hashIndex = normalizedHref.indexOf('#')
  const baseHref = hashIndex >= 0 ? normalizedHref.slice(0, hashIndex) : normalizedHref
  const hash = hashIndex >= 0 ? normalizedHref.slice(hashIndex) : ''

  const queryIndex = baseHref.indexOf('?')
  const pathname = queryIndex >= 0 ? baseHref.slice(0, queryIndex) : baseHref
  const query = queryIndex >= 0 ? baseHref.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)

  if (!params.has('returnTo')) {
    params.set('returnTo', normalizedReturnTo)
  }

  const nextQuery = params.toString()
  return `${pathname}${nextQuery.length ? `?${nextQuery}` : ''}${hash}`
}
