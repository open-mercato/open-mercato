import * as React from 'react'
import { useQuery, type UseQueryResult, type QueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from './apiCall'
import type { CustomFieldOptionDto } from '@open-mercato/shared/modules/entities/options'

export type CustomFieldDefDto = {
  entityId?: string
  key: string
  kind: string
  label?: string
  description?: string
  options?: CustomFieldOptionDto[]
  optionsUrl?: string
  multi?: boolean
  filterable?: boolean
  formEditable?: boolean
  listVisible?: boolean
  editor?: string
  input?: string
  priority?: number
  fieldset?: string
  group?: { code: string; title?: string; hint?: string }
  // attachments-specific config
  maxAttachmentSizeMb?: number
  acceptExtensions?: string[]
  // optional validation rules
  validation?: Array<
    | { rule: 'required'; message: string }
    | { rule: 'date'; message: string }
    | { rule: 'integer'; message: string }
    | { rule: 'float'; message: string }
    | { rule: 'lt' | 'lte' | 'gt' | 'gte'; param: number; message: string }
    | { rule: 'eq' | 'ne'; param: any; message: string }
    | { rule: 'regex'; param: string; message: string }
  >
  dictionaryId?: string
  dictionaryInlineCreate?: boolean
}

export type CustomFieldsetGroupDto = {
  code: string
  title?: string
  hint?: string
}

export type CustomFieldsetDto = {
  code: string
  label: string
  icon?: string
  description?: string
  groups?: CustomFieldsetGroupDto[]
}

export type CustomFieldDefinitionsPayload = {
  items?: CustomFieldDefDto[]
  fieldsetsByEntity?: Record<string, CustomFieldsetDto[]>
  entitySettings?: Record<string, { singleFieldsetPerRecord?: boolean }>
}

export function normalizeEntityIds(entityIds: string | string[] | null | undefined): string[] {
  if (entityIds == null) return []
  const list = Array.isArray(entityIds) ? entityIds : [entityIds]
  const dedup = new Set<string>()
  const normalized: string[] = []
  for (const raw of list) {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed || dedup.has(trimmed)) continue
    dedup.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

export type CustomFieldDefinitionQueryOptions = {
  fieldset?: string
}

function buildDefinitionsQuery(entityIds: string[], options?: CustomFieldDefinitionQueryOptions): string {
  const params = new URLSearchParams()
  entityIds.forEach((id) => {
    if (id) params.append('entityId', id)
  })
  if (options?.fieldset) params.set('fieldset', options.fieldset)
  return params.toString()
}

type CustomFieldDefinitionsResponse = CustomFieldDefinitionsPayload

function normalizeRecord<T>(value: unknown): Record<string, T[]> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, T[]> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue
    out[key] = raw as T[]
  }
  return out
}

function preparePayload(data: CustomFieldDefinitionsResponse | null | undefined): CustomFieldDefinitionsPayload {
  const items = Array.isArray(data?.items) ? [...data!.items] : []
  items.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  const fieldsetsByEntity = normalizeRecord<CustomFieldsetDto>(data?.fieldsetsByEntity)
  const entitySettings = (data?.entitySettings && typeof data.entitySettings === 'object'
    ? data.entitySettings
    : {}) as CustomFieldDefinitionsPayload['entitySettings']
  return { items, fieldsetsByEntity, entitySettings }
}

async function readDefinitionsViaFetch(
  entityIds: string[],
  fetchImpl: typeof fetch,
  options?: CustomFieldDefinitionQueryOptions,
): Promise<CustomFieldDefinitionsPayload> {
  const query = buildDefinitionsQuery(entityIds, options)
  const res = await fetchImpl(`/api/entities/definitions?${query}`, {
    headers: { 'content-type': 'application/json' },
  })
  const data = await res.json().catch(() => ({ items: [] }))
  return preparePayload(data)
}

async function readDefinitionsViaApi(entityIds: string[], options?: CustomFieldDefinitionQueryOptions): Promise<CustomFieldDefinitionsPayload> {
  const query = buildDefinitionsQuery(entityIds, options)
  const payload = await readApiResultOrThrow<CustomFieldDefinitionsResponse>(
    `/api/entities/definitions?${query}`,
    { headers: { 'content-type': 'application/json' } },
    {
      errorMessage: 'Failed to load custom field definitions',
      fallback: { items: [] },
    },
  )
  return preparePayload(payload)
}

