'use client'

import * as React from 'react'
import { Building2, CalendarDays, Link2, Mail, Phone } from 'lucide-react'
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

export type PersonLinkSettings = {
  role: string | null
  isPrimary: boolean
}

type PersonDetails = {
  contactEmails: string[]
  contactPhones: string[]
  linkedCompanies: Array<{ id: string; name: string; isPrimary?: boolean }>
  recentActivity: { title: string; occurredAt: string | null; summary?: string | null } | null
}

type PersonAdapterOptions = {
  dialogTitle: string
  dialogSubtitle?: string
  sectionLabel?: string
  searchPlaceholder: string
  searchEmptyHint: string
  selectedEmptyHint: string
  confirmButtonLabel: string
  excludeLinkedCompanyId?: string
  excludeIds?: string[]
  defaultAvatarIcon?: React.ReactNode
  pageSize?: number
  addNew?: LinkEntityAdapter<PersonDetails, PersonLinkSettings>['addNew']
  showLinkSettings?: boolean
  roleOptions?: Array<{ id: string; label: string }>
  headerIcon?: React.ReactNode
}

const DEFAULT_PAGE_SIZE = 20

type RecentActivityPayload = {
  title?: string | null
  occurredAt?: string | null
  summary?: string | null
  description?: string | null
} | null

function normalizePersonRecord(record: Record<string, unknown>): LinkEntityOption | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? record.display_name.trim()
        : null
  if (!displayName) return null
  const subtitleSource =
    typeof record.primaryEmail === 'string' && record.primaryEmail.trim().length
      ? record.primaryEmail.trim()
      : typeof record.primary_email === 'string' && record.primary_email.trim().length
        ? record.primary_email.trim()
        : typeof record.jobTitle === 'string' && record.jobTitle.trim().length
          ? record.jobTitle.trim()
          : typeof record.job_title === 'string' && record.job_title.trim().length
            ? record.job_title.trim()
            : null
  const role =
    typeof record.roleValue === 'string' && record.roleValue.trim().length
      ? record.roleValue.trim()
      : typeof record.role === 'string' && record.role.trim().length
        ? record.role.trim()
        : null
  const jobTitle =
    typeof record.jobTitle === 'string'
      ? record.jobTitle
      : typeof record.job_title === 'string'
        ? record.job_title
        : null
  const alreadyLinked =
    record.alreadyLinked === true ||
    record.already_linked === true ||
    record.excludedByLink === true
  return {
    id,
    label: displayName,
    subtitle: subtitleSource,
    meta: {
      role,
      jobTitle,
      alreadyLinked,
      primaryEmail:
        typeof record.primaryEmail === 'string'
          ? record.primaryEmail
          : typeof record.primary_email === 'string'
            ? record.primary_email
            : null,
      primaryPhone:
        typeof record.primaryPhone === 'string'
          ? record.primaryPhone
          : typeof record.primary_phone === 'string'
            ? record.primary_phone
            : null,
    },
  }
}

