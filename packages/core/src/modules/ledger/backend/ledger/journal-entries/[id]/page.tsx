'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

// Read-only detail of one posted journal entry: header fields and the posted
// lines (account number, name, debit, credit). Nothing here edits or deletes —
// a posted entry is only ever corrected by a reversal (see
// api/journal-entries/route.ts and commands/reverseJournalEntry.ts).
type JournalEntryType = 'NORMAL' | 'OPENING' | 'CLOSING' | 'REVERSAL'

type JournalEntryLineRow = {
  id: string
  accountId: string
  accountNumber: string | null
  accountName: string | null
  debit: string
  credit: string
}

type JournalEntryDetail = {
  id: string
  sequenceNumber: number
  postedAt: string
  operationDate: string
  documentType: string | null
  documentNumber: string | null
  documentDate: string | null
  postedBy: string | null
  description: string
  type: JournalEntryType
  referenceType: string | null
  referenceId: string | null
  lines?: JournalEntryLineRow[]
}

type EntryRef = { id: string; sequenceNumber: number }

const TYPE_BADGE_VARIANT: Record<JournalEntryType, 'default' | 'secondary' | 'destructive'> = {
  NORMAL: 'default',
  OPENING: 'secondary',
  CLOSING: 'secondary',
  REVERSAL: 'destructive',
}

function typeLabel(type: JournalEntryType, t: TranslateFn): string {
  switch (type) {
    case 'NORMAL':
      return t('ledger.journal_entries.type.normal', 'Normal')
    case 'OPENING':
      return t('ledger.journal_entries.type.opening', 'Opening')
    case 'CLOSING':
      return t('ledger.journal_entries.type.closing', 'Closing')
    case 'REVERSAL':
      return t('ledger.journal_entries.type.reversal', 'Reversal')
    default:
      return type
  }
}

// Amounts are `numeric(19,4)` strings. Totals are summed as integers of the
// smallest unit (1/10 000) so the footer never shows a float artefact.
const SCALE = 10_000
const toUnits = (value: string): number => Math.round(Number(value) * SCALE)
const formatUnits = (units: number): string =>
  (units / SCALE).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const formatAmount = (value: string): string => (toUnits(value) === 0 ? '' : formatUnits(toUnits(value)))

