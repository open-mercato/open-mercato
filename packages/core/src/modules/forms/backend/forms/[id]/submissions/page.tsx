"use client"

import * as React from 'react'
import { File as FileIcon, Lock, Users } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import {
  fromSubmission,
  ROW_BADGE_TONE,
  type SubmissionInboxRow,
} from './components/RowBadges'
import { SubmissionDrawer } from './components/SubmissionDrawer'

type InboxResponse = {
  items: Array<SubmissionInboxRow & {
    subjectType: string
    subjectId: string
    submittedAt: string | null
    updatedAt: string
    locale: string | null
  }>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type FormSummaryResponse = {
  form: {
    id: string
    name: string
    currentPublishedVersionId: string | null
  }
  versions?: Array<{ id: string; status: string; roles: string[]; versionNumber: number }>
}

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

export default function FormSubmissionInboxPage({ params }: { params?: { id?: string } }) {
  const formId = params?.id ?? ''
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<InboxResponse['items']>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [openSubmissionId, setOpenSubmissionId] = React.useState<string | null>(null)
  const [formSummary, setFormSummary] = React.useState<FormSummaryResponse | null>(null)

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('forms.inbox.filter.status', { fallback: 'Status' }),
        type: 'select',
        options: [
          { value: 'draft', label: t('forms.submission.status.draft', { fallback: 'Draft' }) },
          { value: 'submitted', label: t('forms.submission.status.submitted', { fallback: 'Submitted' }) },
          { value: 'reopened', label: t('forms.submission.status.reopened', { fallback: 'Reopened' }) },
          { value: 'archived', label: t('forms.submission.status.archived', { fallback: 'Archived' }) },
          { value: 'anonymized', label: t('forms.submission.status.anonymized', { fallback: 'Anonymized' }) },
        ],
        multi: true,
      },
    ],
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '20')
      if (search.trim()) params.set('q', search.trim())
      const statusValue = filterValues.status
      if (Array.isArray(statusValue) && statusValue.length > 0) {
        params.set('status', statusValue.join(','))
      } else if (typeof statusValue === 'string' && statusValue) {
        params.set('status', statusValue)
      }
      try {
        const [listResp, summaryResp] = await Promise.all([
          apiCall<InboxResponse>(`/api/forms/${encodeURIComponent(formId)}/submissions?${params.toString()}`),
          apiCall<FormSummaryResponse>(`/api/forms/${encodeURIComponent(formId)}`),
        ])
        if (cancelled) return
        if (!listResp.ok || !listResp.result) {
          flash('forms.errors.internal', 'error')
          return
        }
        setRows(listResp.result.items)
        setTotal(listResp.result.total)
        setTotalPages(listResp.result.totalPages || 1)
        if (summaryResp.ok && summaryResp.result) {
          setFormSummary(summaryResp.result)
        }
      } catch (error) {
        if (!cancelled) {
          flash(error instanceof Error ? error.message : 'forms.errors.internal', 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [formId, page, search, filterValues, reloadToken, scopeVersion])

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  const formVersionRoles = React.useMemo(() => {
    if (!formSummary?.versions) return []
    const published = formSummary.versions.find((v) => v.id === formSummary.form.currentPublishedVersionId)
    return published?.roles ?? []
  }, [formSummary])

  const columns = React.useMemo<ColumnDef<InboxResponse['items'][number]>[]>(
    () => [
      {
        header: t('forms.inbox.columns.subject', { fallback: 'Subject' }),
        accessorKey: 'subjectId',
        cell: ({ row }) => {
          const isAnonymized = !!row.original.anonymizedAt
          return (
            <span className={`font-mono text-xs ${isAnonymized ? 'italic text-muted-foreground' : 'text-foreground'}`}>
              {row.original.subjectType}: {row.original.subjectId.slice(0, 8)}…
            </span>
          )
        },
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        header: t('forms.inbox.columns.status', { fallback: 'Status' }),
        accessorKey: 'status',
        cell: ({ row }) => {
          const badges = fromSubmission(row.original)
          return (
            <div className="flex flex-wrap items-center gap-1">
              {badges.map((badge, index) => {
                if (badge.kind === 'status') {
                  return (
                    <Tag key={`status-${index}`} variant={ROW_BADGE_TONE[badge.status]} dot>
                      {t(`forms.submission.status.${badge.status}`, { fallback: badge.status })}
                    </Tag>
                  )
                }
                if (badge.kind === 'version') {
                  return (
                    <Tag key={`version-${index}`} variant="neutral">
                      v{badge.versionNumber}
                    </Tag>
                  )
                }
                if (badge.kind === 'revision_count') {
                  return (
                    <Tag key={`rev-${index}`} variant="neutral">
                      {badge.count} rev
                    </Tag>
                  )
                }
                if (badge.kind === 'multi_role') {
                  return (
                    <Tag key={`multirole-${index}`} variant="info" aria-label="Multiple roles">
                      <Users className="h-3 w-3" aria-hidden="true" />
                    </Tag>
                  )
                }
                if (badge.kind === 'pdf_available') {
                  return (
                    <Tag key={`pdf-${index}`} variant="success" aria-label="PDF available">
                      <FileIcon className="h-3 w-3" aria-hidden="true" />
                    </Tag>
                  )
                }
                if (badge.kind === 'anonymized') {
                  return (
                    <Tag key={`anon-${index}`} variant="error" aria-label="Anonymized">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                    </Tag>
                  )
                }
                return null
              })}
            </div>
          )
        },
      },
      {
        header: t('forms.inbox.columns.submitted_at', { fallback: 'Submitted' }),
        accessorKey: 'submittedAt',
        cell: ({ row }) => formatDate(row.original.submittedAt) || '—',
      },
      {
        header: t('forms.inbox.columns.updated_at', { fallback: 'Updated' }),
        accessorKey: 'updatedAt',
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={
            formSummary?.form?.name
              ? `${formSummary.form.name} · ${t('forms.inbox.title', { fallback: 'Submissions' })}`
              : t('forms.inbox.title', { fallback: 'Submissions' })
          }
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('forms.inbox.search.placeholder', { fallback: 'Search by subject id' })}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={setFilterValues}
          onFiltersClear={() => setFilterValues({})}
          pagination={{
            page,
            pageSize: 20,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          onRowClick={(row) => setOpenSubmissionId(row.id)}
          emptyState={t('forms.inbox.empty', { fallback: 'No submissions yet.' })}
        />
        {openSubmissionId ? (
          <SubmissionDrawer
            formId={formId}
            submissionId={openSubmissionId}
            formVersionRoles={formVersionRoles}
            onClose={() => setOpenSubmissionId(null)}
            onMutated={reload}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}
