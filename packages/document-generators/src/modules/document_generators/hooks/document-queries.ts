export const DOCUMENT_GENERATORS_API_BASE = '/api/document-generators'
export const DOCUMENT_TEMPLATE_OPTIONS_STALE_TIME_MS = 5 * 60 * 1000
export const DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE = 20
export const DOCUMENT_HISTORY_MAX_PAGE_SIZE = 100

export const DOCUMENT_HISTORY_SORT_FIELDS = ['template_label', 'format', 'generated_by', 'generated_at'] as const
export type DocumentHistorySortField = (typeof DOCUMENT_HISTORY_SORT_FIELDS)[number]
export type DocumentHistorySortDirection = 'asc' | 'desc'

export type DocumentTemplatesFilter = {
  resourceKind?: string
  documentType?: string
  format?: string
  tags?: string[]
}

export type DocumentHistoryQuery = {
  page?: number
  pageSize?: number
  resourceKind?: string
  resourceId?: string
  templateId?: string
  generatedBy?: string
  generatedFrom?: string
  generatedTo?: string
  sort?: DocumentHistorySortField
  sortDirection?: DocumentHistorySortDirection
}

export type NormalizedDocumentHistoryQuery = Required<Pick<DocumentHistoryQuery, 'page' | 'pageSize'>> &
  Omit<DocumentHistoryQuery, 'page' | 'pageSize'>

function cleanText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toQueryString(params: URLSearchParams): string {
  const serialized = params.toString()
  return serialized.length > 0 ? `?${serialized}` : ''
}

export function normalizeDocumentTemplatesFilter(filter: DocumentTemplatesFilter = {}): DocumentTemplatesFilter {
  const tags = (filter.tags ?? []).map((tag) => cleanText(tag)).filter((tag): tag is string => !!tag)
  return {
    resourceKind: cleanText(filter.resourceKind),
    documentType: cleanText(filter.documentType),
    format: cleanText(filter.format),
    tags: tags.length > 0 ? tags : undefined,
  }
}

export function buildDocumentTemplatesUrl(filter: DocumentTemplatesFilter = {}): string {
  const normalized = normalizeDocumentTemplatesFilter(filter)
  const params = new URLSearchParams()
  if (normalized.resourceKind) params.set('resource_kind', normalized.resourceKind)
  if (normalized.documentType) params.set('document_type', normalized.documentType)
  if (normalized.format) params.set('format', normalized.format)
  for (const tag of normalized.tags ?? []) params.append('tags', tag)
  return `${DOCUMENT_GENERATORS_API_BASE}/templates${toQueryString(params)}`
}

export function documentTemplatesQueryKey(filter: DocumentTemplatesFilter = {}) {
  return ['document-generators', 'templates', normalizeDocumentTemplatesFilter(filter)] as const
}

export const DOCUMENT_TEMPLATE_OPTIONS_URL = `${DOCUMENT_GENERATORS_API_BASE}/templates/options`

export function documentTemplateOptionsQueryKey() {
  return ['document-generators', 'template-options'] as const
}

export function clampDocumentHistoryPageSize(pageSize: number | undefined): number {
  if (typeof pageSize !== 'number' || !Number.isFinite(pageSize)) return DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE
  return Math.min(DOCUMENT_HISTORY_MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)))
}

export function isDocumentHistorySortField(value: unknown): value is DocumentHistorySortField {
  return typeof value === 'string' && (DOCUMENT_HISTORY_SORT_FIELDS as readonly string[]).includes(value)
}

export function normalizeDocumentHistoryQuery(query: DocumentHistoryQuery = {}): NormalizedDocumentHistoryQuery {
  const page = typeof query.page === 'number' && Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page)) : 1
  const sort = isDocumentHistorySortField(query.sort) ? query.sort : undefined
  return {
    page,
    pageSize: clampDocumentHistoryPageSize(query.pageSize),
    resourceKind: cleanText(query.resourceKind),
    resourceId: cleanText(query.resourceId),
    templateId: cleanText(query.templateId),
    generatedBy: cleanText(query.generatedBy),
    generatedFrom: cleanText(query.generatedFrom),
    generatedTo: cleanText(query.generatedTo),
    sort,
    sortDirection: sort ? (query.sortDirection === 'asc' ? 'asc' : 'desc') : undefined,
  }
}

