'use client'

import * as React from 'react'
import { Building2, CalendarDays, Globe, Link2, Users } from 'lucide-react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { cn } from '@open-mercato/shared/lib/utils'
import type {
  LinkEntityAdapter,
  LinkEntityFilterOption,
  LinkEntityOption,
  LinkEntityRowContext,
  LinkEntitySearchPage,
} from '../LinkEntityDialog'

type CompanyDetails = {
  industry: string | null
  domain: string | null
  websiteUrl: string | null
  peopleCount: number
  recentPeople: Array<{ id: string; name: string; role?: string | null }>
  lastContactAt: string | null
}

type CompanyAdapterOptions = {
  dialogTitle: string
  dialogSubtitle?: string
  sectionLabel?: string
  searchPlaceholder: string
  searchEmptyHint: string
  selectedEmptyHint: string
  confirmButtonLabel: string
  excludeLinkedPersonId?: string
  excludeIds?: string[]
  defaultAvatarIcon?: React.ReactNode
  pageSize?: number
  addNew?: LinkEntityAdapter<CompanyDetails>['addNew']
  industryOptions?: Array<{ id: string; label: string }>
  headerIcon?: React.ReactNode
}

const DEFAULT_PAGE_SIZE = 20

function normalizeCompanyRecord(record: Record<string, unknown>): LinkEntityOption | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? record.display_name.trim()
        : null
  const industry =
    typeof record.industry === 'string' && record.industry.trim().length
      ? record.industry.trim()
      : null
  const domain =
    typeof record.domain === 'string' && record.domain.trim().length
      ? record.domain.trim()
      : typeof record.websiteUrl === 'string' && record.websiteUrl.trim().length
        ? record.websiteUrl.trim()
        : typeof record.website_url === 'string' && record.website_url.trim().length
          ? record.website_url.trim()
          : typeof record.primaryEmail === 'string' && record.primaryEmail.trim().length
            ? record.primaryEmail.trim()
            : typeof record.primary_email === 'string' && record.primary_email.trim().length
              ? record.primary_email.trim()
              : null
  const label = displayName ?? domain ?? id
  const subtitle = domain && domain !== label ? domain : null
  return {
    id,
    label,
    subtitle,
    meta: {
      industry,
      domain,
    },
  }
}

