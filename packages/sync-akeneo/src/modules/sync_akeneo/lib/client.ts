import { dedupeStrings, labelFromLocalizedRecord, safeRecord, type AkeneoAttribute, type AkeneoAttributeOption, type AkeneoCategory, type AkeneoChannel, type AkeneoCredentialShape, type AkeneoFamily, type AkeneoFamilyVariant, type AkeneoLocale, type AkeneoProduct, type AkeneoProductModel } from './shared'

type TokenState = {
  accessToken: string
  refreshToken?: string | null
  expiresAt: number
}

type AkeneoListResponse<T> = {
  _embedded?: {
    items?: T[]
  }
  _links?: {
    next?: {
      href?: string
    }
  }
  items_count?: number
}

type AkeneoMediaFile = {
  code: string
  original_filename?: string | null
  mime_type?: string | null
  size?: number | null
  extension?: string | null
  _links?: {
    download?: {
      href?: string
    }
  }
}

type AkeneoClient = ReturnType<typeof createAkeneoClient>

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/g, '')
}

export function normalizeAkeneoDateTime(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')
  const hours = String(parsed.getUTCHours()).padStart(2, '0')
  const minutes = String(parsed.getUTCMinutes()).padStart(2, '0')
  const seconds = String(parsed.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function encodeAkeneoPathParam(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function sanitizeAkeneoProductNextUrl(nextUrl: string): string {
  let url: URL
  try {
    url = new URL(nextUrl)
  } catch {
    return nextUrl
  }

  const rawSearch = url.searchParams.get('search')
  if (!rawSearch) {
    return url.toString()
  }

  try {
    const parsed = JSON.parse(rawSearch) as Record<string, unknown>
    const updatedFilters = Array.isArray(parsed.updated) ? parsed.updated : []
    const sanitizedUpdated = updatedFilters
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const record = entry as Record<string, unknown>
        const normalizedValue = normalizeAkeneoDateTime(
          typeof record.value === 'string' ? record.value : null,
        )
        if (!normalizedValue) return null
        return {
          ...record,
          value: normalizedValue,
        }
      })
      .filter((entry) => entry !== null) as Record<string, unknown>[]

    if (sanitizedUpdated.length === 0) {
      delete parsed.updated
    } else {
      parsed.updated = sanitizedUpdated
    }

    if (Object.keys(parsed).length === 0) {
      url.searchParams.delete('search')
    } else {
      url.searchParams.set('search', JSON.stringify(parsed))
    }
    return url.toString()
  } catch {
    return nextUrl
  }
}

function coerceCredentials(credentials: Record<string, unknown>): AkeneoCredentialShape {
  const apiUrl = typeof credentials.apiUrl === 'string' ? credentials.apiUrl.trim() : ''
  const clientId = typeof credentials.clientId === 'string' ? credentials.clientId.trim() : ''
  const clientSecret = typeof credentials.clientSecret === 'string' ? credentials.clientSecret : ''
  const username = typeof credentials.username === 'string' ? credentials.username.trim() : ''
  const password = typeof credentials.password === 'string' ? credentials.password : ''
  if (!apiUrl || !clientId || !clientSecret || !username || !password) {
    throw new Error('Akeneo credentials are incomplete')
  }
  return {
    apiUrl: normalizeBaseUrl(apiUrl),
    clientId,
    clientSecret,
    username,
    password,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createAkeneoClient(credentialsInput: Record<string, unknown>) {
  const credentials = coerceCredentials(credentialsInput)
  let tokenState: TokenState | null = null
  let lastAttributeOptionRequestAt = 0
  const familyCache = new Map<string, Promise<AkeneoFamily | null>>()
  const familyVariantCache = new Map<string, Promise<AkeneoFamilyVariant | null>>()
  const productModelCache = new Map<string, Promise<AkeneoProductModel | null>>()
  const attributeCache = new Map<string, Promise<AkeneoAttribute | null>>()
  const categoryCache = new Map<string, Promise<AkeneoCategory | null>>()
  const mediaFileCache = new Map<string, Promise<AkeneoMediaFile | null>>()

  async function acquirePasswordGrantToken(): Promise<TokenState> {
    const response = await fetch(`${credentials.apiUrl}/api/oauth/v1/token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'password',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        username: credentials.username,
        password: credentials.password,
      }),
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Akeneo authentication failed (${response.status}): ${message}`)
    }

    const payload = await response.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!payload.access_token) {
      throw new Error('Akeneo authentication did not return an access token')
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: Date.now() + ((payload.expires_in ?? 3600) * 1000) - 10_000,
    }
  }

  async function refreshAccessToken(current: TokenState): Promise<TokenState> {
    if (!current.refreshToken) return acquirePasswordGrantToken()
    const response = await fetch(`${credentials.apiUrl}/api/oauth/v1/token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: current.refreshToken,
      }),
    })

    if (!response.ok) {
      return acquirePasswordGrantToken()
    }

    const payload = await response.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!payload.access_token) return acquirePasswordGrantToken()
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? current.refreshToken ?? null,
      expiresAt: Date.now() + ((payload.expires_in ?? 3600) * 1000) - 10_000,
    }
  }

  async function ensureToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && tokenState && tokenState.expiresAt > Date.now()) {
      return tokenState.accessToken
    }
    tokenState = tokenState ? await refreshAccessToken(tokenState) : await acquirePasswordGrantToken()
    return tokenState.accessToken
  }

  async function request<T>(
    pathOrUrl: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<T> {
    const token = await ensureToken()
    const url = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
      ? pathOrUrl
      : `${credentials.apiUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`

    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    })

    if (response.status === 401 && !retried) {
      await ensureToken(true)
      return request<T>(pathOrUrl, init, true)
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '1')
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000)
      return request<T>(pathOrUrl, init, retried)
    }

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Akeneo request failed (${response.status}): ${body}`)
    }

    if (response.status === 204) {
      return null as T
    }

    return response.json() as Promise<T>
  }

  async function requestBinary(
    pathOrUrl: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<{
    buffer: Buffer
    contentType: string | null
    contentLength: number | null
  }> {
    const token = await ensureToken()
    const url = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
      ? pathOrUrl
      : `${credentials.apiUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`

    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    })

    if (response.status === 401 && !retried) {
      await ensureToken(true)
      return requestBinary(pathOrUrl, init, true)
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '1')
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000)
      return requestBinary(pathOrUrl, init, retried)
    }

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Akeneo request failed (${response.status}): ${body}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type'),
      contentLength: Number(response.headers.get('content-length') ?? '') || arrayBuffer.byteLength || null,
    }
  }

  function buildUrl(path: string, params: Record<string, string | number | boolean | undefined | null>): string {
    const url = new URL(`${credentials.apiUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  async function readList<T>(pathOrUrl: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<{
    items: T[]
    nextUrl: string | null
    totalEstimate: number | null
  }> {
    const payload = await request<AkeneoListResponse<T>>(
      params ? buildUrl(pathOrUrl, params) : pathOrUrl,
    )
    return {
      items: Array.isArray(payload?._embedded?.items) ? payload._embedded.items : [],
      nextUrl: typeof payload?._links?.next?.href === 'string' ? payload._links.next.href : null,
      totalEstimate: typeof payload?.items_count === 'number' ? payload.items_count : null,
    }
  }

  async function countProducts(updatedAfter?: string | null): Promise<number | null> {
    const params: Record<string, string | number | boolean | undefined | null> = {
      limit: 1,
      pagination_type: 'page',
      with_count: true,
    }
    const normalizedUpdatedAfter = normalizeAkeneoDateTime(updatedAfter)
    if (normalizedUpdatedAfter) {
      params.search = JSON.stringify({
        updated: [
          {
            operator: '>',
            value: normalizedUpdatedAfter,
          },
        ],
      })
    }

    const page = await readList<AkeneoProduct>('/api/rest/v1/products-uuid', params)
    return page.totalEstimate
  }

  async function getSystemProbe(): Promise<{ version: string | null }> {
    try {
      const result = await request<Record<string, unknown>>('/api/rest/v1/system-information')
      return {
        version: typeof result.pim_version === 'string' ? result.pim_version : null,
      }
    } catch {
      const attrs = await readList<AkeneoAttribute>('/api/rest/v1/attributes', {
        limit: 1,
        pagination_type: 'page',
      })
      return { version: attrs.items.length >= 0 ? null : null }
    }
  }

  async function listProducts(options: {
    nextUrl?: string | null
    batchSize: number
    updatedAfter?: string | null
  }): Promise<{ items: AkeneoProduct[]; nextUrl: string | null; totalEstimate: number | null }> {
    if (options.nextUrl) {
      const page = await readList<AkeneoProduct>(sanitizeAkeneoProductNextUrl(options.nextUrl))
      return {
        ...page,
        nextUrl: page.nextUrl ? sanitizeAkeneoProductNextUrl(page.nextUrl) : null,
      }
    }
    const params: Record<string, string | number | boolean | undefined | null> = {
      limit: Math.min(Math.max(options.batchSize, 1), 100),
      pagination_type: 'search_after',
      with_count: false,
    }
    const normalizedUpdatedAfter = normalizeAkeneoDateTime(options.updatedAfter)
    if (normalizedUpdatedAfter) {
      params.search = JSON.stringify({
        updated: [
          {
            operator: '>',
            value: normalizedUpdatedAfter,
          },
        ],
      })
    }
    const [page, totalEstimate] = await Promise.all([
      readList<AkeneoProduct>('/api/rest/v1/products-uuid', params),
      countProducts(normalizedUpdatedAfter).catch(() => null),
    ])
    return {
      ...page,
      totalEstimate: totalEstimate ?? page.totalEstimate,
      nextUrl: page.nextUrl ? sanitizeAkeneoProductNextUrl(page.nextUrl) : null,
    }
  }

  async function listCategories(nextUrl?: string | null, batchSize = 100): Promise<{ items: AkeneoCategory[]; nextUrl: string | null; totalEstimate: number | null }> {
    if (nextUrl) return readList<AkeneoCategory>(nextUrl)
    return readList<AkeneoCategory>('/api/rest/v1/categories', {
      limit: Math.min(Math.max(batchSize, 1), 100),
      pagination_type: 'page',
      with_count: true,
    })
  }

  async function listAttributes(nextUrl?: string | null, batchSize = 100): Promise<{ items: AkeneoAttribute[]; nextUrl: string | null; totalEstimate: number | null }> {
    if (nextUrl) return readList<AkeneoAttribute>(nextUrl)
    return readList<AkeneoAttribute>('/api/rest/v1/attributes', {
      limit: Math.min(Math.max(batchSize, 1), 100),
      pagination_type: 'page',
      with_count: true,
    })
  }

  async function listFamilies(nextUrl?: string | null, batchSize = 100): Promise<{ items: AkeneoFamily[]; nextUrl: string | null; totalEstimate: number | null }> {
    if (nextUrl) return readList<AkeneoFamily>(nextUrl)
    return readList<AkeneoFamily>('/api/rest/v1/families', {
      limit: Math.min(Math.max(batchSize, 1), 100),
      pagination_type: 'page',
      with_count: true,
    })
  }

  async function listFamilyVariants(
    familyCode: string,
    nextUrl?: string | null,
    batchSize = 100,
  ): Promise<{ items: AkeneoFamilyVariant[]; nextUrl: string | null; totalEstimate: number | null }> {
    if (nextUrl) return readList<AkeneoFamilyVariant>(nextUrl)
    return readList<AkeneoFamilyVariant>(`/api/rest/v1/families/${encodeURIComponent(familyCode)}/variants`, {
      limit: Math.min(Math.max(batchSize, 1), 100),
      with_count: false,
    })
  }

  async function listChannels(): Promise<AkeneoChannel[]> {
    const response = await readList<AkeneoChannel>('/api/rest/v1/channels', {
      limit: 100,
      pagination_type: 'page',
      with_count: true,
    })
    return response.items
  }

  async function listLocales(): Promise<AkeneoLocale[]> {
    const response = await readList<AkeneoLocale>('/api/rest/v1/locales', {
      limit: 100,
      pagination_type: 'page',
      with_count: true,
    })
    return response.items
  }

  async function getCategory(code: string): Promise<AkeneoCategory | null> {
    if (!categoryCache.has(code)) {
      categoryCache.set(code, request<AkeneoCategory>(`/api/rest/v1/categories/${encodeURIComponent(code)}`).catch(() => null))
    }
    return categoryCache.get(code) ?? null
  }

  async function getAttribute(code: string): Promise<AkeneoAttribute | null> {
    if (!attributeCache.has(code)) {
      attributeCache.set(code, request<AkeneoAttribute>(`/api/rest/v1/attributes/${encodeURIComponent(code)}`).catch(() => null))
    }
    return attributeCache.get(code) ?? null
  }

  async function listAttributeOptions(attributeCode: string): Promise<AkeneoAttributeOption[]> {
    const options: AkeneoAttributeOption[] = []
    let nextUrl: string | null | undefined = null
    do {
      const now = Date.now()
      const waitMs = Math.max(0, 350 - (now - lastAttributeOptionRequestAt))
      if (waitMs > 0) await sleep(waitMs)
      lastAttributeOptionRequestAt = Date.now()
      const page: { items: AkeneoAttributeOption[]; nextUrl: string | null; totalEstimate: number | null } = await readList<AkeneoAttributeOption>(
        nextUrl ?? `/api/rest/v1/attributes/${encodeURIComponent(attributeCode)}/options`,
        nextUrl
          ? undefined
          : {
              limit: 100,
              pagination_type: 'page',
              with_count: true,
            },
      )
      options.push(...page.items)
      nextUrl = page.nextUrl
    } while (nextUrl)
    return options
  }

  async function getFamily(code: string): Promise<AkeneoFamily | null> {
    if (!familyCache.has(code)) {
      familyCache.set(code, request<AkeneoFamily>(`/api/rest/v1/families/${encodeURIComponent(code)}`).catch(() => null))
    }
    return familyCache.get(code) ?? null
  }

  async function getFamilyVariant(familyCode: string, familyVariantCode: string): Promise<AkeneoFamilyVariant | null> {
    const cacheKey = `${familyCode}:${familyVariantCode}`
    if (!familyVariantCache.has(cacheKey)) {
      familyVariantCache.set(
        cacheKey,
        request<AkeneoFamilyVariant>(`/api/rest/v1/families/${encodeURIComponent(familyCode)}/variants/${encodeURIComponent(familyVariantCode)}`).catch(() => null),
      )
    }
    return familyVariantCache.get(cacheKey) ?? null
  }

  async function getProductModel(code: string): Promise<AkeneoProductModel | null> {
    if (!productModelCache.has(code)) {
      productModelCache.set(code, request<AkeneoProductModel>(`/api/rest/v1/product-models/${encodeURIComponent(code)}`).catch(() => null))
    }
    return productModelCache.get(code) ?? null
  }

  async function getMediaFile(code: string): Promise<AkeneoMediaFile | null> {
    if (!mediaFileCache.has(code)) {
      mediaFileCache.set(code, request<AkeneoMediaFile>(`/api/rest/v1/media-files/${encodeAkeneoPathParam(code)}`).catch(() => null))
    }
    return mediaFileCache.get(code) ?? null
  }

  async function downloadMediaFile(codeOrUrl: string): Promise<{
    buffer: Buffer
    contentType: string | null
    contentLength: number | null
    fileName: string | null
    code: string | null
  }> {
    if (codeOrUrl.startsWith('http://') || codeOrUrl.startsWith('https://') || codeOrUrl.startsWith('/')) {
      const binary = await requestBinary(codeOrUrl)
      return {
        ...binary,
        fileName: null,
        code: null,
      }
    }

    const mediaFile = await getMediaFile(codeOrUrl)
    if (!mediaFile) {
      throw new Error(`Akeneo media file ${codeOrUrl} was not found`)
    }
    const downloadHref = mediaFile._links?.download?.href
    const binary = await requestBinary(downloadHref || `/api/rest/v1/media-files/${encodeAkeneoPathParam(codeOrUrl)}/download`)
    return {
      ...binary,
      fileName: typeof mediaFile.original_filename === 'string' && mediaFile.original_filename.trim().length > 0
        ? mediaFile.original_filename.trim()
        : null,
      code: mediaFile.code ?? codeOrUrl,
    }
  }

  async function collectDiscoveryData(): Promise<{
    locales: Array<{ code: string; label: string; enabled: boolean }>
    channels: Array<{ code: string; label: string; locales: string[] }>
    attributes: Array<{ code: string; type: string; label: string; localizable: boolean; scopable: boolean; group?: string; metricFamily?: string }>
    families: Array<{ code: string; label: string; attributeCount: number }>
    familyVariants: Array<{ familyCode: string; code: string; label: string; axes: string[]; attributes: string[] }>
    version: string | null
  }> {
    const [locales, channels, attributes, families, probe] = await Promise.all([
      listLocales().catch(() => []),
      listChannels().catch(() => []),
      listAttributes(null, 100),
      listFamilies(null, 100),
      getSystemProbe().catch(() => ({ version: null })),
    ])

    const familyVariants: Array<{ familyCode: string; code: string; label: string; axes: string[]; attributes: string[] }> = []
    for (const family of families.items) {
      let nextUrl: string | null = null
      do {
        const page: { items: AkeneoFamilyVariant[]; nextUrl: string | null; totalEstimate: number | null } = await listFamilyVariants(family.code, nextUrl, 100).catch(() => ({
          items: [] as AkeneoFamilyVariant[],
          nextUrl: null,
          totalEstimate: null,
        }))
        familyVariants.push(...page.items.map((familyVariant) => ({
          familyCode: family.code,
          code: familyVariant.code,
          label: labelFromLocalizedRecord(familyVariant.labels ?? null, null, familyVariant.code),
          axes: dedupeStrings(familyVariant.variant_attribute_sets?.flatMap((set: { axes?: string[] }) => Array.isArray(set.axes) ? set.axes : []) ?? []),
          attributes: dedupeStrings(familyVariant.variant_attribute_sets?.flatMap((set: { attributes?: string[] }) => Array.isArray(set.attributes) ? set.attributes : []) ?? []),
        })))
        nextUrl = page.nextUrl
      } while (nextUrl)
    }

    return {
      locales: locales.map((locale) => ({
        code: locale.code,
        label: labelFromLocalizedRecord(locale.labels ?? null, null, locale.code),
        enabled: locale.enabled ?? false,
      })),
      channels: channels.map((channel) => ({
        code: channel.code,
        label: labelFromLocalizedRecord(channel.labels ?? null, null, channel.code),
        locales: dedupeStrings(channel.locales ?? []),
      })),
      attributes: attributes.items.map((attribute) => ({
        code: attribute.code,
        type: attribute.type,
        label: labelFromLocalizedRecord(attribute.labels ?? null, null, attribute.code),
        localizable: Boolean(attribute.localizable),
        scopable: Boolean(attribute.scopable),
        group: typeof attribute.group === 'string' && attribute.group.trim().length > 0 ? attribute.group.trim() : undefined,
        metricFamily: typeof attribute.metric_family === 'string' && attribute.metric_family.trim().length > 0
          ? attribute.metric_family.trim()
          : undefined,
      })),
      families: families.items.map((family) => ({
        code: family.code,
        label: labelFromLocalizedRecord(family.labels ?? null, null, family.code),
        attributeCount: Array.isArray(family.attributes) ? family.attributes.length : 0,
      })),
      familyVariants,
      version: probe.version,
    }
  }

  return {
    credentials,
    getSystemProbe,
    collectDiscoveryData,
    listProducts,
    listCategories,
    listAttributes,
    listFamilies,
    listFamilyVariants,
    listChannels,
    listLocales,
    getCategory,
    getAttribute,
    listAttributeOptions,
    getFamily,
    getFamilyVariant,
    getProductModel,
    getMediaFile,
    downloadMediaFile,
  }
}

export type { AkeneoClient }