export default function JournalEntryDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const id = params?.id

  const [entry, setEntry] = React.useState<JournalEntryDetail | null>(null)
  const [original, setOriginal] = React.useState<EntryRef | null>(null)
  const [reversal, setReversal] = React.useState<EntryRef | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await apiCall<{ items: JournalEntryDetail[] }>(
          `/api/ledger/journal-entries?id=${encodeURIComponent(String(id))}`,
        )
        if (cancelled) return
        if (response.ok && response.result && response.result.items.length > 0) {
          const loaded = response.result.items[0]
          setEntry(loaded)

          // Best-effort links between an entry and its reversal; the page is
          // complete without them.
          if (loaded.type === 'REVERSAL' && loaded.referenceType === 'journal_entry' && loaded.referenceId) {
            const originalCall = await apiCall<{ items: EntryRef[] }>(
              `/api/ledger/journal-entries?id=${encodeURIComponent(loaded.referenceId)}`,
              undefined,
              { fallback: { items: [] } },
            )
            const item = originalCall.result?.items?.[0]
            if (!cancelled && item) setOriginal({ id: item.id, sequenceNumber: item.sequenceNumber })
          } else if (loaded.type !== 'REVERSAL') {
            const reversalCall = await apiCall<{ items: EntryRef[] }>(
              `/api/ledger/journal-entries?type=REVERSAL&referenceId=${encodeURIComponent(loaded.id)}&pageSize=1`,
              undefined,
              { fallback: { items: [] } },
            )
            const item = reversalCall.result?.items?.[0]
            if (!cancelled && item) setReversal({ id: item.id, sequenceNumber: item.sequenceNumber })
          }
        } else if (!response.ok) {
          setError(t('ledger.journal_entries.detail.errors.load', 'Failed to load this journal entry'))
        } else {
          setIsNotFound(true)
        }
      } catch {
        if (!cancelled) setError(t('ledger.journal_entries.detail.errors.load', 'Failed to load this journal entry'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <DataLoader isLoading loadingMessage={t('ledger.journal_entries.detail.loading', 'Loading journal entry…')}>
            <></>
          </DataLoader>
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('ledger.journal_entries.detail.errors.notFound', 'Journal entry not found.')}
            backHref="/backend/ledger/journal-entries"
            backLabel={t('ledger.journal_entries.detail.backToList', 'Back to journal entries')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !entry) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error ?? t('ledger.journal_entries.detail.errors.notFound', 'Journal entry not found.')}
          />
        </PageBody>
      </Page>
    )
  }

  const lines = entry.lines ?? []
  const totalDebit = lines.reduce((sum, line) => sum + toUnits(line.debit), 0)
  const totalCredit = lines.reduce((sum, line) => sum + toUnits(line.credit), 0)
  const documentParts = [entry.documentType, entry.documentNumber].filter(Boolean).join(' ')

  const fields: Array<{ key: string; label: string; value: React.ReactNode }> = [
    {
      key: 'operationDate',
      label: t('ledger.journal_entries.detail.field.operationDate', 'Operation date'),
      value: entry.operationDate,
    },
    {
      key: 'type',
      label: t('ledger.journal_entries.detail.field.type', 'Type'),
      value: <Badge variant={TYPE_BADGE_VARIANT[entry.type]}>{typeLabel(entry.type, t)}</Badge>,
    },
    {
      key: 'document',
      label: t('ledger.journal_entries.detail.field.document', 'Document'),
      value: documentParts
        ? `${documentParts}${entry.documentDate ? ` (${entry.documentDate})` : ''}`
        : '—',
    },
    {
      key: 'postedAt',
      label: t('ledger.journal_entries.detail.field.postedAt', 'Posted at'),
      value: new Date(entry.postedAt).toLocaleString(),
    },
    {
      key: 'postedBy',
      label: t('ledger.journal_entries.detail.field.postedBy', 'Posted by'),
      value: entry.postedBy ? <span className="font-mono text-xs">{entry.postedBy}</span> : '—',
    },
  ]
  if (original) {
    fields.push({
      key: 'reverses',
      label: t('ledger.journal_entries.detail.field.reverses', 'Reverses entry'),
      value: (
        <Link className="underline" href={`/backend/ledger/journal-entries/${original.id}`}>
          #{original.sequenceNumber}
        </Link>
      ),
    })
  }
  if (reversal) {
    fields.push({
      key: 'reversedBy',
      label: t('ledger.journal_entries.detail.field.reversedBy', 'Reversed by entry'),
      value: (
        <Link className="underline" href={`/backend/ledger/journal-entries/${reversal.id}`}>
          #{reversal.sequenceNumber}
        </Link>
      ),
    })
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="space-y-1">
            <Link className="text-sm text-muted-foreground underline" href="/backend/ledger/journal-entries">
              {t('ledger.journal_entries.detail.backToList', 'Back to journal entries')}
            </Link>
            <h1 className="text-2xl font-semibold">
              {t('ledger.journal_entries.detail.title', 'Journal entry #{{number}}', { number: entry.sequenceNumber })}
            </h1>
            <p className="text-muted-foreground">{entry.description}</p>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <dt className="text-sm text-muted-foreground">{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t('ledger.journal_entries.detail.lines.title', 'Lines')}</h2>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      {t('ledger.journal_entries.detail.lines.columns.accountNumber', 'Account number')}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t('ledger.journal_entries.detail.lines.columns.accountName', 'Account name')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('ledger.journal_entries.detail.lines.columns.debit', 'Debit')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('ledger.journal_entries.detail.lines.columns.credit', 'Credit')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="px-3 py-2 font-mono">{line.accountNumber ?? line.accountId}</td>
                      <td className="px-3 py-2">{line.accountName || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatAmount(line.debit)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatAmount(line.credit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50 font-medium">
                    <td className="px-3 py-2" colSpan={2}>
                      {t('ledger.journal_entries.detail.lines.total', 'Total')}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatUnits(totalDebit)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatUnits(totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      </PageBody>
    </Page>
  )
}