async function fetchCompanyDetails(id: string): Promise<CompanyDetails> {
  try {
    const payload = await readApiResultOrThrow<Record<string, unknown>>(
      `/api/customers/companies/${encodeURIComponent(id)}`,
    )
    const industry = typeof payload.industry === 'string' ? payload.industry : null
    const domain =
      typeof payload.domain === 'string'
        ? payload.domain
        : typeof payload.websiteUrl === 'string'
          ? payload.websiteUrl
          : typeof payload.website_url === 'string'
            ? payload.website_url
            : null
    const websiteUrl =
      typeof payload.websiteUrl === 'string'
        ? payload.websiteUrl
        : typeof payload.website_url === 'string'
          ? payload.website_url
          : null
    const peopleRaw = Array.isArray(payload.people) ? payload.people : []
    const recentPeople = peopleRaw.slice(0, 3).map((entry) => {
      const record = entry as Record<string, unknown>
      const personId = typeof record.id === 'string' ? record.id : ''
      const name =
        typeof record.displayName === 'string'
          ? record.displayName
          : typeof record.display_name === 'string'
            ? record.display_name
            : personId
      const role =
        typeof record.roleValue === 'string'
          ? record.roleValue
          : typeof record.role === 'string'
            ? record.role
            : null
      return { id: personId, name, role }
    })
    return {
      industry,
      domain,
      websiteUrl,
      peopleCount: peopleRaw.length,
      recentPeople,
      lastContactAt:
        typeof payload.lastContactAt === 'string'
          ? payload.lastContactAt
          : typeof payload.last_contact_at === 'string'
            ? payload.last_contact_at
            : null,
    }
  } catch {
    return {
      industry: null,
      domain: null,
      websiteUrl: null,
      peopleCount: 0,
      recentPeople: [],
      lastContactAt: null,
    }
  }
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

export function createCompanyLinkAdapter(
  options: CompanyAdapterOptions,
): LinkEntityAdapter<CompanyDetails> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const industryOptions = options.industryOptions ?? []

  const filters:
    | {
        options: LinkEntityFilterOption[]
        defaultId?: string
        clientFilter?: (option: LinkEntityOption, filterId: string) => boolean
      }
    | undefined =
    industryOptions.length > 0
      ? {
          options: [{ id: 'all', label: 'All' }, ...industryOptions],
          defaultId: 'all',
          clientFilter: (option, filterId) => {
            if (!filterId || filterId === 'all') return true
            const meta = (option.meta ?? {}) as { industry?: string | null }
            return (meta.industry ?? '').toLowerCase() === filterId.toLowerCase()
          },
        }
      : undefined

  const searchPage = async (
    query: string,
    page: number,
    filterId?: string,
  ): Promise<LinkEntitySearchPage> => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortField: 'name',
      sortDir: 'asc',
    })
    if (query.trim().length > 0) {
      params.set('search', query.trim())
    }
    if (options.excludeLinkedPersonId) {
      params.set('excludeLinkedPersonId', options.excludeLinkedPersonId)
    }
    if (filterId && filterId !== 'all') {
      params.set('industry', filterId)
    }
    const payload = await readApiResultOrThrow<Record<string, unknown>>(
      `/api/customers/companies?${params.toString()}`,
    )
    const rawItems = Array.isArray(payload.items) ? payload.items : []
    const exclude = new Set(options.excludeIds ?? [])
    const items = rawItems
      .map((candidate) =>
        candidate && typeof candidate === 'object'
          ? normalizeCompanyRecord(candidate as Record<string, unknown>)
          : null,
      )
      .filter((entry): entry is LinkEntityOption => entry !== null && !exclude.has(entry.id))
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
        `/api/customers/companies?${params.toString()}`,
      )
      const rawItems = Array.isArray(payload.items) ? payload.items : []
      const byId = new Map<string, LinkEntityOption>()
      rawItems.forEach((record) => {
        if (!record || typeof record !== 'object') return
        const option = normalizeCompanyRecord(record as Record<string, unknown>)
        if (option) byId.set(option.id, option)
      })
      return uniqueIds.map((id) => byId.get(id) ?? { id, label: id, subtitle: null })
    } catch {
      return uniqueIds.map((id) => ({ id, label: id, subtitle: null }))
    }
  }

  const renderRow = (option: LinkEntityOption, ctx: LinkEntityRowContext): React.ReactNode => {
    const meta = (option.meta ?? {}) as { industry?: string | null; domain?: string | null }
    return (
      <>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-muted/80 text-muted-foreground">
          <Building2 className="size-[16px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {option.label}
            </span>
            {meta.industry ? (
              <span className="inline-flex items-center rounded-[4px] bg-muted px-1.5 py-[2px] text-[10px] font-semibold text-muted-foreground">
                {meta.industry}
              </span>
            ) : null}
          </div>
          {meta.domain ? (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta.domain}</div>
          ) : null}
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
    details?: CompanyDetails,
  ): React.ReactNode => {
    const meta = (option.meta ?? {}) as { industry?: string | null; domain?: string | null }
    const industry = details?.industry ?? meta.industry ?? null
    const domain = details?.domain ?? meta.domain ?? null
    const websiteUrl = details?.websiteUrl ?? null
    const people = details?.recentPeople ?? []
    return (
      <div className="flex flex-col gap-[14px] rounded-[12px] border border-border/70 bg-card p-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-muted/80 text-muted-foreground">
            <Building2 className="size-[22px]" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold text-foreground">{option.label}</div>
            {industry ? (
              <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{industry}</div>
            ) : null}
          </div>
        </div>

        {domain || websiteUrl ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
              Web
            </div>
            {websiteUrl ? (
              <div className="flex items-center gap-2.5 text-[12px] text-foreground">
                <Globe className="size-[14px] text-muted-foreground" />
                <a
                  href={websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  {websiteUrl}
                </a>
              </div>
            ) : domain ? (
              <div className="flex items-center gap-2.5 text-[12px] text-foreground">
                <Globe className="size-[14px] text-muted-foreground" />
                <span className="truncate">{domain}</span>
              </div>
            ) : null}
          </>
        ) : null}

        {people.length > 0 ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
              People ({details?.peopleCount ?? people.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {people.map((person) => (
                <div
                  key={person.id || person.name}
                  className="flex items-center gap-2 rounded-[8px] bg-muted/60 px-2.5 py-1.5"
                >
                  <Users className="size-[13px] text-muted-foreground" />
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

        {details?.lastContactAt ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <CalendarDays className="size-[13px]" />
              Last contact {formatRelative(details.lastContactAt)}
            </div>
          </>
        ) : null}
      </div>
    )
  }

  return {
    kind: 'company',
    dialogTitle: options.dialogTitle,
    dialogSubtitle: options.dialogSubtitle,
    sectionLabel: options.sectionLabel ?? 'MATCHING COMPANIES',
    searchPlaceholder: options.searchPlaceholder,
    searchEmptyHint: options.searchEmptyHint,
    selectedEmptyHint: options.selectedEmptyHint,
    confirmButtonLabel: options.confirmButtonLabel,
    defaultAvatarIcon: options.defaultAvatarIcon,
    headerIcon: options.headerIcon ?? <Link2 className="size-[18px]" />,
    filters,
    renderRow,
    renderPreview,
    fetchDetails: fetchCompanyDetails,
    searchPage,
    fetchByIds,
    addNew: options.addNew,
  }
}
