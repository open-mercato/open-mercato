"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import {
  DictionaryValue,
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../lib/dictionaries'
import {
  ensureCustomerDictionary,
  invalidateCustomerDictionary,
} from '../../../components/detail/hooks/useCustomerDictionary'
import {
  useCustomFieldDefs,
  filterCustomFieldDefs,
} from '@open-mercato/ui/backend/utils/customFieldDefs'

type DealRow = {
  id: string
  title: string
  status?: string | null
  pipelineStage?: string | null
  valueAmount?: number | null
  valueCurrency?: string | null
  probability?: number | null
  expectedCloseAt?: string | null
  updatedAt?: string | null
  companies: { id: string; label: string }[]
  people: { id: string; label: string }[]
} & Record<string, unknown>

type DealsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type FilterOption = { value: string; label: string }

type DictionaryKey = Extract<CustomerDictionaryKind, 'deal-statuses' | 'pipeline-stages'>

type PersonLookupRecord = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
}

type CompanyLookupRecord = {
  id: string
  name: string | null
  domain: string | null
  email: string | null
}

function parsePersonLookupRecord(item: unknown): PersonLookupRecord | null {
  if (typeof item !== 'object' || item === null) return null
  const record = item as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : null
  if (!id || !isUuid(id)) return null
  const name = typeof record.display_name === 'string' ? record.display_name : null
  const email = typeof record.primary_email === 'string' ? record.primary_email : null
  const phone = typeof record.primary_phone === 'string' ? record.primary_phone : null
  return { id, name, email, phone }
}

function parseCompanyLookupRecord(item: unknown): CompanyLookupRecord | null {
  if (typeof item !== 'object' || item === null) return null
  const record = item as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : null
  if (!id || !isUuid(id)) return null
  const name = typeof record.display_name === 'string' ? record.display_name : null
  const domain = typeof record.primary_domain === 'string' ? record.primary_domain : null
  const email = typeof record.primary_email === 'string' ? record.primary_email : null
  return { id, name, domain, email }
}

type OptionsState = {
  options: FilterOption[]
  idToLabel: Record<string, string>
  labelToId: Record<string, string>
}

const EMPTY_OPTIONS_STATE: OptionsState = {
  options: [],
  idToLabel: {},
  labelToId: {},
}

const PAGE_SIZE = 20
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  if (!value) return false
  return UUID_REGEX.test(value.trim())
}

function normalizeIdCandidates(raw: Array<string>): string[] {
  const set = new Set<string>()
  raw.forEach((candidate) => {
    candidate
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .forEach((part) => {
        if (isUuid(part)) set.add(part)
      })
  })
  return Array.from(set)
}

function extractIdsFromParams(params: URLSearchParams | null | undefined, key: string): string[] {
  if (!params) return []
  const values = params.getAll(key)
  return normalizeIdCandidates(values)
}

function ensureUniqueLabel(base: string, occupied: Set<string>): string {
  const trimmed = base.trim() || 'Unnamed'
  if (!occupied.has(trimmed)) {
    occupied.add(trimmed)
    return trimmed
  }
  let counter = 2
  let candidate = `${trimmed} • ${counter}`
  while (occupied.has(candidate)) {
    counter += 1
    candidate = `${trimmed} • ${counter}`
  }
  occupied.add(candidate)
  return candidate
}

async function fetchPeopleLookup(query?: string): Promise<PersonLookupRecord[]> {
  const search = new URLSearchParams()
  search.set('page', '1')
  search.set('pageSize', '20')
  if (query && query.trim().length) search.set('search', query.trim())
  try {
    const call = await apiCall<{ items?: unknown[] }>(`/api/customers/people?${search.toString()}`)
    if (!call.ok) return []
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    return items
      .map((item) => parsePersonLookupRecord(item))
      .filter((record): record is PersonLookupRecord => record !== null)
  } catch {
    return []
  }
}

