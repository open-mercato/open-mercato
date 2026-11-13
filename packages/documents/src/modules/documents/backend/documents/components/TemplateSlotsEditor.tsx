"use client"

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DOCUMENT_ENTITY_REGISTRY,
  getEntityRegistryEntry,
  type DocumentEntityType,
} from '../../../lib/entityRegistry'
import type { TemplateContextSlot } from './templateUi'
import { useAvailableDocumentEntityRegistry } from './useAvailableEntityRegistry'

export const TEMPLATE_SLOT_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/

function deriveSlotKey(entityType: DocumentEntityType, slots: TemplateContextSlot[], excludeIndex?: number): string {
  const [first = 'slot', ...rest] = entityType.split('-')
  const base = [first, ...rest.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))].join('')
  const existing = new Set(slots.filter((_, index) => index !== excludeIndex).map((slot) => slot.slot))
  if (!existing.has(base)) return base
  let ordinal = 2
  while (existing.has(`${base}${ordinal}`)) ordinal += 1
  return `${base}${ordinal}`
}

export function TemplateSlotsEditor({ slots, onChange }: { slots: TemplateContextSlot[]; onChange: (slots: TemplateContextSlot[]) => void }) {
  const t = useT()
  const { entries: availableEntries } = useAvailableDocumentEntityRegistry(DOCUMENT_ENTITY_REGISTRY)
  const addSlot = () => {
    const entityType = availableEntries[0]?.type
    if (!entityType) return
    onChange([...slots, { slot: deriveSlotKey(entityType, slots), entityType, required: true }])
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>{t('documents.templates.slots.title')}</Label>
        <Button type="button" size="sm" variant="outline" onClick={addSlot} disabled={availableEntries.length === 0}><Plus />{t('documents.templates.slots.add')}</Button>
      </div>
      {slots.length === 0 ? <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">{t('documents.templates.slots.empty')}</p> : null}
      {slots.map((slot, index) => {
        const inputId = `document-template-slot-${index}`
        const entityTypeInputId = `document-template-slot-entity-type-${index}`
        const error = !slot.slot ? t('documents.templates.validation.slotRequired') : !TEMPLATE_SLOT_KEY_PATTERN.test(slot.slot) ? t('documents.templates.validation.slotKey') : null
        const currentEntry = getEntityRegistryEntry(slot.entityType)
        return (
          <div key={`${slot.entityType}:${index}`} className="space-y-3 rounded-md border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor={inputId}>{t('documents.templates.slots.key')}</Label>
                <Input id={inputId} value={slot.slot} onChange={(event) => onChange(slots.map((item, itemIndex) => itemIndex === index ? { ...item, slot: event.target.value } : item))} aria-invalid={error !== null} />
                {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}
              </div>
              <IconButton type="button" variant="ghost" aria-label={t('documents.templates.slots.remove')} title={t('documents.templates.slots.remove')} onClick={() => onChange(slots.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></IconButton>
            </div>
            <Label htmlFor={entityTypeInputId}>{t('documents.templates.slots.entityType')}</Label>
            <Select value={slot.entityType} disabled={availableEntries.length === 0} onValueChange={(value) => onChange(slots.map((item, itemIndex) => itemIndex === index ? { ...item, entityType: value as DocumentEntityType, slot: deriveSlotKey(value as DocumentEntityType, slots, index) } : item))}>
              <SelectTrigger id={entityTypeInputId}><SelectValue>{currentEntry ? t(currentEntry.labelKey) : t('documents.relatedRecords.restricted')}</SelectValue></SelectTrigger>
              <SelectContent>{availableEntries.map((entry) => <SelectItem key={entry.type} value={entry.type}>{t(entry.labelKey)}</SelectItem>)}</SelectContent>
            </Select>
            <CheckboxField label={t('documents.templates.slots.required')} checked={slot.required === true} onCheckedChange={(checked) => onChange(slots.map((item, itemIndex) => itemIndex === index ? { ...item, required: checked === true } : item))} />
          </div>
        )
      })}
    </div>
  )
}