export function buildDocumentHistoryUrl(query: DocumentHistoryQuery = {}): string {
  const normalized = normalizeDocumentHistoryQuery(query)
  const params = new URLSearchParams()
  params.set('page', String(normalized.page))
  params.set('pageSize', String(normalized.pageSize))
  if (normalized.resourceKind) params.set('resource_kind', normalized.resourceKind)
  if (normalized.resourceId) params.set('resource_id', normalized.resourceId)
  if (normalized.templateId) params.set('template_id', normalized.templateId)
  if (normalized.generatedBy) params.set('generated_by', normalized.generatedBy)
  if (normalized.generatedFrom) params.set('generated_from', normalized.generatedFrom)
  if (normalized.generatedTo) params.set('generated_to', normalized.generatedTo)
  if (normalized.sort) {
    params.set('sort', normalized.sort)
    if (normalized.sortDirection) params.set('sort_direction', normalized.sortDirection)
  }
  return `${DOCUMENT_GENERATORS_API_BASE}/documents${toQueryString(params)}`
}

export function documentHistoryQueryKey(query: DocumentHistoryQuery = {}) {
  const normalized = normalizeDocumentHistoryQuery(query)
  return [
    'document-generators',
    'history',
    normalized.resourceKind ?? null,
    normalized.resourceId ?? null,
    normalized,
  ] as const
}

export function isDocumentHistoryQueryEnabled(
  query: DocumentHistoryQuery,
  options: { requireResource?: boolean } = {},
): boolean {
  if (!options.requireResource) return true
  const normalized = normalizeDocumentHistoryQuery(query)
  return Boolean(normalized.resourceKind && normalized.resourceId)
}

export type DocumentHistoryFilterState = {
  page: number
  pageSize: number
  templateId: string
  generatedBy: string
  generatedFrom: string
  generatedTo: string
  sort: DocumentHistorySortField | null
  sortDirection: DocumentHistorySortDirection
}

export type DocumentHistoryFilterPatch = Partial<
  Pick<DocumentHistoryFilterState, 'templateId' | 'generatedBy' | 'generatedFrom' | 'generatedTo'>
>

export function createDocumentHistoryFilterState(
  initial: Partial<DocumentHistoryFilterState> = {},
): DocumentHistoryFilterState {
  return {
    page: 1,
    pageSize: clampDocumentHistoryPageSize(initial.pageSize),
    templateId: initial.templateId ?? '',
    generatedBy: initial.generatedBy ?? '',
    generatedFrom: initial.generatedFrom ?? '',
    generatedTo: initial.generatedTo ?? '',
    sort: isDocumentHistorySortField(initial.sort) ? initial.sort : null,
    sortDirection: initial.sortDirection === 'asc' ? 'asc' : 'desc',
  }
}

export function applyDocumentHistoryFilters(
  state: DocumentHistoryFilterState,
  patch: DocumentHistoryFilterPatch,
): DocumentHistoryFilterState {
  return { ...state, ...patch, page: 1 }
}

export function applyDocumentHistorySort(
  state: DocumentHistoryFilterState,
  sort: string | null | undefined,
  sortDirection: DocumentHistorySortDirection,
): DocumentHistoryFilterState {
  if (!isDocumentHistorySortField(sort)) return { ...state, sort: null, sortDirection: 'desc', page: 1 }
  return { ...state, sort, sortDirection, page: 1 }
}

export function applyDocumentHistoryPage(state: DocumentHistoryFilterState, page: number): DocumentHistoryFilterState {
  return { ...state, page: Math.max(1, Math.floor(page) || 1) }
}

export function resolveLastValidDocumentHistoryPage(page: number, total: number, pageSize: number): number {
  const size = clampDocumentHistoryPageSize(pageSize)
  const lastPage = Math.max(1, Math.ceil(Math.max(0, total) / size))
  return Math.min(Math.max(1, Math.floor(page) || 1), lastPage)
}

export function documentHistoryFilterStateToQuery(
  state: DocumentHistoryFilterState,
  resource: { resourceKind?: string; resourceId?: string } = {},
): DocumentHistoryQuery {
  return {
    page: state.page,
    pageSize: state.pageSize,
    resourceKind: resource.resourceKind,
    resourceId: resource.resourceId,
    templateId: state.templateId,
    generatedBy: state.generatedBy,
    generatedFrom: state.generatedFrom,
    generatedTo: state.generatedTo,
    sort: state.sort ?? undefined,
    sortDirection: state.sort ? state.sortDirection : undefined,
  }
}
