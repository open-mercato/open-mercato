'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { SectionPage } from '@open-mercato/ui/backend/section-page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { buildDesignSystemSections, MOCKUPS_BASE_PATH } from '../../gallery/components/sectionNav'
import type { MockupCounts } from '../schema'
import {
  LEDGER_STATUS_ORDER,
  STATUS_DOT_CLASS,
  STATUS_LABELS,
  type MockupLedgerStatus,
} from './statusPresentation'

type MockupListItem = {
  slug: string
  title: string
  source: 'ai' | 'module'
  counts: MockupCounts
  userStories: string[]
  modifiedAt: string
}

function countFor(counts: MockupCounts, status: MockupLedgerStatus): number {
  if (status === 'implemented') return counts.implemented
  if (status === 'proposed') return counts.proposed
  if (status === 'placeholder') return counts.placeholder
  return counts.omDefault
}

export function MockupList() {
  const t = useT()
  const router = useRouter()
  const [items, setItems] = React.useState<MockupListItem[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    apiFetch('/api/design_system/mockups')
      .then(async (response) => {
        if (!response.ok) {
          if (!cancelled) setError(t('design_system.mockups.listFailed', 'Could not load mockups'))
          return
        }
        const body = (await response.json()) as { items: MockupListItem[] }
        if (!cancelled) setItems(body.items)
      })
      .catch(() => {
        if (!cancelled) setError(t('design_system.mockups.listFailed', 'Could not load mockups'))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<MockupListItem>[]>(
    () => [
      {
        id: 'title',
        header: t('design_system.mockups.columns.title', 'Mockup'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{row.original.title}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{row.original.slug}</div>
          </div>
        ),
      },
      {
        id: 'source',
        header: t('design_system.mockups.columns.source', 'Source'),
        cell: ({ row }) => (
          <span className="rounded-sm border border-border bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground">
            {row.original.source === 'ai'
              ? t('design_system.mockups.source.ai', 'Spec mockups')
              : t('design_system.mockups.source.module', 'Module')}
          </span>
        ),
      },
      {
        id: 'counts',
        header: t('design_system.mockups.columns.counts', 'Blocks by status'),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            {LEDGER_STATUS_ORDER.map((status) => (
              <span
                key={status}
                title={t(STATUS_LABELS[status].key, STATUS_LABELS[status].fallback)}
                className="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <span aria-hidden className={cn('size-2 rounded-full', STATUS_DOT_CLASS[status])} />
                <span className="tabular-nums">{countFor(row.original.counts, status)}</span>
              </span>
            ))}
          </span>
        ),
      },
      {
        id: 'userStories',
        header: t('design_system.mockups.columns.userStories', 'User stories'),
        cell: ({ row }) =>
          row.original.userStories.length === 0 ? null : (
            <span className="flex flex-wrap gap-1">
              {row.original.userStories.map((story) => (
                <span
                  key={story}
                  className="rounded-sm border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {story}
                </span>
              ))}
            </span>
          ),
      },
      {
        id: 'modifiedAt',
        header: t('design_system.mockups.columns.modifiedAt', 'Modified'),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.modifiedAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [t],
  )

  const sections = React.useMemo(() => buildDesignSystemSections(), [])

  return (
    <SectionPage
      title="Design system"
      titleKey="design_system.nav.title"
      sections={sections}
      activePath={MOCKUPS_BASE_PATH}
    >
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <h2 className="text-lg font-semibold">
          {t('design_system.mockups.title', 'Screen mockups')}
        </h2>
        <DataTable<MockupListItem>
          columns={columns}
          data={items ?? []}
          isLoading={items === null && !error}
          error={error}
          onRowClick={(row) => router.push(`${MOCKUPS_BASE_PATH}/${row.slug}`)}
          emptyState={
            <EmptyState
              title={t('design_system.mockups.empty.title', 'No mockups yet')}
              description={t(
                'design_system.mockups.empty.description',
                'Add a *.mockup.json document under .ai/mockups or a module mockups folder to see it here.',
              )}
            />
          }
        />
      </div>
    </SectionPage>
  )
}
