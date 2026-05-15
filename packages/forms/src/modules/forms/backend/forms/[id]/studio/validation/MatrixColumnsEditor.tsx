'use client'

import * as React from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { OmMatrixColumnInput } from '../schema-helpers'

/**
 * Phase F — `x-om-matrix-columns` editor.
 *
 * Operates on the full column array and calls back with the next array. Per
 * column controls: `value` (the persisted column key) + localized label for
 * the active locale, move-up / move-down, delete.
 */

export type MatrixColumnsEditorProps = {
  locale: string
  columns: ReadonlyArray<OmMatrixColumnInput>
  onChange: (next: OmMatrixColumnInput[]) => void
}

function resolveLabel(column: OmMatrixColumnInput, locale: string): string {
  if (!column.label) return ''
  const exact = column.label[locale]
  return typeof exact === 'string' ? exact : ''
}

function setLabel(column: OmMatrixColumnInput, locale: string, value: string): OmMatrixColumnInput {
  const nextLabel = { ...(column.label ?? {}) }
  if (value.length === 0) delete nextLabel[locale]
  else nextLabel[locale] = value
  return { ...column, label: nextLabel }
}

function nextColumnValue(columns: ReadonlyArray<OmMatrixColumnInput>): string {
  const pattern = /^col_(\d+)$/
  let maxSuffix = 0
  for (const column of columns) {
    const match = pattern.exec(column.value)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value) && value > maxSuffix) maxSuffix = value
  }
  return `col_${maxSuffix + 1}`
}

export function MatrixColumnsEditor({ locale, columns, onChange }: MatrixColumnsEditorProps) {
  const t = useT()
  const handleAdd = React.useCallback(() => {
    const newColumn: OmMatrixColumnInput = {
      value: nextColumnValue(columns),
      label: { [locale]: '' },
    }
    onChange([...columns, newColumn])
  }, [columns, locale, onChange])
  const handleRemove = React.useCallback(
    (index: number) => {
      const next = columns.slice()
      next.splice(index, 1)
      onChange(next)
    },
    [columns, onChange],
  )
  const handleMove = React.useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= columns.length) return
      const next = columns.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      onChange(next)
    },
    [columns, onChange],
  )
  const handlePatch = React.useCallback(
    (index: number, patch: Partial<OmMatrixColumnInput>) => {
      const next = columns.slice()
      next[index] = { ...next[index], ...patch }
      onChange(next)
    },
    [columns, onChange],
  )
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t('forms.studio.field.matrix.columns.heading')}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          {t('forms.studio.field.matrix.columns.add')}
        </Button>
      </div>
      <ul className="space-y-2">
        {columns.map((column, index) => (
          <li
            key={column.value}
            className="space-y-2 rounded-md border border-border bg-background p-2"
          >
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs text-muted-foreground">
                  {t('forms.studio.field.matrix.columns.value')}
                </label>
                <Input
                  value={column.value}
                  onChange={(event) =>
                    handlePatch(index, { value: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-muted-foreground">
                  {t('forms.studio.field.matrix.columns.label')}
                </label>
                <Input
                  value={resolveLabel(column, locale)}
                  onChange={(event) =>
                    handlePatch(index, setLabel(column, locale, event.target.value))
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('forms.studio.field.matrix.columns.moveUp')}
                onClick={() => handleMove(index, index - 1)}
                disabled={index === 0}
              >
                <ChevronUp className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('forms.studio.field.matrix.columns.moveDown')}
                onClick={() => handleMove(index, index + 1)}
                disabled={index >= columns.length - 1}
              >
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="destructive-outline"
                size="sm"
                aria-label={t('forms.studio.field.matrix.columns.delete')}
                onClick={() => handleRemove(index)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
