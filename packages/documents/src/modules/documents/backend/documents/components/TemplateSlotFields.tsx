"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getEntityRegistryEntry } from '../../../lib/entityRegistry'
import { EntityPicker, type EntityPickerSelection } from './EntityPicker'
import type { TemplateContextSlot, TemplateSlotSelection } from './templateUi'

type TemplateSlotFieldsProps = {
  slots: TemplateContextSlot[]
  selections: Record<string, TemplateSlotSelection | undefined>
  onSelectionChange: (slot: string, selection: TemplateSlotSelection | undefined) => void
}

export function TemplateSlotFields({ slots, selections, onSelectionChange }: TemplateSlotFieldsProps) {
  const t = useT()
  const [activeSlot, setActiveSlot] = React.useState<TemplateContextSlot | null>(null)
  const handlePick = React.useCallback((selection: EntityPickerSelection) => {
    if (!activeSlot) return
    onSelectionChange(activeSlot.slot, {
      entityType: selection.type,
      entityId: selection.id,
      label: selection.label,
      href: selection.href,
      values: selection.values,
    })
    setActiveSlot(null)
  }, [activeSlot, onSelectionChange])

  if (slots.length === 0) {
    return <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">{t('documents.templates.instantiate.noSlots')}</p>
  }
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{t('documents.templates.instantiate.contextTitle')}</p>
      {slots.map((slot) => {
        const selection = selections[slot.slot]
        const entry = getEntityRegistryEntry(slot.entityType)
        return (
          <div key={slot.slot} className="space-y-2">
            <Label>
              {entry ? t(entry.labelKey) : t('documents.relatedRecords.restricted')}
              {slot.required ? ` ${t('documents.templates.instantiate.requiredSuffix')}` : ''}
            </Label>
            {selection ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{selection.label}</p><Tag variant="neutral">{entry ? t(entry.labelKey) : t('documents.relatedRecords.restricted')}</Tag></div>
                <Button type="button" size="sm" variant="ghost" onClick={() => onSelectionChange(slot.slot, undefined)}>
                  <X />{t('documents.templates.instantiate.clearSelection')}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setActiveSlot(slot)}>
                <Search />{t('documents.templates.instantiate.searchPlaceholder')}
              </Button>
            )}
          </div>
        )
      })}
      <EntityPicker
        open={activeSlot !== null}
        onOpenChange={(open) => { if (!open) setActiveSlot(null) }}
        onPick={handlePick}
        typeFilter={activeSlot ? [activeSlot.entityType] : []}
      />
    </div>
  )
}
