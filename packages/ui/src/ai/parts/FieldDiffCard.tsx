"use client"

import * as React from 'react'
import { Info } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '../../primitives/alert'
import type {
  AiPendingActionCardFieldDiff,
  AiPendingActionCardRecordDiff,
} from './types'

/**
 * Presentational card rendering a `fieldDiff` list in compact three-column
 * form (field | before | after) with DS-compliant semantic-token colors.
 * Accepts either a flat `fieldDiff[]` (single-record preview) or grouped
 * `records[]` (batch preview) — when both are supplied, `records` wins,
 * matching the server-side `AiPendingAction` contract (spec §8 rule 2).
 */
export interface FieldDiffCardProps {
  fieldDiff?: AiPendingActionCardFieldDiff[] | null
  records?: AiPendingActionCardRecordDiff[] | null
  /** Optional forwarded componentId for the registry renderer. */
  componentId?: string
}

function formatValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function DiffRow({ entry }: { entry: AiPendingActionCardFieldDiff }) {
  const before = formatValue(entry.before)
  const after = formatValue(entry.after)
  return (
    <tr className="border-b border-border last:border-b-0" data-ai-field-diff-row>
      <td className="py-1.5 pr-4 text-xs font-mono text-muted-foreground align-top">
        {entry.field}
      </td>
      <td
        className="py-1.5 pr-4 text-sm align-top text-status-warning-text"
        data-ai-field-diff-before
      >
        <span className="line-through break-all">{before || '—'}</span>
      </td>
      <td
        className="py-1.5 text-sm align-top text-status-success-text"
        data-ai-field-diff-after
      >
        <span className="font-medium break-all">{after || '—'}</span>
      </td>
    </tr>
  )
}

function DiffTable({ rows, fieldHeader, beforeHeader, afterHeader }: {
  rows: AiPendingActionCardFieldDiff[]
  fieldHeader: string
  beforeHeader: string
  afterHeader: string
}) {
  return (
    <table className="w-full" data-ai-field-diff-table>
      <thead>
        <tr className="border-b border-border">
          <th className="py-1 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {fieldHeader}
          </th>
          <th className="py-1 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {beforeHeader}
          </th>
          <th className="py-1 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {afterHeader}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry, idx) => (
          <DiffRow key={`${entry.field}-${idx}`} entry={entry} />
        ))}
      </tbody>
    </table>
  )
}

export function FieldDiffCard({ fieldDiff, records }: FieldDiffCardProps) {
  const t = useT()
  const fieldHeader = t(
    'ai_assistant.chat.mutation_cards.diff.fieldHeader',
    'Field',
  )
  const beforeHeader = t(
    'ai_assistant.chat.mutation_cards.diff.beforeHeader',
    'Before',
  )
  const afterHeader = t(
    'ai_assistant.chat.mutation_cards.diff.afterHeader',
    'After',
  )

  const batch = Array.isArray(records) && records.length > 0 ? records : null
  const flat = Array.isArray(fieldDiff) ? fieldDiff : []

  if (batch) {
    return (
      <div className="flex flex-col gap-3" data-ai-field-diff-mode="batch">
        {batch.map((record) => (
          <section
            key={record.recordId}
            className="rounded-md border border-border bg-background p-3"
            data-ai-field-diff-record={record.recordId}
          >
            <header className="mb-2 flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold">{record.label}</h4>
              <span className="text-xs font-mono text-muted-foreground">
                {record.entityType}
              </span>
            </header>
            {record.fieldDiff.length > 0 ? (
              <DiffTable
                rows={record.fieldDiff}
                fieldHeader={fieldHeader}
                beforeHeader={beforeHeader}
                afterHeader={afterHeader}
              />
            ) : (
              <Alert variant="info">
                <Info className="size-4" aria-hidden />
                <AlertDescription>
                  {t(
                    'ai_assistant.chat.mutation_cards.diff.empty',
                    'No field changes for this record.',
                  )}
                </AlertDescription>
              </Alert>
            )}
          </section>
        ))}
      </div>
    )
  }

  if (flat.length === 0) {
    return (
      <Alert variant="info" data-ai-field-diff-mode="empty">
        <Info className="size-4" aria-hidden />
        <AlertDescription>
          {t(
            'ai_assistant.chat.mutation_cards.diff.empty',
            'No field changes for this record.',
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div data-ai-field-diff-mode="flat">
      <DiffTable
        rows={flat}
        fieldHeader={fieldHeader}
        beforeHeader={beforeHeader}
        afterHeader={afterHeader}
      />
    </div>
  )
}

export default FieldDiffCard
