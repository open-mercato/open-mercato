'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Trash2, Plus } from 'lucide-react'

export type RoutingOperationRow = {
  id?: string
  sequence: number | string
  name: string
  workCenterId: string
  setupTimeMinutes: number | string
  runTimePerUnitSeconds: number | string
  isReportingPoint: boolean
}

type Translate = (key: string, fallback?: string) => string

export type WorkCenterOption = { value: string; label: string }

type RoutingOperationsEditorProps = {
  value: RoutingOperationRow[]
  onChange: (next: RoutingOperationRow[]) => void
  t: Translate
  workCenterOptions: WorkCenterOption[]
}

function nextSequence(rows: RoutingOperationRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.sequence) || 0), 0) + 10
}

function emptyRow(rows: RoutingOperationRow[]): RoutingOperationRow {
  return {
    sequence: nextSequence(rows),
    name: '',
    workCenterId: '',
    setupTimeMinutes: 0,
    runTimePerUnitSeconds: 0,
    isReportingPoint: false,
  }
}

/**
 * Simple in-memory rows editor for the routing `operations` aggregate array
 * (task 1.3). Work center options are loaded from /api/production/work-centers.
 */
export function RoutingOperationsEditor({ value, onChange, t, workCenterOptions }: RoutingOperationsEditorProps) {
  const rows = Array.isArray(value) ? value : []

  const updateRow = (index: number, patch: Partial<RoutingOperationRow>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    onChange(next)
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index))
  }

  const addRow = () => {
    onChange([...rows, emptyRow(rows)])
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('production.routings.operations.empty', 'No operations yet. Add the first step.')}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-12 items-center gap-2 rounded-md border border-border p-2">
              <div className="col-span-1">
                <Input
                  type="number"
                  aria-label={t('production.routings.operations.field.sequence', 'Seq.')}
                  placeholder={t('production.routings.operations.field.sequence', 'Seq.')}
                  value={row.sequence}
                  onChange={(e) => updateRow(index, { sequence: e.target.value })}
                />
              </div>
              <div className="col-span-3">
                <Input
                  aria-label={t('production.routings.operations.field.name', 'Operation name')}
                  placeholder={t('production.routings.operations.field.name', 'Operation name')}
                  value={row.name}
                  onChange={(e) => updateRow(index, { name: e.target.value })}
                />
              </div>
              <div className="col-span-3">
                <Select
                  value={row.workCenterId || undefined}
                  onValueChange={(val) => updateRow(index, { workCenterId: val })}
                >
                  <SelectTrigger aria-label={t('production.routings.operations.field.work_center_id', 'Work center')}>
                    <SelectValue placeholder={t('production.routings.operations.field.work_center_id', 'Work center')} />
                  </SelectTrigger>
                  <SelectContent>
                    {workCenterOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  aria-label={t('production.routings.operations.field.setup_time_minutes', 'Setup time (min)')}
                  placeholder={t('production.routings.operations.field.setup_time_minutes', 'Setup time (min)')}
                  value={row.setupTimeMinutes}
                  onChange={(e) => updateRow(index, { setupTimeMinutes: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="number"
                  aria-label={t('production.routings.operations.field.run_time_per_unit_seconds', 'Run time per unit (s)')}
                  placeholder={t('production.routings.operations.field.run_time_per_unit_seconds', 'Run time per unit (s)')}
                  value={row.runTimePerUnitSeconds}
                  onChange={(e) => updateRow(index, { runTimePerUnitSeconds: e.target.value })}
                />
              </div>
              <div className="col-span-1 flex items-center gap-2">
                <Checkbox
                  checked={row.isReportingPoint}
                  onCheckedChange={(checked) => updateRow(index, { isReportingPoint: checked === true })}
                />
                <span className="text-xs text-muted-foreground">
                  {t('production.routings.operations.field.is_reporting_point', 'Reporting point')}
                </span>
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeRow(index)}
                  aria-label={t('production.routings.operations.remove', 'Remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-2 h-4 w-4" />
          {t('production.routings.operations.add', 'Add operation')}
        </Button>
      </div>
    </div>
  )
}
