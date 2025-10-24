"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import {
  DictionaryValue,
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../lib/dictionaries'
import {
  useCustomFieldDefs,
  filterCustomFieldDefs,
} from '@open-mercato/ui/backend/utils/customFieldDefs'
import { ensureCustomerDictionary } from '../../../components/detail/hooks/useCustomerDictionary'

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

function formatTagLabel(name: string | null | undefined, id: string): string {
  const display = name && name.trim().length ? name.trim() : id.slice(0, 8)
  return `${display} (${id.slice(0, 8)})`
}

function extractIdsFromParams(params: URLSearchParams | null | undefined, key: string): string[] {
  if (!params) return []
  const values = params.getAll(key)
  return normalizeIdCandidates(values)
}

async function fetchCustomerOptions(
  kind: 'people' | 'companies',
  query?: string,
): Promise<FilterOption[]> {
  const search = new URLSearchParams()
  search.set('page', '1')
  search.set('pageSize', '20')
  if (query && query.trim().length) search.set('search', query.trim())
  try {
    const res = await apiFetch(`/api/customers/${kind}?${search.toString()}`)
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    const items = Array.isArray(data?.items) ? data.items : []
    return items
      .map((item: any) => {
        const id = typeof item?.id === 'string' ? item.id : null
        const labelSource = typeof item?.display_name === 'string' ? item.display_name : null
        if (!id || !isUuid(id)) return null
        return { value: id, label: formatTagLabel(labelSource, id) }
      })
      .filter((opt): opt is FilterOption => !!opt)
  } catch {
    return []
  }
}

