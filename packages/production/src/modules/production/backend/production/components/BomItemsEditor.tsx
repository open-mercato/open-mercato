'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Trash2, Plus } from 'lucide-react'

export type BomItemRow = {
  id?: string
  componentProductId: string
  componentVariantId?: string | null
  qtyPerUnit: number | string
  uom: string
  scrapFactor: number | string
  isPhantom: boolean
  operationSequence?: number | string | null
}

type Translate = (key: string, fallback?: string) => string

type BomItemsEditorProps = {
  value: BomItemRow[]
  onChange: (next: BomItemRow[]) => void
  t: Translate
}

function emptyRow(): BomItemRow {
  return {
    componentProductId: '',
    componentVariantId: '',
    qtyPerUnit: '',
    uom: '',
    scrapFactor: 0,
    isPhantom: false,
    operationSequence: '',
  }
}

/**
 * Simple in-memory rows editor for the BOM `items` aggregate array (task 1.3).
 * componentProductId/componentVariantId are plain UUID text inputs for now — a
 * catalog picker is a planned enhancement (see production.boms.note.catalog_picker).
 */
export function BomItemsEditor({ value, onChange, t }: BomItemsEditorProps) {
  const rows = Array.isArray(value) ? value : []

  const updateRow = (index: number, patch: Partial<BomItemRow>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    onChange(next)
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index))
  }

  const addRow = () => {
    onChange([...rows, emptyRow()])
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t('production.boms.note.catalog_picker', 'Component/product IDs are entered as UUIDs for now; a catalog picker is a planned enhancement.')}
      </p>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('production.boms.items.empty', 'No items yet. Add the first component.')}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-12 items-center gap-2 rounded-md border border-border p-2">
              <div className="col-span-3">
                <Input
                  aria-label={t('production.boms.items.field.component_product_id', 'Component product ID')}
                  placeholder={t('production.boms.items.field.component_product_id', 'Component product ID')}
                  value={row.componentProductId}
                  onChange={(e) => updateRow(index, { componentProductId: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Input
                  aria-label={t('production.boms.items.field.component_variant_id', 'Component variant ID')}
                  placeholder={t('production.boms.items.field.component_variant_id', 'Component variant ID')}
                  value={row.componentVariantId ?? ''}
                  onChange={(e) => updateRow(index, { componentVariantId: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  aria-label={t('production.boms.items.field.qty_per_unit', 'Qty per unit')}
                  placeholder={t('production.boms.items.field.qty_per_unit', 'Qty per unit')}
                  value={row.qtyPerUnit}
                  onChange={(e) => updateRow(index, { qtyPerUnit: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Input
                  aria-label={t('production.boms.items.field.uom', 'UoM')}
                  placeholder={t('production.boms.items.field.uom', 'UoM')}
                  value={row.uom}
                  onChange={(e) => updateRow(index, { uom: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  aria-label={t('production.boms.items.field.scrap_factor', 'Scrap %')}
                  placeholder={t('production.boms.items.field.scrap_factor', 'Scrap %')}
                  value={row.scrapFactor}
                  onChange={(e) => updateRow(index, { scrapFactor: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  aria-label={t('production.boms.items.field.operation_sequence', 'Operation sequence')}
                  placeholder={t('production.boms.items.field.operation_sequence', 'Operation sequence')}
                  value={row.operationSequence ?? ''}
                  onChange={(e) => updateRow(index, { operationSequence: e.target.value })}
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <Checkbox
                  checked={row.isPhantom}
                  onCheckedChange={(checked) => updateRow(index, { isPhantom: checked === true })}
                />
                <span className="text-xs text-muted-foreground">
                  {t('production.boms.items.field.is_phantom', 'Phantom')}
                </span>
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeRow(index)}
                  aria-label={t('production.boms.items.remove', 'Remove')}
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
          {t('production.boms.items.add', 'Add item')}
        </Button>
      </div>
    </div>
  )
}
