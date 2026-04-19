'use client'

import * as React from 'react'
import { AlertTriangle, Briefcase, CalendarDays, Link2 } from 'lucide-react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { cn } from '@open-mercato/shared/lib/utils'
import type {
  LinkEntityAdapter,
  LinkEntityOption,
  LinkEntityRowContext,
  LinkEntitySearchPage,
} from '../LinkEntityDialog'

type DealDetails = {
  id: string
  title: string
  code?: string | null
  createdAt?: string | null
  stage?: string | null
  pipeline?: { stages: Array<{ id: string; label: string }>; currentStageId?: string | null }
  value?: { amount: string; currency: string | null } | null
  nextStep?: { title: string; dueAt?: string | null; assignee?: string | null } | null
  keyPeople?: Array<{ id: string; name: string; role?: string | null }>
  anchors?: { companies: number; people: number }
  orphanWarningMessage?: string | null
}

type DealAdapterOptions = {
  dialogTitle: string
  dialogSubtitle?: string
  sectionLabel?: string
  searchPlaceholder: string
  searchEmptyHint: string
  selectedEmptyHint: string
  confirmButtonLabel: string
  orphanWarningTitle: string
  orphanWarningMessage: string
  excludeIds?: string[]
  defaultAvatarIcon?: React.ReactNode
  pageSize?: number
  addNew?: LinkEntityAdapter<DealDetails>['addNew']
  contextEntityId?: string
  headerIcon?: React.ReactNode
}

const DEFAULT_PAGE_SIZE = 20

function parseStatusFilter(filterId?: string): string | null {
  if (!filterId || filterId === 'all' || filterId === 'orphan') return null
  return filterId
}

function normalizeDealRecord(record: Record<string, unknown>): LinkEntityOption | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const title =
    typeof record.title === 'string' && record.title.trim().length
      ? record.title.trim()
      : typeof record.name === 'string' && record.name.trim().length
        ? record.name.trim()
        : null
  const label = title ?? id
  const code =
    typeof record.code === 'string'
      ? record.code
      : typeof record.reference === 'string'
        ? record.reference
        : null
  const valueAmount =
    typeof record.valueAmount === 'string'
      ? record.valueAmount
      : typeof record.value_amount === 'string'
        ? record.value_amount
        : typeof record.value === 'number'
          ? String(record.value)
          : null
  const valueCurrency =
    typeof record.valueCurrency === 'string'
      ? record.valueCurrency
      : typeof record.value_currency === 'string'
        ? record.value_currency
        : null
  const stage =
    typeof record.pipelineStage === 'string'
      ? record.pipelineStage
      : typeof record.pipeline_stage === 'string'
        ? record.pipeline_stage
        : typeof record.status === 'string'
          ? record.status
          : null
  const updatedAt =
    typeof record.updatedAt === 'string'
      ? record.updatedAt
      : typeof record.updated_at === 'string'
        ? record.updated_at
        : typeof record.createdAt === 'string'
          ? record.createdAt
          : typeof record.created_at === 'string'
            ? record.created_at
            : null
  const anchorCompanies =
    typeof (record.companies as { length?: number })?.length === 'number'
      ? (record.companies as unknown[]).length
      : typeof record.companyCount === 'number'
        ? record.companyCount
        : null
  const isOrphan = anchorCompanies !== null ? anchorCompanies === 0 : undefined
  const companyName =
    typeof record.companyName === 'string'
      ? record.companyName
      : Array.isArray(record.companies) && record.companies.length > 0
        ? (record.companies[0] as Record<string, unknown>).displayName ||
          (record.companies[0] as Record<string, unknown>).display_name ||
          null
        : null
  return {
    id,
    label,
    subtitle: null,
    meta: {
      code,
      valueAmount,
      valueCurrency,
      stage,
      updatedAt,
      isOrphan,
      companyName: typeof companyName === 'string' ? companyName : null,
    },
  }
}

