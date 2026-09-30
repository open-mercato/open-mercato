'use client'

import * as React from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { OmMatrixRowInput } from '../schema-helpers'

/**
 * Phase F — `x-om-matrix-rows` editor.
 *
 * Operates on the full row array and calls back to the parent with the entire
 * next array (the parent invokes `setMatrixRows(...)`). Per-row controls:
 * `Multi-select` + `Required` switches, localized label for the active locale,
 * move-up / move-down (a11y simpler than DnD here), and delete.
 */

export type MatrixRowsEditorProps = {
  locale: string
  rows: ReadonlyArray<OmMatrixRowInput>
  onChange: (next: OmMatrixRowInput[]) => void
}

function resolveLabel(row: OmMatrixRowInput, locale: string): string {
  if (!row.label) return ''
  const exact = row.label[locale]
  return typeof exact === 'string' ? exact : ''
}

function setLabel(row: OmMatrixRowInput, locale: string, value: string): OmMatrixRowInput {
  const nextLabel = { ...(row.label ?? {}) }
  if (value.length === 0) delete nextLabel[locale]
  else nextLabel[locale] = value
  return { ...row, label: nextLabel }
}

function nextRowKey(rows: ReadonlyArray<OmMatrixRowInput>): string {
  let maxSuffix = 0
  const pattern = /^row_(\d+)$/
  for (const row of rows) {
    const match = pattern.exec(row.key)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value) && value > maxSuffix) maxSuffix = value
  }
  return `row_${maxSuffix + 1}`
}

export function MatrixRowsEditor({ locale, rows, onChange }: MatrixRowsEditorProps) {
  const t = useT()
  const handleAdd = React.useCallback(() => {
    const newRow: OmMatrixRowInput = {
      key: nextRowKey(rows),
      label: { [locale]: '' },
    }
    onChange([...rows, newRow])
  }, [rows, locale, onChange])
  const handleRemove = React.useCallback(
    (index: number) => {
      const next = rows.slice()
      next.splice(index, 1)
      onChange(next)
    },
    [rows, onChange],
  )
  const handleMove = React.useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= rows.length) return
      const next = rows.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      onChange(next)
    },
    [rows, onChange],
  )
  const handlePatch = React.useCallback(
    (index: number, patch: Partial<OmMatrixRowInput>) => {
      const next = rows.slice()
      next[index] = { ...next[index], ...patch }
      onChange(next)
    },
    [rows, onChange],
  )
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t('forms.studio.field.matrix.rows.heading')}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          {t('forms.studio.field.matrix.rows.add')}
        </Button>
      </div>
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className="space-y-2 rounded-md border border-border bg-background p-2"
          >
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs text-muted-foreground">
                  {t('forms.studio.field.matrix.rows.key')}
                </label>
                <Input
                  value={row.key}
                  onChange={(event) =>
                    handlePatch(index, { key: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-muted-foreground">
                  {t('forms.studio.field.matrix.rows.label')}
                </label>
                <Input
                  value={resolveLabel(row, locale)}
                  onChange={(event) =>
                    handlePatch(index, setLabel(row, locale, event.target.value))
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={row.multiple === true}
                  onCheckedChange={(next) =>
                    handlePatch(index, { multiple: Boolean(next) || undefined })
                  }
                />
                <span>{t('forms.studio.field.matrix.rows.multiple')}</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={row.required === true}
                  onCheckedChange={(next) =>
                    handlePatch(index, { required: Boolean(next) || undefined })
                  }
                />
                <span>{t('forms.studio.field.matrix.rows.required')}</span>
              </label>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('forms.studio.field.matrix.rows.moveUp')}
                  onClick={() => handleMove(index, index - 1)}
                  disabled={index === 0}
                >
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('forms.studio.field.matrix.rows.moveDown')}
                  onClick={() => handleMove(index, index + 1)}
                  disabled={index >= rows.length - 1}
                >
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="destructive-outline"
                  size="sm"
                  aria-label={t('forms.studio.field.matrix.rows.delete')}
                  onClick={() => handleRemove(index)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
