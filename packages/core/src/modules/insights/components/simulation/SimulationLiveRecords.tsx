"use client"

import * as React from 'react'
import Link from 'next/link'
import { Info } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { isSafeInternalHref } from '../../lib/client/explainApi'
import {
  describeSimulationError,
  simulationRecordCountLabel,
  simulationRecordTypeLabel,
  translateSimulationKey,
} from '../../lib/client/simulation/format'
import type { SimulationResourceState } from '../../lib/client/simulation/hooks'
import type { SimulationLiveRecord, SimulationRecordsResponse } from '../../lib/client/simulation/types'
import { formatCount, shortId } from '../../lib/client/xray/format'

function compareKeys(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function countKeys(items: readonly SimulationLiveRecord[]): string[] {
  const keys = new Set<string>()
  for (const item of items) {
    for (const key of Object.keys(item.counts)) keys.add(key)
  }
  return Array.from(keys).sort(compareKeys)
}

function RecordName({ record }: { record: SimulationLiveRecord }) {
  const label = record.label ?? shortId(record.id)
  if (isSafeInternalHref(record.href)) {
    return (
      <LinkButton asChild variant="primary" size="sm" underline="always">
        <Link href={record.href} title={record.id} data-testid="simulation-record-link">{label}</Link>
      </LinkButton>
    )
  }
  return <span title={record.id}>{label}</span>
}

type SimulationLiveRecordsProps = {
  kind: string
  records: SimulationResourceState<SimulationRecordsResponse>
  page: number
  onPageChange?: (page: number) => void
  compact?: boolean
}

/**
 * The records a completed run concerns, resolved live for the viewer on every read (e.g. the users
 * and API keys whose permissions a role change would change): name (linked when the owning module
 * gives a link), type and the kind's per-record counts; notes from the owning module; pages of up
 * to 50 (the compact form shows the first page only).
 */
export function SimulationLiveRecords({ kind, records, page, onPageChange, compact = false }: SimulationLiveRecordsProps) {
  const t = useT()
  const locale = useLocale()
  const data = records.data
  const items = data?.items ?? []
  const keys = countKeys(items)
  const Heading = compact ? 'h3' : 'h2'
  return (
    <section className="space-y-3" data-testid="simulation-live-records" data-compact={compact ? 'true' : 'false'}>
      <div className="space-y-1">
        <Heading className={compact ? 'text-sm font-medium' : 'text-base font-semibold'}>{t('insights.simulation.ui.records.title')}</Heading>
        <p className="text-xs text-muted-foreground">{t('insights.simulation.ui.records.description')}</p>
      </div>
      {records.loading && !data ? <LoadingMessage label={t('insights.simulation.ui.records.loading')} /> : null}
      {records.error && !data ? (
        <ErrorMessage
          label={describeSimulationError(records.error, t, 'insights.simulation.ui.records.loadFailed')}
          action={(
            <Button type="button" size="sm" variant="outline" onClick={records.reload}>
              {t('insights.simulation.ui.actions.retry')}
            </Button>
          )}
        />
      ) : null}
      {data && data.notes.length > 0 ? (
        <ul className="space-y-1" data-testid="simulation-live-records-notes">
          {data.notes.map((note) => (
            <li key={note} className="flex items-start gap-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{translateSimulationKey(note, t)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {data && items.length === 0 ? (
        <EmptyState size="sm" variant="subtle" title={t('insights.simulation.ui.records.emptyTitle')} description={t('insights.simulation.ui.records.emptyDescription')} />
      ) : null}
      {data && items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('insights.simulation.ui.records.columns.name')}</TableHead>
              <TableHead>{t('insights.simulation.ui.records.columns.type')}</TableHead>
              {keys.map((key) => <TableHead key={key}>{simulationRecordCountLabel(kind, key, t)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((record) => (
              <TableRow key={`${record.type}:${record.id}`} data-testid="simulation-live-record" data-record-type={record.type} data-record-id={record.id}>
                <TableCell><RecordName record={record} /></TableCell>
                <TableCell>{simulationRecordTypeLabel(kind, record.type, t)}</TableCell>
                {keys.map((key) => (
                  <TableCell key={key} className="tabular-nums">
                    {typeof record.counts[key] === 'number' ? formatCount(record.counts[key], locale) : t('insights.simulation.ui.common.none')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {data && compact && data.total > items.length ? (
        <p className="text-xs text-muted-foreground" data-testid="simulation-live-records-more">
          {t('insights.simulation.ui.records.more', { count: formatCount(data.total - items.length, locale) })}
        </p>
      ) : null}
      {data && !compact && onPageChange && data.totalPages > 1 ? (
        <Pagination
          page={page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={onPageChange}
          showFirstLast={false}
          disabled={records.loading}
        />
      ) : null}
    </section>
  )
}