async function fetchDealDetails(id: string, contextEntityId?: string): Promise<DealDetails> {
  try {
    const payload = await readApiResultOrThrow<Record<string, unknown>>(
      `/api/customers/deals/${encodeURIComponent(id)}`,
    )
    const title =
      typeof payload.title === 'string' && payload.title.trim().length
        ? payload.title.trim()
        : typeof payload.name === 'string' && payload.name.trim().length
          ? payload.name.trim()
          : id
    const code =
      typeof payload.code === 'string'
        ? payload.code
        : typeof payload.reference === 'string'
          ? payload.reference
          : null
    const createdAt =
      typeof payload.createdAt === 'string'
        ? payload.createdAt
        : typeof payload.created_at === 'string'
          ? payload.created_at
          : null
    const valueAmount =
      typeof payload.valueAmount === 'string'
        ? payload.valueAmount
        : typeof payload.value_amount === 'string'
          ? payload.value_amount
          : null
    const valueCurrency =
      typeof payload.valueCurrency === 'string'
        ? payload.valueCurrency
        : typeof payload.value_currency === 'string'
          ? payload.value_currency
          : null
    const stage =
      typeof payload.pipelineStage === 'string'
        ? payload.pipelineStage
        : typeof payload.pipeline_stage === 'string'
          ? payload.pipeline_stage
          : null
    const companies = Array.isArray(payload.companies) ? payload.companies : []
    const people = Array.isArray(payload.people) ? payload.people : []
    const companiesCount = companies.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const companyId = (entry as Record<string, unknown>).id
      return typeof companyId === 'string' && (!contextEntityId || companyId !== contextEntityId)
    }).length
    const peopleCount = people.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const personId = (entry as Record<string, unknown>).id
      return typeof personId === 'string' && (!contextEntityId || personId !== contextEntityId)
    }).length
    const keyPeople = people.slice(0, 3).map((entry) => {
      const record = entry as Record<string, unknown>
      const personId = typeof record.id === 'string' ? record.id : ''
      const name =
        typeof record.displayName === 'string'
          ? record.displayName
          : typeof record.display_name === 'string'
            ? record.display_name
            : personId
      const role =
        typeof record.role === 'string'
          ? record.role
          : typeof record.roleLabel === 'string'
            ? record.roleLabel
            : null
      return { id: personId, name, role }
    })
    return {
      id,
      title,
      code,
      createdAt,
      stage,
      value: valueAmount ? { amount: valueAmount, currency: valueCurrency ?? null } : null,
      nextStep: null,
      keyPeople,
      anchors: { companies: companiesCount, people: peopleCount },
    }
  } catch {
    return {
      id,
      title: id,
      code: null,
      createdAt: null,
      stage: null,
      value: null,
      nextStep: null,
      keyPeople: [],
      anchors: { companies: 0, people: 0 },
    }
  }
}

function formatValue(amount: string | null, currency: string | null): string | null {
  if (!amount) return null
  const parsed = parseFloat(amount)
  if (!Number.isFinite(parsed)) return amount
  const formatted = parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return currency ? `${formatted} ${currency}` : formatted
}