async function fetchPersonDetails(id: string): Promise<PersonDetails> {
  try {
    const payload = await readApiResultOrThrow<Record<string, unknown>>(
      `/api/customers/people/${encodeURIComponent(id)}`,
    )
    const emails: string[] = []
    const phones: string[] = []
    if (typeof payload.primaryEmail === 'string' && payload.primaryEmail.trim().length) {
      emails.push(payload.primaryEmail.trim())
    } else if (typeof payload.primary_email === 'string' && payload.primary_email.trim().length) {
      emails.push(payload.primary_email.trim())
    }
    if (typeof payload.primaryPhone === 'string' && payload.primaryPhone.trim().length) {
      phones.push(payload.primaryPhone.trim())
    } else if (typeof payload.primary_phone === 'string' && payload.primary_phone.trim().length) {
      phones.push(payload.primary_phone.trim())
    }
    const companies: Array<{ id: string; name: string; isPrimary?: boolean }> = []
    const rawCompanies = Array.isArray(payload.companies) ? payload.companies : []
    rawCompanies.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const record = entry as Record<string, unknown>
      const companyId = typeof record.id === 'string' ? record.id : null
      const name =
        typeof record.displayName === 'string'
          ? record.displayName
          : typeof record.display_name === 'string'
            ? record.display_name
            : null
      if (!companyId || !name) return
      companies.push({ id: companyId, name, isPrimary: Boolean(record.isPrimary ?? record.is_primary) })
    })
    let recentActivity: PersonDetails['recentActivity'] = null
    const activities = Array.isArray(payload.interactions)
      ? (payload.interactions as RecentActivityPayload[])
      : Array.isArray(payload.activities)
        ? (payload.activities as RecentActivityPayload[])
        : Array.isArray((payload.plannedActivitiesPreview as unknown[]))
          ? (payload.plannedActivitiesPreview as RecentActivityPayload[])
          : []
    if (activities.length > 0) {
      const entry = activities[0]
      if (entry && typeof entry === 'object') {
        recentActivity = {
          title: (entry.title ?? '').toString() || 'Interaction',
          occurredAt: typeof entry.occurredAt === 'string' ? entry.occurredAt : null,
          summary:
            typeof entry.summary === 'string'
              ? entry.summary
              : typeof entry.description === 'string'
                ? entry.description
                : null,
        }
      }
    }
    return { contactEmails: emails, contactPhones: phones, linkedCompanies: companies, recentActivity }
  } catch {
    return { contactEmails: [], contactPhones: [], linkedCompanies: [], recentActivity: null }
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

export function createPersonLinkAdapter(
  options: PersonAdapterOptions,
): LinkEntityAdapter<PersonDetails, PersonLinkSettings> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const roleOptions = options.roleOptions ?? []

  const roleKeywords = new Map<string, string[]>(
    roleOptions.map((role) => [
      role.id,
      // build keyword list: id (as words), label words, lowercased
      [
        role.id.replace(/_/g, ' ').toLowerCase(),
        role.label.toLowerCase(),
      ],
    ]),
  )

  const filters:
    | {
        options: LinkEntityFilterOption[]
        defaultId?: string
        clientFilter?: (option: LinkEntityOption, filterId: string) => boolean
      }
    | undefined =
    roleOptions.length > 0
      ? {
          options: [
            { id: 'all', label: 'All' },
            ...roleOptions.map((role) => ({ id: role.id, label: role.label })),
          ],
          defaultId: 'all',
          clientFilter: (option, filterId) => {
            if (!filterId || filterId === 'all') return true
            const meta = (option.meta ?? {}) as {
              role?: string | null
              jobTitle?: string | null
            }
            const keywords = roleKeywords.get(filterId) ?? []
            const fields = [
              meta.role?.toLowerCase() ?? '',
              meta.jobTitle?.toLowerCase() ?? '',
              option.subtitle?.toLowerCase() ?? '',
            ]
            return keywords.some((keyword) =>
              fields.some((field) => field.includes(keyword)),
            )
          },
        }
      : undefined

  const searchPage = async (
    query: string,
    page: number,
    _filterId?: string,
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
    if (options.excludeLinkedCompanyId) {
      params.set('excludeLinkedCompanyId', options.excludeLinkedCompanyId)
    }
    const payload = await readApiResultOrThrow<Record<string, unknown>>(
      `/api/customers/people?${params.toString()}`,
    )
    const rawItems = Array.isArray(payload.items) ? payload.items : []
    const exclude = new Set(options.excludeIds ?? [])
    const items = rawItems
      .map((candidate) =>
        candidate && typeof candidate === 'object'
          ? normalizePersonRecord(candidate as Record<string, unknown>)
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
        `/api/customers/people?${params.toString()}`,
      )
      const rawItems = Array.isArray(payload.items) ? payload.items : []
      const byId = new Map<string, LinkEntityOption>()
      rawItems.forEach((record) => {
        if (!record || typeof record !== 'object') return
        const option = normalizePersonRecord(record as Record<string, unknown>)
        if (option) byId.set(option.id, option)
      })
      return uniqueIds.map((id) => byId.get(id) ?? { id, label: id, subtitle: null })
    } catch {
      return uniqueIds.map((id) => ({ id, label: id, subtitle: null }))
    }
  }

  const renderRow = (option: LinkEntityOption, ctx: LinkEntityRowContext): React.ReactNode => {
    const meta = (option.meta ?? {}) as {
      role?: string | null
      jobTitle?: string | null
      primaryEmail?: string | null
    }
    const rolePill = meta.role ?? meta.jobTitle ?? null
    return (
      <>
        <Avatar label={option.label} variant="monochrome" size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {option.label}
            </span>
            {rolePill ? (
              <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                {rolePill}
              </span>
            ) : null}
          </div>
          {option.subtitle ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {option.subtitle}
            </div>
          ) : null}
        </div>
        <span
          role="checkbox"
          aria-checked={ctx.selected}
          aria-label={`Select ${option.label}`}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
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
    details?: PersonDetails,
  ): React.ReactNode => {
    const meta = (option.meta ?? {}) as { jobTitle?: string | null; primaryPhone?: string | null; primaryEmail?: string | null }
    const email = details?.contactEmails?.[0] ?? meta.primaryEmail ?? null
    const phone = details?.contactPhones?.[0] ?? meta.primaryPhone ?? null
    const companies = details?.linkedCompanies ?? []
    const activity = details?.recentActivity ?? null
    const subtitle = option.subtitle ?? meta.jobTitle ?? null
    return (
      <div className="flex flex-col gap-3.5 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center gap-3">
          <Avatar label={option.label} variant="monochrome" size="lg" />
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-foreground">{option.label}</div>
            {subtitle ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
        </div>

        {email || phone ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
              Contact
            </div>
            {email ? (
              <div className="flex items-center gap-2.5 text-xs text-foreground">
                <Mail className="size-3.5 text-muted-foreground" />
                <span className="truncate">{email}</span>
              </div>
            ) : null}
            {phone ? (
              <div className="flex items-center gap-2.5 text-xs text-foreground">
                <Phone className="size-3.5 text-muted-foreground" />
                <span className="truncate">{phone}</span>
              </div>
            ) : null}
          </>
        ) : null}

        {companies.length > 0 ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
              Linked companies ({companies.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {companies.map((company) => (
                <div
                  key={company.id}
                  className="flex items-center gap-2 rounded-md bg-muted/70 px-2.5 py-1.5 text-xs font-semibold text-foreground"
                >
                  <Building2 className="size-3 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{company.name}</span>
                  {company.isPrimary ? (
                    <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                      PRIMARY
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {activity ? (
          <>
            <div className="h-px w-full bg-border/70" />
            <div className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
              Recent activity
            </div>
            <div className="flex items-start gap-2">
              <CalendarDays className="mt-0.5 size-3 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-foreground">
                  {activity.title}
                  {activity.occurredAt ? (
                    <span className="text-muted-foreground"> · {formatRelative(activity.occurredAt)}</span>
                  ) : null}
                </div>
                {activity.summary ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {activity.summary}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  const renderLinkSettings = options.showLinkSettings
    ? (
        settings: PersonLinkSettings,
        onChange: (next: PersonLinkSettings) => void,
      ): React.ReactNode => {
        const currentRole = settings.role ?? ''
        return (
          <div className="flex flex-col gap-3">
            {roleOptions.length > 0 ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Role at company</span>
                <select
                  value={currentRole}
                  onChange={(event) => onChange({ ...settings, role: event.target.value || null })}
                  className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="">—</option>
                  {roleOptions.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={Boolean(settings.isPrimary)}
                onChange={(event) => onChange({ ...settings, isPrimary: event.target.checked })}
                className="mt-0.5 size-4 shrink-0 rounded-sm border border-border accent-foreground"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-foreground">
                  Set as PRIMARY contact
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Will appear at the top of company contacts
                </span>
              </span>
            </label>
          </div>
        )
      }
    : undefined

  return {
    kind: 'person',
    dialogTitle: options.dialogTitle,
    dialogSubtitle: options.dialogSubtitle,
    sectionLabel: options.sectionLabel ?? 'MATCHING CONTACTS',
    searchPlaceholder: options.searchPlaceholder,
    searchEmptyHint: options.searchEmptyHint,
    selectedEmptyHint: options.selectedEmptyHint,
    confirmButtonLabel: options.confirmButtonLabel,
    defaultAvatarIcon: options.defaultAvatarIcon,
    headerIcon: options.headerIcon ?? <Link2 className="size-5" />,
    filters,
    renderRow,
    renderPreview,
    renderLinkSettings,
    initialLinkSettings: options.showLinkSettings ? { role: null, isPrimary: false } : undefined,
    fetchDetails: fetchPersonDetails,
    searchPage,
    fetchByIds,
    addNew: options.addNew,
  }
}