async function fetchPeopleLookupByIds(ids: string[]): Promise<PersonLookupRecord[]> {
  const unique = Array.from(new Set(ids.filter((id) => isUuid(id))))
  if (!unique.length) return []
  const results = await Promise.all(
    unique.map(async (id) => {
      const search = new URLSearchParams()
      search.set('id', id)
      search.set('page', '1')
      search.set('pageSize', '1')
      try {
        const call = await apiCall<{ items?: unknown[] }>(`/api/customers/people?${search.toString()}`)
        if (!call.ok) return null
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const match = items
          .map((item) => parsePersonLookupRecord(item))
          .find((record) => record?.id === id)
        return match ?? null
      } catch {
        return null
      }
    }),
  )
  return results.filter((record): record is PersonLookupRecord => !!record)
}

async function fetchCompaniesLookup(query?: string): Promise<CompanyLookupRecord[]> {
  const search = new URLSearchParams()
  search.set('page', '1')
  search.set('pageSize', '20')
  if (query && query.trim().length) search.set('search', query.trim())
  try {
    const call = await apiCall<{ items?: unknown[] }>(`/api/customers/companies?${search.toString()}`)
    if (!call.ok) return []
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    return items
      .map((item) => parseCompanyLookupRecord(item))
      .filter((record): record is CompanyLookupRecord => record !== null)
  } catch {
    return []
  }
}

async function fetchCompaniesLookupByIds(ids: string[]): Promise<CompanyLookupRecord[]> {
  const unique = Array.from(new Set(ids.filter((id) => isUuid(id))))
  if (!unique.length) return []
  const results = await Promise.all(
    unique.map(async (id) => {
      const search = new URLSearchParams()
      search.set('id', id)
      search.set('page', '1')
      search.set('pageSize', '1')
      try {
        const call = await apiCall<{ items?: unknown[] }>(`/api/customers/companies?${search.toString()}`)
        if (!call.ok) return null
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const match = items
          .map((item) => parseCompanyLookupRecord(item))
          .find((record) => record?.id === id)
        return match ?? null
      } catch {
        return null
      }
    }),
  )
  return results.filter((record): record is CompanyLookupRecord => !!record)
}

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined, fallback: string): string {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return fallback
  try {
    if (currency && currency.trim().length) {
      const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
      return formatter.format(amount)
    }
    const formatter = new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 2 })
    return formatter.format(amount)
  } catch {
    return currency ? `${amount} ${currency}` : String(amount)
  }
}