function formatRelative(dateString: string | null): string {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    const now = Date.now()
    const diffMs = now - date.getTime()
    const diffDays = Math.floor(diffMs / 86_400_000)
    if (diffDays <= 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 30) return `${diffDays} days ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
    return `${Math.floor(diffDays / 365)} years ago`
  } catch {
    return ''
  }
}

export function createDealLinkAdapter(options: DealAdapterOptions): LinkEntityAdapter<DealDetails> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE

  const filters = {
    options: [
      { id: 'all', label: 'All' },
      { id: 'open', label: 'Open' },
      { id: 'win', label: 'Won' },
      { id: 'loose', label: 'Lost' },
      { id: 'orphan', label: 'Orphan', dotColor: '#eb9426' },
    ],
    defaultId: 'all',
    clientFilter: (option: LinkEntityOption, filterId: string) => {
      if (!filterId || filterId === 'all') return true
      const meta = (option.meta ?? {}) as { isOrphan?: boolean; stage?: string | null }
      if (filterId === 'orphan') return meta.isOrphan === true
      // Server-side status filter already applied; this keeps all rows if server honored the filter.
      // Fallback client check on stage in case server returns mixed statuses.
      if (filterId === 'open' || filterId === 'win' || filterId === 'loose') {
        return (meta.stage ?? '').toLowerCase().includes(filterId) || true
      }
      return true
    },
  }

  const searchPage = async (
    query: string,
    page: number,
    filterId?: string,
  ): Promise<LinkEntitySearchPage> => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (query.trim().length > 0) {
      params.set('search', query.trim())
    }
    const status = parseStatusFilter(filterId)
    if (status) {
      params.set('status', status)
    }
    const payload = await readApiResultOrThrow<Record<string, unknown>>(
      `/api/customers/deals?${params.toString()}`,
    )
    const rawItems = Array.isArray(payload.items) ? payload.items : []
    const exclude = new Set(options.excludeIds ?? [])
    let items = rawItems
      .map((candidate) =>
        candidate && typeof candidate === 'object'
          ? normalizeDealRecord(candidate as Record<string, unknown>)
          : null,
      )
      .filter((entry): entry is LinkEntityOption => entry !== null && !exclude.has(entry.id))
    if (filterId === 'orphan') {
      items = items.filter((item) => (item.meta as { isOrphan?: boolean }).isOrphan === true)
    }
    const totalPages = typeof payload.totalPages === 'number' ? payload.totalPages : 1
    const total = typeof payload.total === 'number' ? payload.total : undefined
    return { items, totalPages, total }
  }

  const fetchByIds = async (ids: string[]): Promise<LinkEntityOption[]> => {
    const uniqueIds = Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)))
    if (!uniqueIds.length) return []
    const params = new URLSearchParams({
      ids: uniqueIds.join(','),
      pageSize: String(Math.max(uniqueIds.length, 1)),
    })
    try {
      const payload = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
        `/api/customers/deals?${params.toString()}`,
      )
      const rawItems = Array.isArray(payload.items) ? payload.items : []
      const byId = new Map<string, LinkEntityOption>()
      rawItems.forEach((record) => {
        if (!record || typeof record !== 'object') return
        const option = normalizeDealRecord(record as Record<string, unknown>)
        if (option) byId.set(option.id, option)
      })
      return uniqueIds.map((id) => byId.get(id) ?? { id, label: id, subtitle: null })
    } catch {
      return uniqueIds.map((id) => ({ id, label: id, subtitle: null }))
    }
  }

  const renderRow = (option: LinkEntityOption, ctx: LinkEntityRowContext): React.ReactNode => {
    const meta = (option.meta ?? {}) as {
      code?: string | null
      valueAmount?: string | null
      valueCurrency?: string | null
      stage?: string | null
      updatedAt?: string | null
      isOrphan?: boolean
      companyName?: string | null
    }
    const formattedValue = formatValue(meta.valueAmount ?? null, meta.valueCurrency ?? null)
    return (
      <>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-muted/80 text-muted-foreground">
          <Briefcase className="size-[16px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {option.label}
            </span>
            {meta.code ? (
              <span className="inline-flex items-center rounded-[4px] bg-muted px-1.5 py-[2px] text-[10px] font-semibold uppercase text-muted-foreground">
                {meta.code}
              </span>
            ) : null}
            {meta.isOrphan ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff2e0] px-2 py-[2px] text-[11px] font-semibold text-[#eb9426]">
                <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-[#eb9426]" />
                no company
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {formattedValue ? (
              <span className="font-semibold text-foreground">{formattedValue}</span>
            ) : null}
            {meta.stage ? (
              <>
                <span aria-hidden="true" className="inline-block size-1 rounded-full bg-muted-foreground" />
                <span>{meta.stage}</span>
              </>
            ) : null}
            {meta.companyName ? (
              <>
                <span aria-hidden="true" className="inline-block size-1 rounded-full bg-muted-foreground" />
                <span className="truncate">{meta.companyName}</span>
              </>
            ) : null}
            {meta.updatedAt ? (
              <>
                <span aria-hidden="true" className="inline-block size-1 rounded-full bg-muted-foreground" />
                <span>{formatRelative(meta.updatedAt)}</span>
              </>
            ) : null}
          </div>
        </div>
        <span
          role="checkbox"
          aria-checked={ctx.selected}
          aria-label={`Select ${option.label}`}
          className={cn(
            'inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border',
            ctx.selected
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-background',
          )}
        >
          {ctx.selected ? (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 6.5l2.5 2.5 4.5-5" />
            </svg>
          ) : null}
        </span>
      </>
    )
  }

  const renderPreview = (
    option: LinkEntityOption,
    details?: DealDetails,
  ): React.ReactNode => {
    const meta = (option.meta ?? {}) as {
      code?: string | null
      valueAmount?: string | null
      valueCurrency?: string | null
      isOrphan?: boolean
    }
    const derived = details ?? {
      id: option.id,
      title: option.label,
      code: meta.code ?? null,
      createdAt: null,
      stage: null,
      value: meta.valueAmount ? { amount: meta.valueAmount, currency: meta.valueCurrency ?? null } : null,
      nextStep: null,
      keyPeople: [],
      anchors: undefined,
    }
    const isOrphan = meta.isOrphan || (derived.anchors ? derived.anchors.companies === 0 : false)
    const formattedValue = derived.value ? formatValue(derived.value.amount, derived.value.currency) : null
    const createdRel = derived.createdAt ? `Created ${formatRelative(derived.createdAt)}` : null
    return (
      <div className="flex flex-col gap-[14px] rounded-[12px] border border-border/70 bg-card p-[18px]">
        <div>
          <div className="text-[16px] font-bold text-foreground">{derived.title}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {derived.code ? <span>{derived.code}</span> : null}
            {derived.code && createdRel ? <span>·</span> : null}
            {createdRel ? <span>{createdRel}</span> : null}
          </div>
        </div>

        {isOrphan ? (
          <div className="flex items-start gap-2 rounded-[8px] bg-[#fff2e0] px-3 py-2.5">
            <AlertTriangle className="mt-[2px] size-[14px] text-[#eb9426]" />
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[#eb9426]">
                {options.orphanWarningTitle}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {options.orphanWarningMessage}
              </div>
            </div>
          </div>
        ) : null}

        {formattedValue ? (
          <div className="flex items-baseline gap-3">
            <div className="text-[22px] font-bold text-foreground">{formattedValue}</div>
            <div className="text-[11px] text-muted-foreground">potential value</div>
          </div>
        ) : null}

        {derived.stage ? (
          <>
            <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
              Stage
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-foreground" />
              <span className="text-[12px] font-semibold text-foreground">{derived.stage}</span>
            </div>
          </>
        ) : null}

        {derived.nextStep ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
              Next step
            </div>
            <div className="flex items-start gap-2">
              <CalendarDays className="mt-[2px] size-[13px] text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-foreground">
                  {derived.nextStep.title}
                </div>
                {derived.nextStep.assignee ? (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Assigned: {derived.nextStep.assignee}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        {derived.keyPeople && derived.keyPeople.length > 0 ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
              Key people ({derived.keyPeople.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {derived.keyPeople.map((person) => (
                <div
                  key={person.id || person.name}
                  className="flex items-center gap-2 rounded-[8px] bg-muted/60 px-2.5 py-1.5"
                >
                  <Avatar label={person.name} variant="monochrome" size="sm" />
                  <span className="text-[12px] font-semibold text-foreground">{person.name}</span>
                  {person.role ? (
                    <span className="ml-auto inline-flex items-center rounded-[4px] border border-border px-1.5 py-[2px] text-[10px] font-semibold text-muted-foreground">
                      {person.role}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    )
  }

  const computeOrphanWarning = async (option: LinkEntityOption): Promise<string | null> => {
    const details = await fetchDealDetails(option.id, options.contextEntityId)
    const anchors = details.anchors ?? { companies: 0, people: 0 }
    return anchors.companies + anchors.people < 1 ? options.orphanWarningMessage : null
  }

  return {
    kind: 'deal',
    dialogTitle: options.dialogTitle,
    dialogSubtitle: options.dialogSubtitle,
    sectionLabel: options.sectionLabel ?? 'MATCHING DEALS',
    searchPlaceholder: options.searchPlaceholder,
    searchEmptyHint: options.searchEmptyHint,
    selectedEmptyHint: options.selectedEmptyHint,
    confirmButtonLabel: options.confirmButtonLabel,
    defaultAvatarIcon: options.defaultAvatarIcon,
    headerIcon: options.headerIcon ?? <Link2 className="size-[18px]" />,
    filters,
    renderRow,
    renderPreview,
    fetchDetails: (id) => fetchDealDetails(id, options.contextEntityId),
    searchPage,
    fetchByIds,
    computeOrphanWarning,
    addNew: options.addNew,
  }
}
