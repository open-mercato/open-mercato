'use client'

import * as React from 'react'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * Phase F — Matrix / Likert renderer shared by `PreviewSurface` and
 * `FormRunner` (mirrors the Phase E `RankingField` factoring).
 *
 * Decision 5 — per-row `multiple: true` produces a checkbox row (string[]
 * value). Single-select rows render a radio group so respondents can only
 * pick one column per row. The sticky header keeps column captions visible
 * when the grid scrolls horizontally on narrow viewports.
 */

export type MatrixFieldRow = {
  key: string
  label: { [locale: string]: string }
  multiple?: boolean
  required?: boolean
}

export type MatrixFieldColumn = {
  value: string
  label: { [locale: string]: string }
}

export type MatrixFieldProps = {
  /** Stable DOM id prefix (`preview-<key>` or `runner-<key>`). */
  idPrefix: string
  rows: ReadonlyArray<MatrixFieldRow>
  columns: ReadonlyArray<MatrixFieldColumn>
  value: unknown
  onChange: (next: Record<string, string | string[]>) => void
  locale: string
  /** When false, the inputs are disabled (preview read-only). */
  readOnly?: boolean
  t: TranslateFn
}

function resolveLocalizedLabel(map: { [locale: string]: string } | undefined, locale: string, fallback: string): string {
  if (!map) return fallback
  const exact = map[locale]
  if (typeof exact === 'string' && exact.length > 0) return exact
  const en = map.en
  if (typeof en === 'string' && en.length > 0) return en
  for (const value of Object.values(map)) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return fallback
}

function readRowValue(value: unknown, rowKey: string): string | string[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = (value as Record<string, unknown>)[rowKey]
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry)) return entry.filter((inner): inner is string => typeof inner === 'string')
  return undefined
}

function buildNextValue(
  current: unknown,
  rowKey: string,
  next: string | string[] | undefined,
): Record<string, string | string[]> {
  const base: Record<string, string | string[]> = {}
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      if (typeof entry === 'string') base[key] = entry
      else if (Array.isArray(entry)) {
        base[key] = entry.filter((inner): inner is string => typeof inner === 'string')
      }
    }
  }
  if (next === undefined) {
    delete base[rowKey]
  } else {
    base[rowKey] = next
  }
  return base
}

export function MatrixField({
  idPrefix,
  rows,
  columns,
  value,
  onChange,
  locale,
  readOnly = false,
  t,
}: MatrixFieldProps) {
  if (rows.length === 0 || columns.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('forms.studio.field.matrix.empty')}
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 z-10 bg-muted/60 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
            />
            {columns.map((column) => {
              const label = resolveLocalizedLabel(column.label, locale, column.value)
              return (
                <th
                  key={column.value}
                  scope="col"
                  className="sticky top-0 z-10 bg-muted/60 px-3 py-2 text-center text-xs font-medium text-foreground"
                >
                  {label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowLabel = resolveLocalizedLabel(row.label, locale, row.key)
            const rowValue = readRowValue(value, row.key)
            return (
              <tr key={row.key} className="border-t border-border">
                <th
                  scope="row"
                  className="px-3 py-2 text-left text-xs font-medium text-foreground align-middle"
                >
                  {rowLabel}
                  {row.required ? (
                    <span className="ml-1 text-status-error-text" aria-hidden="true">*</span>
                  ) : null}
                </th>
                {columns.map((column) => {
                  const colLabel = resolveLocalizedLabel(column.label, locale, column.value)
                  const cellLabel = `${rowLabel} — ${colLabel}`
                  if (row.multiple === true) {
                    const checked =
                      Array.isArray(rowValue) && rowValue.includes(column.value)
                    return (
                      <td key={column.value} className="px-3 py-2 text-center align-middle">
                        <Checkbox
                          id={`${idPrefix}-${row.key}-${column.value}`}
                          aria-label={cellLabel}
                          disabled={readOnly}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const current = Array.isArray(rowValue) ? [...rowValue] : []
                            if (nextChecked) {
                              if (!current.includes(column.value)) current.push(column.value)
                            } else {
                              const index = current.indexOf(column.value)
                              if (index >= 0) current.splice(index, 1)
                            }
                            const nextRow: string[] | undefined =
                              current.length === 0 ? undefined : current
                            onChange(buildNextValue(value, row.key, nextRow))
                          }}
                        />
                      </td>
                    )
                  }
                  const selected = typeof rowValue === 'string' && rowValue === column.value
                  return (
                    <td key={column.value} className="px-3 py-2 text-center align-middle">
                      <input
                        type="radio"
                        id={`${idPrefix}-${row.key}-${column.value}`}
                        name={`${idPrefix}-${row.key}`}
                        aria-label={cellLabel}
                        disabled={readOnly}
                        checked={selected}
                        onChange={(event) => {
                          if (!event.target.checked) return
                          onChange(buildNextValue(value, row.key, column.value))
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