async function fetchCustomerOptionsByIds(kind: 'people' | 'companies', ids: string[]): Promise<FilterOption[]> {
  const unique = Array.from(new Set(ids.filter((id) => isUuid(id))))
  if (!unique.length) return []
  const results = await Promise.all(
    unique.map(async (id) => {
      const search = new URLSearchParams()
      search.set('id', id)
      search.set('page', '1')
      search.set('pageSize', '1')
      try {
        const res = await apiFetch(`/api/customers/${kind}?${search.toString()}`)
        if (!res.ok) return null
        const data = await res.json().catch(() => ({}))
        const items = Array.isArray(data?.items) ? data.items : []
        const match = items.find((item: any) => typeof item?.id === 'string' && item.id === id)
        const labelSource = typeof match?.display_name === 'string' ? match.display_name : null
        return { value: id, label: formatTagLabel(labelSource, id) }
      } catch {
        return { value: id, label: formatTagLabel(null, id) }
      }
    }),
  )
  return results.filter((opt): opt is FilterOption => !!opt)
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
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

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

  const [personOptions, setPersonOptions] = React.useState<FilterOption[]>([])
  const [companyOptions, setCompanyOptions] = React.useState<FilterOption[]>([])
  const [personIdToLabel, setPersonIdToLabel] = React.useState<Record<string, string>>({})
  const [personLabelToId, setPersonLabelToId] = React.useState<Record<string, string>>({})
  const [companyIdToLabel, setCompanyIdToLabel] = React.useState<Record<string, string>>({})
  const [companyLabelToId, setCompanyLabelToId] = React.useState<Record<string, string>>({})

  const applyPersonOptions = React.useCallback((options: FilterOption[]) => {
    if (!options.length) return
    setPersonOptions((prev) => {
      const map = new Map<string, FilterOption>()
      prev.forEach((opt) => map.set(opt.value, opt))
      options.forEach((opt) => map.set(opt.value, opt))
      return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
    })
    setPersonIdToLabel((prev) => {
      const next = { ...prev }
      options.forEach((opt) => { next[opt.value] = opt.label })
      return next
    })
    setPersonLabelToId((prev) => {
      const next = { ...prev }
      options.forEach((opt) => { next[opt.label] = opt.value })
      return next
    })
  }, [])

  const applyCompanyOptions = React.useCallback((options: FilterOption[]) => {
    if (!options.length) return
    setCompanyOptions((prev) => {
      const map = new Map<string, FilterOption>()
      prev.forEach((opt) => map.set(opt.value, opt))
      options.forEach((opt) => map.set(opt.value, opt))
      return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
    })
    setCompanyIdToLabel((prev) => {
      const next = { ...prev }
      options.forEach((opt) => { next[opt.value] = opt.label })
      return next
    })
    setCompanyLabelToId((prev) => {
      const next = { ...prev }
      options.forEach((opt) => { next[opt.label] = opt.value })
      return next
    })
  }, [])

  React.useEffect(() => {
    let cancelled = false
    if (!selectedPersonIds.length) return
    const missing = selectedPersonIds.filter((id) => !personIdToLabel[id])
    if (!missing.length) return
    fetchCustomerOptionsByIds('people', missing).then((opts) => {
      if (cancelled) return
      applyPersonOptions(opts)
    })
    return () => { cancelled = true }
  }, [selectedPersonIds, personIdToLabel, applyPersonOptions])

  React.useEffect(() => {
    let cancelled = false
    if (!selectedCompanyIds.length) return
    const missing = selectedCompanyIds.filter((id) => !companyIdToLabel[id])
    if (!missing.length) return
    fetchCustomerOptionsByIds('companies', missing).then((opts) => {
      if (cancelled) return
      applyCompanyOptions(opts)
    })
    return () => { cancelled = true }
  }, [selectedCompanyIds, companyIdToLabel, applyCompanyOptions])

  const loadPeopleOptions = React.useCallback(async (query?: string) => {
    const options = await fetchCustomerOptions('people', query)
    applyPersonOptions(options)
    return options
  }, [applyPersonOptions])

  const loadCompanyOptions = React.useCallback(async (query?: string) => {
    const options = await fetchCustomerOptions('companies', query)
    applyCompanyOptions(options)
    return options
  }, [applyCompanyOptions])

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
  }, [fetchDictionaryEntries])

  const syncFilterLabels = React.useCallback((key: 'people' | 'companies', ids: string[], idToLabel: Record<string, string>) => {
    const labels = ids.map((id) => idToLabel[id] ?? formatTagLabel(null, id))
    setFilterValues((prev) => {
      const prevLabels = Array.isArray(prev[key]) ? (prev[key] as string[]) : []
      if (labels.length === 0) {
        if (!prevLabels.length) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      if (arraysEqual(prevLabels, labels)) return prev
      return { ...prev, [key]: labels }
    })
  }, [])

  React.useEffect(() => {
    syncFilterLabels('people', selectedPersonIds, personIdToLabel)
  }, [selectedPersonIds, personIdToLabel, syncFilterLabels])

  React.useEffect(() => {
    syncFilterLabels('companies', selectedCompanyIds, companyIdToLabel)
  }, [selectedCompanyIds, companyIdToLabel, syncFilterLabels])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value.trim())
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const extractIds = (labels: unknown[], labelToId: Record<string, string>): string[] => {
      if (!Array.isArray(labels)) return []
      return labels
        .map((label) => {
          if (typeof label !== 'string') return null
          const trimmed = label.trim()
          if (!trimmed.length) return null
          const mapped = labelToId[trimmed]
          if (mapped && isUuid(mapped)) return mapped
          const match = trimmed.match(UUID_REGEX)
          return match ? match[0] : null
        })
        .filter((id): id is string => !!id)
    }
    const nextPeopleIds = extractIds(values.people as string[] || [], personLabelToId)
    const nextCompanyIds = extractIds(values.companies as string[] || [], companyLabelToId)
    setSelectedPersonIds(Array.from(new Set(nextPeopleIds)))
    setSelectedCompanyIds(Array.from(new Set(nextCompanyIds)))
    setFilterValues(values)
    setPage(1)
  }, [personLabelToId, companyLabelToId])

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
      try {
        const res = await apiFetch(`/api/customers/deals?${queryParams}`)
        if (!res.ok) {
          const details = await res.json().catch(() => ({}))
          const message =
            typeof details?.error === 'string'
              ? details.error
              : t('customers.deals.list.error.load')
          flash(message, 'error')
          return
        }
        const payload: DealsResponse = await res.json().catch(() => ({}))
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        const mapped = items
          .map((item) => mapDeal(item as Record<string, unknown>))
          .filter((row): row is DealRow => !!row)
        setRows(mapped)
        setTotal(typeof payload.total === 'number' ? payload.total : mapped.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
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
    setReloadToken((token) => token + 1)
  }, [])

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
        cell: ({ row }) => {
          if (!row.original.companies.length) return noValue
          return (
            <ul className="flex flex-wrap gap-1 text-sm">
              {row.original.companies.map((company) => (
                <li key={company.id} className="rounded border px-2 py-0.5 text-xs bg-muted">
                  {company.label || company.id.slice(0, 8)}
                </li>
              ))}
            </ul>
          )
        },
      },
      {
        accessorKey: 'people',
        header: t('customers.deals.list.columns.people'),
        cell: ({ row }) => {
          if (!row.original.people.length) return noValue
          return (
            <ul className="flex flex-wrap gap-1 text-sm">
              {row.original.people.map((person) => (
                <li key={person.id} className="rounded border px-2 py-0.5 text-xs bg-muted">
                  {person.label || person.id.slice(0, 8)}
                </li>
              ))}
            </ul>
          )
        },
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
          columns={columns}
          data={rows}
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
          }}
          isLoading={isLoading}
          refreshButton={{
            label: t('customers.deals.list.refresh'),
            onRefresh: handleRefresh,
          }}
          exporter={exportConfig}
          entityId={E.customers.customer_deal}
        />
      </PageBody>
    </Page>
  )
}