function formatDateValue(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString()
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export default function CustomersDealsPage() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()

  const [rows, setRows] = React.useState<DealRow[]>([])
  const [page, setPage] = React.useState(() => {
    const raw = Number(searchParams?.get('page') ?? '1')
    return Number.isFinite(raw) && raw > 0 ? raw : 1
  })
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState(() => searchParams?.get('search')?.trim() ?? '')
  const [isLoading, setIsLoading] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)

  const initialPersonIds = React.useMemo(
    () => extractIdsFromParams(searchParams, 'personId'),
    [searchParams],
  )
  const initialCompanyIds = React.useMemo(
    () => extractIdsFromParams(searchParams, 'companyId'),
    [searchParams],
  )

  const [selectedPersonIds, setSelectedPersonIds] = React.useState<string[]>(initialPersonIds)
  const [selectedCompanyIds, setSelectedCompanyIds] = React.useState<string[]>(initialCompanyIds)

  const [peopleState, setPeopleState] = React.useState<OptionsState>(EMPTY_OPTIONS_STATE)
  const [companiesState, setCompaniesState] = React.useState<OptionsState>(EMPTY_OPTIONS_STATE)
  const peopleCacheRef = React.useRef<Map<string, FilterOption[]>>(new Map())
  const companiesCacheRef = React.useRef<Map<string, FilterOption[]>>(new Map())

  const buildPersonLabel = React.useCallback((record: PersonLookupRecord): string => {
    const parts: string[] = []
    const name = record.name?.trim()
    if (name) parts.push(name)
    const email = record.email?.trim()
    if (email && !parts.includes(email)) parts.push(email)
    const phone = record.phone?.trim()
    if (!parts.length && phone) parts.push(phone)
    if (!parts.length) parts.push(t('customers.deals.list.unnamedPerson', 'Unnamed person'))
    return parts.join(' • ')
  }, [t])

  const buildCompanyLabel = React.useCallback((record: CompanyLookupRecord): string => {
    const parts: string[] = []
    const name = record.name?.trim()
    if (name) parts.push(name)
    const domain = record.domain?.trim()
    if (domain && !parts.includes(domain)) parts.push(domain)
    const email = record.email?.trim()
    if (!parts.length && email) parts.push(email)
    if (!parts.length) parts.push(t('customers.deals.list.unnamedCompany', 'Unnamed company'))
    return parts.join(' • ')
  }, [t])

  const ingestPeopleRecords = React.useCallback((records: PersonLookupRecord[]) => {
    if (!records.length) return [] as FilterOption[]
    const queryMap = new Map<string, FilterOption>()
    setPeopleState((prev) => {
      const idToLabel = { ...prev.idToLabel }
      const labelToId: Record<string, string> = {}
      const merged = new Map(prev.options.map((opt) => [opt.value, opt]))
      const occupied = new Set<string>()
      Object.entries(prev.labelToId).forEach(([label, id]) => {
        occupied.add(label)
        labelToId[label] = id
      })
      records.forEach((record) => {
        if (!isUuid(record.id)) return
        const base = buildPersonLabel(record)
        let previousLabel = idToLabel[record.id]
        if (previousLabel) {
          // remove previous label before reassigning
          delete labelToId[previousLabel]
          occupied.delete(previousLabel)
        }
        const label = ensureUniqueLabel(base, occupied)
        idToLabel[record.id] = label
        labelToId[label] = record.id
        const option = { value: record.id, label }
        merged.set(record.id, option)
        queryMap.set(record.id, option)
      })
      const nextOptions = Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label))
      return { options: nextOptions, idToLabel, labelToId }
    })
    return Array.from(queryMap.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [buildPersonLabel])

  const ingestCompanyRecords = React.useCallback((records: CompanyLookupRecord[]) => {
    if (!records.length) return [] as FilterOption[]
    const queryMap = new Map<string, FilterOption>()
    setCompaniesState((prev) => {
      const idToLabel = { ...prev.idToLabel }
      const labelToId: Record<string, string> = {}
      const merged = new Map(prev.options.map((opt) => [opt.value, opt]))
      const occupied = new Set<string>()
      Object.entries(prev.labelToId).forEach(([label, id]) => {
        occupied.add(label)
        labelToId[label] = id
      })
      records.forEach((record) => {
        if (!isUuid(record.id)) return
        const base = buildCompanyLabel(record)
        let previousLabel = idToLabel[record.id]
        if (previousLabel) {
          delete labelToId[previousLabel]
          occupied.delete(previousLabel)
        }
        const label = ensureUniqueLabel(base, occupied)
        idToLabel[record.id] = label
        labelToId[label] = record.id
        const option = { value: record.id, label }
        merged.set(record.id, option)
        queryMap.set(record.id, option)
      })
      const nextOptions = Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label))
      return { options: nextOptions, idToLabel, labelToId }
    })
    return Array.from(queryMap.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [buildCompanyLabel])

  const loadPeopleOptions = React.useCallback(async (query?: string) => {
    const normalizedQuery = (query || '').trim().toLowerCase()
    const cacheKey = `${scopeVersion}|${normalizedQuery}`
    const cached = peopleCacheRef.current.get(cacheKey)
    if (cached) return cached
    const records = await fetchPeopleLookup(query)
    const options = ingestPeopleRecords(records)
    peopleCacheRef.current.set(cacheKey, options)
    return options
  }, [scopeVersion, ingestPeopleRecords])

  const loadCompanyOptions = React.useCallback(async (query?: string) => {
    const normalizedQuery = (query || '').trim().toLowerCase()
    const cacheKey = `${scopeVersion}|${normalizedQuery}`
    const cached = companiesCacheRef.current.get(cacheKey)
    if (cached) return cached
    const records = await fetchCompaniesLookup(query)
    const options = ingestCompanyRecords(records)
    companiesCacheRef.current.set(cacheKey, options)
    return options
  }, [scopeVersion, ingestCompanyRecords])

  React.useEffect(() => {
    let cancelled = false
    if (!selectedPersonIds.length) return
    const missing = selectedPersonIds.filter((id) => !peopleState.idToLabel[id])
    if (!missing.length) return
    fetchPeopleLookupByIds(missing).then((records) => {
      if (cancelled) return
      ingestPeopleRecords(records)
    })
    return () => { cancelled = true }
  }, [selectedPersonIds, peopleState.idToLabel, ingestPeopleRecords])

  React.useEffect(() => {
    let cancelled = false
    if (!selectedCompanyIds.length) return
    const missing = selectedCompanyIds.filter((id) => !companiesState.idToLabel[id])
    if (!missing.length) return
    fetchCompaniesLookupByIds(missing).then((records) => {
      if (cancelled) return
      ingestCompanyRecords(records)
    })
    return () => { cancelled = true }
  }, [selectedCompanyIds, companiesState.idToLabel, ingestCompanyRecords])

  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<DictionaryKey, CustomerDictionaryMap>>({
    'deal-statuses': {},
    'pipeline-stages': {},
  })

  const fetchDictionaryEntries = React.useCallback(
    async (kind: DictionaryKey) => {
      try {
        const data = await ensureCustomerDictionary(queryClient, kind, scopeVersion)
        setDictionaryMaps((prev) => ({ ...prev, [kind]: data.map }))
      } catch {
        setDictionaryMaps((prev) => ({ ...prev, [kind]: {} }))
      }
    },
    [queryClient, scopeVersion],
  )

  React.useEffect(() => {
    let cancelled = false
    async function loadDictionaries() {
      if (cancelled) return
      await Promise.all([fetchDictionaryEntries('deal-statuses'), fetchDictionaryEntries('pipeline-stages')])
    }
    loadDictionaries().catch(() => {})
    return () => { cancelled = true }
  }, [fetchDictionaryEntries, reloadToken])

  React.useEffect(() => {
    peopleCacheRef.current.clear()
    companiesCacheRef.current.clear()
    setPeopleState((prev) => {
      if (!prev.options.length && !Object.keys(prev.idToLabel).length) return prev
      return { ...EMPTY_OPTIONS_STATE }
    })
    setCompaniesState((prev) => {
      if (!prev.options.length && !Object.keys(prev.idToLabel).length) return prev
      return { ...EMPTY_OPTIONS_STATE }
    })
  }, [scopeVersion, reloadToken])

  const syncFilterLabels = React.useCallback((
    key: 'people' | 'companies',
    ids: string[],
    idToLabel: Record<string, string>,
  ) => {
    setFilterValues((prev) => {
      const current = Array.isArray(prev[key]) ? (prev[key] as string[]) : []
      if (!ids.length) {
        if (!current.length) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      const labels: string[] = []
      ids.forEach((id) => {
        const label = idToLabel[id]
        if (label && !labels.includes(label)) labels.push(label)
      })
      if (labels.length < ids.length) return prev
      if (arraysEqual(current, labels)) return prev
      return { ...prev, [key]: labels }
    })
  }, [])

  React.useEffect(() => {
    syncFilterLabels('people', selectedPersonIds, peopleState.idToLabel)
  }, [selectedPersonIds, peopleState.idToLabel, syncFilterLabels])

  React.useEffect(() => {
    syncFilterLabels('companies', selectedCompanyIds, companiesState.idToLabel)
  }, [selectedCompanyIds, companiesState.idToLabel, syncFilterLabels])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value.trim())
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = { ...values }
    const rawPeople = Array.isArray(values.people) ? (values.people as string[]) : []
    const nextPersonIds: string[] = []
    rawPeople.forEach((value) => {
      const trimmed = typeof value === 'string' ? value.trim() : ''
      if (!trimmed) return
      const mapped = peopleState.labelToId[trimmed]
      if (mapped && !nextPersonIds.includes(mapped)) nextPersonIds.push(mapped)
    })
    setSelectedPersonIds(nextPersonIds)
    if (nextPersonIds.length) {
      next.people = Array.from(new Set(rawPeople.map((value) => (typeof value === 'string' ? value.trim() : '')).filter((value) => value.length > 0)))
    } else {
      delete next.people
    }

    const rawCompanies = Array.isArray(values.companies) ? (values.companies as string[]) : []
    const nextCompanyIds: string[] = []
    rawCompanies.forEach((value) => {
      const trimmed = typeof value === 'string' ? value.trim() : ''
      if (!trimmed) return
      const mapped = companiesState.labelToId[trimmed]
      if (mapped && !nextCompanyIds.includes(mapped)) nextCompanyIds.push(mapped)
    })
    setSelectedCompanyIds(nextCompanyIds)
    if (nextCompanyIds.length) {
      next.companies = Array.from(new Set(rawCompanies.map((value) => (typeof value === 'string' ? value.trim() : '')).filter((value) => value.length > 0)))
    } else {
      delete next.companies
    }

    setFilterValues(next)
    setPage(1)
  }, [peopleState.labelToId, companiesState.labelToId])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setSelectedPersonIds([])
    setSelectedCompanyIds([])
    setPage(1)
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim().length) params.set('search', search.trim())
    if (selectedPersonIds.length) params.set('personId', selectedPersonIds.join(','))
    if (selectedCompanyIds.length) params.set('companyId', selectedCompanyIds.join(','))
    Object.entries(filterValues).forEach(([key, value]) => {
      if (key === 'people' || key === 'companies') return
      if (value == null) return
      if (Array.isArray(value)) {
        const normalized = value
          .map((item) => {
            if (item == null) return ''
            if (typeof item === 'string') return item.trim()
            return String(item).trim()
          })
          .filter((item) => item.length > 0)
        if (normalized.length) params.set(key, normalized.join(','))
      } else if (typeof value === 'object') {
        const obj = value as Record<string, unknown>
        const from = typeof obj.from === 'string' ? obj.from.trim() : ''
        const to = typeof obj.to === 'string' ? obj.to.trim() : ''
        if (from) params.set(`${key}[from]`, from)
        if (to) params.set(`${key}[to]`, to)
      } else {
        const stringValue = typeof value === 'string' ? value.trim() : String(value)
        if (stringValue) params.set(key, stringValue)
      }
    })
    return params.toString()
  }, [filterValues, page, search, selectedCompanyIds, selectedPersonIds])

  const currentParams = React.useMemo(
    () => Object.fromEntries(new URLSearchParams(queryParams)),
    [queryParams],
  )

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/deals', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/deals', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setCacheStatus(null)
      try {
        const call = await apiCall<DealsResponse>(`/api/customers/deals?${queryParams}`)
        const rawCacheStatus = call.response.headers?.get?.('x-om-cache')
        const normalizedCacheStatus = rawCacheStatus === 'hit' || rawCacheStatus === 'miss' ? rawCacheStatus : null
        if (!call.ok) {
          const message =
            typeof call.result?.error === 'string'
              ? call.result.error
              : t('customers.deals.list.error.load')
          flash(message, 'error')
          if (!cancelled) setCacheStatus(null)
          return
        }
        const payload = call.result ?? {}
        if (cancelled) return
        setCacheStatus(normalizedCacheStatus)
        const items = Array.isArray(payload.items) ? payload.items : []
        const mapped = items
          .map((item) => mapDeal(item as Record<string, unknown>))
          .filter((row): row is DealRow => !!row)
        setRows(mapped)
        setTotal(typeof payload.total === 'number' ? payload.total : mapped.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          setCacheStatus(null)
          const message = err instanceof Error ? err.message : t('customers.deals.list.error.load')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  React.useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const queryRef = React.useRef(searchParams?.toString() ?? '')
  React.useEffect(() => {
    if (!pathname) return
    const params = new URLSearchParams()
    if (search.trim().length) params.set('search', search.trim())
    if (selectedPersonIds.length) selectedPersonIds.forEach((id) => params.append('personId', id))
    if (selectedCompanyIds.length) selectedCompanyIds.forEach((id) => params.append('companyId', id))
    if (page > 1) params.set('page', String(page))
    const next = params.toString()
    if (queryRef.current === next) return
    queryRef.current = next
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
  }, [pathname, router, page, search, selectedPersonIds, selectedCompanyIds])

  const handleRefresh = React.useCallback(() => {
    peopleCacheRef.current.clear()
    companiesCacheRef.current.clear()
    void Promise.all([
      invalidateCustomerDictionary(queryClient, 'deal-statuses'),
      invalidateCustomerDictionary(queryClient, 'pipeline-stages'),
    ])
    setReloadToken((token) => token + 1)
  }, [queryClient])

  const handleDeleteDeal = React.useCallback(
    async (dealId: string) => {
      if (pendingDeleteId) return
      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm(
              t(
                'customers.deals.list.deleteConfirm',
                'Delete this deal? This action cannot be undone.',
              ),
            )
      if (!confirmed) return
      setPendingDeleteId(dealId)
      try {
        await deleteCrud('customers/deals', {
          body: { id: dealId },
          errorMessage: t('customers.deals.list.deleteError', 'Failed to delete deal.'),
        })
        flash(t('customers.deals.list.deleteSuccess', 'Deal deleted.'), 'success')
        setRows((prev) => prev.filter((row) => row.id !== dealId))
        setTotal((prev) => Math.max(0, prev - 1))
        handleRefresh()
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.deals.list.deleteError', 'Failed to delete deal.')
        flash(message, 'error')
      } finally {
        setPendingDeleteId(null)
      }
    },
    [handleRefresh, pendingDeleteId, t],
  )

  const personOptions = peopleState.options
  const companyOptions = companiesState.options

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'people',
      label: t('customers.deals.list.filters.people'),
      type: 'tags',
      options: personOptions,
      loadOptions: loadPeopleOptions,
      placeholder: t('customers.deals.list.filters.peoplePlaceholder'),
    },
    {
      id: 'companies',
      label: t('customers.deals.list.filters.companies'),
      type: 'tags',
      options: companyOptions,
      loadOptions: loadCompanyOptions,
      placeholder: t('customers.deals.list.filters.companiesPlaceholder'),
    },
  ], [companyOptions, loadCompanyOptions, loadPeopleOptions, personOptions, t])

  const { data: customFieldDefs = [] } = useCustomFieldDefs([E.customers.customer_deal], {
    keyExtras: [scopeVersion, reloadToken],
  })

  const columns = React.useMemo<ColumnDef<DealRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">{t('customers.deals.list.noValue')}</span>
    const renderDictionaryCell = (kind: DictionaryKey, value: string | null | undefined) => (
      <DictionaryValue
        value={value}
        map={dictionaryMaps[kind]}
        fallback={value ? <span className="text-sm">{value}</span> : noValue}
        className="text-sm"
        iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
        iconClassName="h-4 w-4"
        colorClassName="h-3 w-3 rounded-full"
      />
    )
    const renderAssociationList = (
      items: { id: string; label: string }[],
      fallbackLabel: string,
    ) => {
      if (!items.length) return noValue
      return (
        <ul className="flex flex-wrap gap-1 text-sm">
          {items.map((entry) => (
            <li key={entry.id} className="rounded border px-2 py-0.5 text-xs bg-muted">
              {entry.label && entry.label.trim().length ? entry.label : fallbackLabel}
            </li>
          ))}
        </ul>
      )
    }

    const customColumns = filterCustomFieldDefs(customFieldDefs, 'list').map<ColumnDef<DealRow>>((def) => ({
      accessorKey: `cf_${def.key}`,
      header: def.label || def.key,
      cell: ({ getValue }) => {
        const value = getValue()
        if (value == null) return noValue
        if (Array.isArray(value)) {
          const normalized = value
            .map((item) => {
              if (item == null) return ''
              if (typeof item === 'string') return item.trim()
              return String(item).trim()
            })
            .filter((item) => item.length > 0)
          if (!normalized.length) return noValue
          return <span className="text-sm">{normalized.join(', ')}</span>
        }
        if (typeof value === 'boolean') {
          return (
            <span className="text-sm">
              {value
                ? t('customers.deals.list.booleanYes', 'Yes')
                : t('customers.deals.list.booleanNo', 'No')}
            </span>
          )
        }
        const stringValue = typeof value === 'string' ? value.trim() : String(value)
        if (!stringValue) return noValue
        return <span className="text-sm">{stringValue}</span>
      },
    }))

    return [
      {
        accessorKey: 'title',
        header: t('customers.deals.list.columns.title'),
        cell: ({ row }) => <span className="font-medium text-sm">{row.original.title}</span>,
      },
      {
        accessorKey: 'status',
        header: t('customers.deals.list.columns.status'),
        cell: ({ row }) => renderDictionaryCell('deal-statuses', row.original.status),
      },
      {
        accessorKey: 'pipelineStage',
        header: t('customers.deals.list.columns.pipelineStage'),
        cell: ({ row }) => renderDictionaryCell('pipeline-stages', row.original.pipelineStage),
      },
      {
        accessorKey: 'valueAmount',
        header: t('customers.deals.list.columns.value'),
        cell: ({ row }) => (
          <span className="text-sm font-medium">
            {formatCurrency(row.original.valueAmount ?? null, row.original.valueCurrency ?? null, t('customers.deals.list.noValue'))}
          </span>
        ),
      },
      {
        accessorKey: 'probability',
        header: t('customers.deals.list.columns.probability'),
        cell: ({ row }) => {
          const value = row.original.probability
          if (typeof value === 'number' && Number.isFinite(value)) {
            return <span className="text-sm">{`${Math.min(Math.max(value, 0), 100)}%`}</span>
          }
          return noValue
        },
      },
      {
        accessorKey: 'expectedCloseAt',
        header: t('customers.deals.list.columns.expectedClose'),
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDateValue(row.original.expectedCloseAt ?? null, t('customers.deals.list.noValue'))}
          </span>
        ),
      },
      {
        accessorKey: 'companies',
        header: t('customers.deals.list.columns.companies'),
        cell: ({ row }) => renderAssociationList(row.original.companies, t('customers.deals.list.unnamedCompany')),
      },
      {
        accessorKey: 'people',
        header: t('customers.deals.list.columns.people'),
        cell: ({ row }) => renderAssociationList(row.original.people, t('customers.deals.list.unnamedPerson')),
      },
      {
        accessorKey: 'updatedAt',
        header: t('customers.deals.list.columns.updatedAt'),
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDateValue(row.original.updatedAt ?? null, t('customers.deals.list.noValue'))}
          </span>
        ),
      },
      ...customColumns,
    ]
  }, [customFieldDefs, dictionaryMaps, t])

  return (
    <Page>
      <PageBody>
        <DataTable<DealRow>
          title={t('customers.deals.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/customers/deals/create">
                {t('customers.deals.list.actions.new', 'New deal')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          onRowClick={(row) => {
            router.push(`/backend/customers/deals/${row.id}`)
          }}
          rowActions={(row) => {
            const isDeleting = pendingDeleteId === row.id
            return (
              <RowActions
                items={[
                  {
                    label: t('customers.deals.list.actions.edit', 'Edit'),
                    onSelect: () => { router.push(`/backend/customers/deals/${row.id}`) },
                  },
                  {
                    label: t('customers.deals.list.actions.openInNewTab', 'Open in new tab'),
                    onSelect: () => {
                      if (typeof window !== 'undefined') {
                        window.open(`/backend/customers/deals/${row.id}`, '_blank', 'noopener')
                      }
                    },
                  },
                  {
                    label: isDeleting
                      ? t('customers.deals.list.actions.deleting', 'Deleting…')
                      : t('customers.deals.list.actions.delete', 'Delete'),
                    destructive: true,
                    onSelect: () => handleDeleteDeal(row.id),
                  },
                ]}
              />
            )
          }}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('customers.deals.list.searchPlaceholder')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: (nextPage) => setPage(nextPage),
            cacheStatus,
          }}
          isLoading={isLoading}
          refreshButton={{
            label: t('customers.deals.list.refresh'),
            onRefresh: handleRefresh,
          }}
          exporter={exportConfig}
          entityId={E.customers.customer_deal}
          perspective={{ tableId: 'customers.deals.list' }}
        />
      </PageBody>
    </Page>
  )
}