export async function fetchCustomFieldDefinitionsPayload(
  entityIds: string | string[],
  fetchImpl?: typeof fetch,
  options?: CustomFieldDefinitionQueryOptions,
): Promise<CustomFieldDefinitionsPayload> {
  const filtered = normalizeEntityIds(entityIds)
  if (!filtered.length) return { items: [] }
  return fetchImpl
    ? await readDefinitionsViaFetch(filtered, fetchImpl, options)
    : await readDefinitionsViaApi(filtered, options)
}

export async function fetchCustomFieldDefs(
  entityIds: string | string[],
  fetchImpl?: typeof fetch,
  options?: CustomFieldDefinitionQueryOptions,
): Promise<CustomFieldDefDto[]> {
  const payload = await fetchCustomFieldDefinitionsPayload(entityIds, fetchImpl, options)
  return payload.items ?? []
}

export type UseCustomFieldDefsOptions<TData = CustomFieldDefDto[]> = {
  enabled?: boolean
  staleTime?: number
  gcTime?: number
  /** @deprecated Custom fetch implementations are no longer needed. */
  fetchImpl?: typeof fetch
  keyExtras?: Array<string | number | boolean | null | undefined>
  fieldset?: string
  select?: (data: CustomFieldDefDto[]) => TData
}

export function useCustomFieldDefs<TData = CustomFieldDefDto[]>(
  entityIds: string | string[] | null | undefined,
  options: UseCustomFieldDefsOptions<TData> = {}
): UseQueryResult<TData> {
  const {
    enabled: enabledOption = true,
    staleTime,
    gcTime,
    keyExtras,
    fetchImpl,
    fieldset,
  } = options
  const normalizedIds = React.useMemo(() => normalizeEntityIds(entityIds), [entityIds])
  const idsSignature = React.useMemo(() => JSON.stringify(normalizedIds), [normalizedIds])
  const extrasSignature = React.useMemo(() => JSON.stringify(keyExtras ?? []), [keyExtras])
  const normalizedFieldset = typeof fieldset === 'string' && fieldset.trim().length ? fieldset.trim() : null
  const queryKey = React.useMemo(
    () => ['customFieldDefs', ...(keyExtras ?? []), ...normalizedIds, `fieldset:${normalizedFieldset ?? 'default'}`],
    [idsSignature, extrasSignature, normalizedFieldset]
  )
  const enabled = enabledOption && normalizedIds.length > 0

  return useQuery<CustomFieldDefDto[], Error, TData>({
    queryKey,
    queryFn: () =>
      fetchCustomFieldDefs(
        normalizedIds,
        fetchImpl,
        normalizedFieldset ? { fieldset: normalizedFieldset } : undefined
      ),
    enabled,
    staleTime: staleTime ?? 5 * 60 * 1000,
    gcTime: gcTime ?? 30 * 60 * 1000,
    select: options.select,
  })
}

export type CustomFieldVisibility = 'list' | 'form' | 'filter'

export function isDefVisible(def: CustomFieldDefDto, mode: CustomFieldVisibility): boolean {
  switch (mode) {
    case 'list':
      return def.listVisible !== false
    case 'form':
      return def.formEditable !== false
    case 'filter':
      return !!def.filterable
    default:
      return true
  }
}

export function filterCustomFieldDefs(defs: CustomFieldDefDto[], mode: CustomFieldVisibility): CustomFieldDefDto[] {
  return defs
    .filter((d) => isDefVisible(d, mode))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
}

export async function invalidateCustomFieldDefs(
  queryClient: QueryClient,
  entityIds?: string | string[] | null,
): Promise<void> {
  const normalizedIds = normalizeEntityIds(entityIds)
  const targetPrefixes = new Set(['customFieldDefs', 'customFieldForms', 'dealFormFields'])
  if (!normalizedIds.length) {
    await queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && typeof query.queryKey[0] === 'string' && targetPrefixes.has(query.queryKey[0] as string),
    })
    return
  }
  await queryClient.invalidateQueries({
    predicate: (query) => {
      if (!Array.isArray(query.queryKey)) return false
      const [prefix] = query.queryKey
      if (typeof prefix !== 'string' || !targetPrefixes.has(prefix)) return false
      return normalizedIds.every((id) => query.queryKey.includes(id))
    },
  })
}
