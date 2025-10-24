import * as React from 'react'
import { useQuery, type UseQueryResult, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'

export type CustomFieldDefDto = {
  entityId?: string
  key: string
  kind: string
  label?: string
  description?: string
  options?: string[]
  optionsUrl?: string
  multi?: boolean
  filterable?: boolean
  formEditable?: boolean
  listVisible?: boolean
  editor?: string
  input?: string
  priority?: number
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

function buildDefinitionsQuery(entityIds: string[]): string {
  const params = new URLSearchParams()
  entityIds.forEach((id) => {
    if (id) params.append('entityId', id)
  })
  return params.toString()
}

export async function fetchCustomFieldDefs(entityIds: string | string[], fetchImpl: typeof fetch = apiFetch): Promise<CustomFieldDefDto[]> {
  const filtered = normalizeEntityIds(entityIds)
  if (!filtered.length) return []
  const query = buildDefinitionsQuery(filtered)
  const res = await fetchImpl(`/api/entities/definitions?${query}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const items = (data?.items || []) as CustomFieldDefDto[]
  items.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  return items
}

export type UseCustomFieldDefsOptions = {
  enabled?: boolean
  staleTime?: number
  gcTime?: number
  fetchImpl?: typeof fetch
  keyExtras?: Array<string | number | boolean | null | undefined>
}

export function useCustomFieldDefs(
  entityIds: string | string[] | null | undefined,
  options: UseCustomFieldDefsOptions = {}
): UseQueryResult<CustomFieldDefDto[]> {
  const {
    enabled: enabledOption = true,
    staleTime,
    gcTime,
    fetchImpl = apiFetch,
    keyExtras,
  } = options
  const normalizedIds = React.useMemo(() => normalizeEntityIds(entityIds), [entityIds])
  const idsSignature = React.useMemo(() => JSON.stringify(normalizedIds), [normalizedIds])
  const extrasSignature = React.useMemo(() => JSON.stringify(keyExtras ?? []), [keyExtras])
  const queryKey = React.useMemo(
    () => ['customFieldDefs', ...(keyExtras ?? []), ...normalizedIds],
    [idsSignature, extrasSignature]
  )
  const enabled = enabledOption && normalizedIds.length > 0

  return useQuery<CustomFieldDefDto[]>({
    queryKey,
    queryFn: () => fetchCustomFieldDefs(normalizedIds, fetchImpl),
    enabled,
    staleTime: staleTime ?? 5 * 60 * 1000,
    gcTime: gcTime ?? 30 * 60 * 1000,
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
