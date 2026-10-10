"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type EntryLineValue = {
  accountId: string
  debitAmount: string
  creditAmount: string
  description?: string
  taxCode?: string
}

export function emptyEntryLine(): EntryLineValue {
  return { accountId: '', debitAmount: '0', creditAmount: '0' }
}

/** Advisory balance for the editor; the server re-checks in minor units and refuses. */
export function sumEntryLines(lines: readonly EntryLineValue[]): { debit: number; credit: number; balanced: boolean } {
  const toNumber = (value: string): number => {
    const normalized = String(value ?? '').trim()
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return 0
    return Number(normalized)
  }
  const debit = lines.reduce((total, line) => total + toNumber(line.debitAmount), 0)
  const credit = lines.reduce((total, line) => total + toNumber(line.creditAmount), 0)
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.00005 }
}

type AccountOption = {
  id: string
  code: string
  name: string
}

/**
 * The journal-entry line editor.
 *
 * Rendered as a `CrudForm` custom field so the whole entry — header and lines — saves through one
 * submit, which is what the API expects: a create payload carries the lines, and a draft update
 * replaces them.
 */
export default function EntryLinesEditor({ value, setValue, error }: CrudCustomFieldRenderProps) {
  const t = useT()
  const lines = React.useMemo<EntryLineValue[]>(
    () => (Array.isArray(value) ? (value as EntryLineValue[]) : []),
    [value],
  )

  const accountsQuery = useQuery({
    queryKey: ['financial-account-options'],
    queryFn: () => fetchCrudList<AccountOption>('financial/accounts', {
      pageSize: 100,
      isActive: 'true',
      sortField: 'code',
      sortDir: 'asc',
    }),
  })
  const options = accountsQuery.data?.items ?? []

  const totals = React.useMemo(() => sumEntryLines(lines), [lines])

  const updateLine = (index: number, patch: Partial<EntryLineValue>) => {
    setValue(lines.map((line, position) => (position === index ? { ...line, ...patch } : line)))
  }

  const addLine = () => setValue([...lines, emptyEntryLine()])

  const removeLine = (index: number) => setValue(lines.filter((_, position) => position !== index))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('financial.entries.form.lines.title', 'Lines')}</span>
        <Badge variant={totals.balanced ? 'secondary' : 'destructive'}>
          {totals.balanced
            ? t('financial.entries.form.lines.balanced', 'Balanced')
            : t('financial.entries.form.lines.unbalanced', 'Out of balance')}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div
            key={`line-${index}`}
            className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
          >
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('financial.entries.form.lines.account', 'Account')}
              </span>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={line.accountId}
                onChange={(event) => updateLine(index, { accountId: event.target.value })}
              >
                <option value="">{t('financial.entries.form.lines.selectAccount', 'Select an account')}</option>
                {options.map((account) => (
                  <option key={account.id} value={account.id}>
                    {`${account.code} · ${account.name}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('financial.entries.form.lines.debit', 'Debit')}
              </span>
              <Input
                inputMode="decimal"
                value={line.debitAmount}
                onChange={(event) => updateLine(index, { debitAmount: event.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('financial.entries.form.lines.credit', 'Credit')}
              </span>
              <Input
                inputMode="decimal"
                value={line.creditAmount}
                onChange={(event) => updateLine(index, { creditAmount: event.target.value })}
              />
            </label>

            <div className="flex items-end">
              <Button type="button" variant="outline" size="sm" onClick={() => removeLine(index)}>
                {t('financial.entries.form.lines.remove', 'Remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          {t('financial.entries.form.lines.add', 'Add line')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {`${t('financial.entries.form.lines.totalsLabel', 'Totals')}: ${totals.debit.toFixed(4)} / ${totals.credit.toFixed(4)}`}
        </span>
      </div>

      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  )
}

