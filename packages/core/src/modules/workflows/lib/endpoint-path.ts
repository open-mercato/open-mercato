/**
 * Workflows Module - pure endpoint-path helpers (issue #4235).
 *
 * Shared between the EndpointPicker component (browser) and the server-side
 * CALL_API output-contract lookup: matching a CALL_API `endpoint` config
 * value against catalog template paths (`/api/customers/people/{id}`) and
 * composing an endpoint string from typed parameter values. PURE — no React,
 * no ORM, no DI, no registry imports.
 *
 * Values are treated as opaque text: `{{...}}` interpolation pills and
 * unfilled `{param}` placeholders both match a template's parameter segments,
 * and query values are never URL-encoded so pills survive round-trips.
 */

export interface EndpointValueParts {
  path: string
  query: Record<string, string>
}

export interface EndpointTemplateMatch {
  pathParams: Record<string, string>
}

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

export function splitEndpointValue(value: string): EndpointValueParts {
  const trimmed = value.trim()
  const queryIndex = trimmed.indexOf('?')
  const path = stripTrailingSlash(queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex))
  const query: Record<string, string> = {}
  if (queryIndex !== -1) {
    const rawQuery = trimmed.slice(queryIndex + 1)
    for (const pair of rawQuery.split('&')) {
      if (pair.length === 0) continue
      const equalsIndex = pair.indexOf('=')
      const key = equalsIndex === -1 ? pair : pair.slice(0, equalsIndex)
      if (key.length === 0) continue
      query[key] = equalsIndex === -1 ? '' : pair.slice(equalsIndex + 1)
    }
  }
  return { path, query }
}

function templateParamName(segment: string): string | null {
  if (segment.length > 2 && segment.startsWith('{') && segment.endsWith('}')) {
    return segment.slice(1, -1)
  }
  return null
}

export function matchEndpointTemplate(endpointPath: string, templatePath: string): EndpointTemplateMatch | null {
  const valueSegments = stripTrailingSlash(endpointPath.trim()).split('/')
  const templateSegments = stripTrailingSlash(templatePath.trim()).split('/')
  if (valueSegments.length !== templateSegments.length) return null
  const pathParams: Record<string, string> = {}
  for (let index = 0; index < templateSegments.length; index += 1) {
    const templateSegment = templateSegments[index]
    const valueSegment = valueSegments[index]
    const paramName = templateParamName(templateSegment)
    if (paramName !== null) {
      if (valueSegment.length === 0) return null
      pathParams[paramName] = valueSegment === `{${paramName}}` ? '' : valueSegment
      continue
    }
    if (templateSegment !== valueSegment) return null
  }
  return { pathParams }
}

export interface MatchableEndpoint {
  path: string
  method: string
}

function templateParamCount(templatePath: string): number {
  let count = 0
  for (const segment of templatePath.split('/')) {
    if (templateParamName(segment) !== null) count += 1
  }
  return count
}

/**
 * Finds the catalog endpoint a CALL_API endpoint value points at. Exact
 * literal matches win; otherwise the template with the fewest parameter
 * segments wins, ties broken by path order, so `/api/a/{id}` beats
 * `/api/{x}/{y}` deterministically.
 */
export function findMatchingEndpoint<T extends MatchableEndpoint>(
  endpointValue: string,
  method: string,
  items: T[],
): { item: T; match: EndpointTemplateMatch } | null {
  const { path } = splitEndpointValue(endpointValue)
  if (path.length === 0) return null
  const normalizedMethod = method.trim().toUpperCase()
  const candidates: Array<{ item: T; match: EndpointTemplateMatch; paramCount: number }> = []
  for (const item of items) {
    if (item.method.toUpperCase() !== normalizedMethod) continue
    const match = matchEndpointTemplate(path, item.path)
    if (!match) continue
    candidates.push({ item, match, paramCount: templateParamCount(item.path) })
  }
  if (candidates.length === 0) return null
  candidates.sort((left, right) => {
    if (left.paramCount !== right.paramCount) return left.paramCount - right.paramCount
    return left.item.path.localeCompare(right.item.path)
  })
  const best = candidates[0]
  return { item: best.item, match: best.match }
}

export function composeEndpointValue(
  templatePath: string,
  pathParams: Record<string, string>,
  queryParams: Record<string, string>,
): string {
  const path = stripTrailingSlash(templatePath.trim())
    .split('/')
    .map((segment) => {
      const paramName = templateParamName(segment)
      if (paramName === null) return segment
      const value = pathParams[paramName]
      return typeof value === 'string' && value.length > 0 ? value : segment
    })
    .join('/')
  const queryEntries = Object.entries(queryParams).filter(([key, value]) => key.length > 0 && value.length > 0)
  if (queryEntries.length === 0) return path
  const query = queryEntries.map(([key, value]) => `${key}=${value}`).join('&')
  return `${path}?${query}`
}