function mapDeal(item: Record<string, unknown>): DealRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const title = typeof item.title === 'string' ? item.title : ''
  const status = typeof item.status === 'string' ? item.status : null
  const pipelineStage = typeof item.pipeline_stage === 'string' ? item.pipeline_stage : null
  const valueAmountRaw = item.value_amount
  const valueAmount =
    typeof valueAmountRaw === 'number'
      ? valueAmountRaw
      : typeof valueAmountRaw === 'string' && valueAmountRaw.trim()
        ? Number(valueAmountRaw)
        : null
  const valueCurrency =
    typeof item.value_currency === 'string' && item.value_currency.trim().length
      ? item.value_currency.trim().toUpperCase()
      : null
  const probabilityRaw = item.probability
  const probability =
    typeof probabilityRaw === 'number'
      ? probabilityRaw
      : typeof probabilityRaw === 'string' && probabilityRaw.trim().length
        ? Number(probabilityRaw)
        : null
  const expectedCloseAt = typeof item.expected_close_at === 'string' ? item.expected_close_at : null
  const updatedAt = typeof item.updated_at === 'string' ? item.updated_at : null
  const peopleRaw = Array.isArray(item.people) ? item.people : []
  const companiesRaw = Array.isArray(item.companies) ? item.companies : []
  const people = peopleRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const data = entry as Record<string, unknown>
      const pid = typeof data.id === 'string' ? data.id : null
      if (!pid) return null
      const label = typeof data.label === 'string' ? data.label : ''
      return { id: pid, label }
    })
    .filter((entry): entry is { id: string; label: string } => !!entry)
  const companies = companiesRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const data = entry as Record<string, unknown>
      const cid = typeof data.id === 'string' ? data.id : null
      if (!cid) return null
      const label = typeof data.label === 'string' ? data.label : ''
      return { id: cid, label }
    })
    .filter((entry): entry is { id: string; label: string } => !!entry)
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('cf_')) customFields[key] = value
  }
  return {
    id,
    title,
    status,
    pipelineStage,
    valueAmount,
    valueCurrency,
    probability,
    expectedCloseAt,
    updatedAt,
    people,
    companies,
    ...customFields,
  }
}
