'use client'

import { useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { PortField, PortFieldType } from '../../data/validators'

/** The five business-friendly port types surfaced in the Schema Builder. */
const PORT_TYPES: PortFieldType[] = ['text', 'number', 'boolean', 'select', 'date']

export interface PortFieldArrayEditorProps {
  id: string
  value: PortField[]
  onChange: (next: PortField[]) => void
  disabled?: boolean
  /** i18n key for the "add port" button label. */
  addLabelKey: string
  /** i18n key for the empty-state message. */
  emptyLabelKey: string
}

/**
 * PortFieldArrayEditor — add / edit / remove a list of sub-workflow port fields.
 *
 * Mirrors the proven UserTask `FormFieldArrayEditor` UX (expandable cards with
 * name / label / type / required) but is scoped to the five port types and the
 * `PortField` shape, and uses DS-compliant primitives and semantic tokens.
 * Presentational: state is owned by the parent (SchemaBuilderDialog).
 */
export function PortFieldArrayEditor({
  id,
  value,
  onChange,
  disabled,
  addLabelKey,
  emptyLabelKey,
}: PortFieldArrayEditorProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

  const ports = Array.isArray(value) ? value : []

  const toggleExpanded = (index: number) => {
    const next = new Set(expandedIndices)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setExpandedIndices(next)
  }

  const addPort = () => {
    const newPort: PortField = {
      name: `field_${ports.length + 1}`,
      type: 'text',
      label: '',
      required: false,
    }
    onChange([...ports, newPort])
    const next = new Set(expandedIndices)
    next.add(ports.length)
    setExpandedIndices(next)
  }

  const removePort = async (index: number) => {
    const confirmed = await confirm({
      title: t('workflows.ports.remove'),
      text: t('workflows.ports.confirmRemove'),
      variant: 'destructive',
    })
    if (!confirmed) return
    onChange(ports.filter((_, i) => i !== index))
    const next = new Set(expandedIndices)
    next.delete(index)
    setExpandedIndices(next)
  }

  const updatePort = (index: number, key: keyof PortField, fieldValue: unknown) => {
    const updated = ports.map((port, i) => (i === index ? { ...port, [key]: fieldValue } : port))
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={addPort} disabled={disabled}>
          <Plus className="size-3 mr-1" />
          {t(addLabelKey)}
        </Button>
      </div>

      {ports.length === 0 ? (
        <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border border-border">
          {t(emptyLabelKey)}
        </div>
      ) : (
        <div className="space-y-2">
          {ports.map((port, index) => {
            const isExpanded = expandedIndices.has(index)
            return (
              <div key={index} className="border border-border rounded-lg bg-muted/40">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => toggleExpanded(index)}
                  disabled={disabled}
                  className="w-full h-auto px-4 py-3 justify-between hover:bg-muted/70"
                >
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">
                        {port.label || port.name}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {t(`workflows.ports.types.${port.type}`)}
                      </Badge>
                      {port.required && (
                        <Badge variant="outline" className="text-xs">
                          {t('workflows.ports.required')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{port.name}</p>
                  </div>
                  <ChevronDown
                    className={`size-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </Button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border bg-background">
                    <div className="pt-3">
                      <Label htmlFor={`${id}-${index}-name`} className="text-xs font-medium mb-1">
                        {t('workflows.ports.name')} *
                      </Label>
                      <Input
                        id={`${id}-${index}-name`}
                        type="text"
                        value={port.name}
                        onChange={(e) => updatePort(index, 'name', e.target.value)}
                        className="text-xs font-mono"
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.ports.nameHint')}</p>
                    </div>

                    <div>
                      <Label htmlFor={`${id}-${index}-label`} className="text-xs font-medium mb-1">
                        {t('workflows.ports.label')} *
                      </Label>
                      <Input
                        id={`${id}-${index}-label`}
                        type="text"
                        value={port.label}
                        onChange={(e) => updatePort(index, 'label', e.target.value)}
                        className="text-xs"
                        disabled={disabled}
                      />
                    </div>

                    <div>
                      <Label htmlFor={`${id}-${index}-type`} className="text-xs font-medium mb-1">
                        {t('workflows.ports.type')} *
                      </Label>
                      <Select
                        value={port.type}
                        onValueChange={(next) => updatePort(index, 'type', next)}
                        disabled={disabled}
                      >
                        <SelectTrigger id={`${id}-${index}-type`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PORT_TYPES.map((portType) => (
                            <SelectItem key={portType} value={portType}>
                              {t(`workflows.ports.types.${portType}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {port.type === 'select' && (
                      <div>
                        <Label htmlFor={`${id}-${index}-options`} className="text-xs font-medium mb-1">
                          {t('workflows.ports.options')}
                        </Label>
                        <Input
                          id={`${id}-${index}-options`}
                          type="text"
                          value={port.options?.join(', ') || ''}
                          onChange={(e) =>
                            updatePort(
                              index,
                              'options',
                              e.target.value
                                .split(',')
                                .map((option) => option.trim())
                                .filter(Boolean),
                            )
                          }
                          className="text-xs"
                          disabled={disabled}
                        />
                        <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.ports.optionsHint')}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-${index}-required`}
                        checked={port.required}
                        onCheckedChange={(checked) => updatePort(index, 'required', checked === true)}
                        disabled={disabled}
                      />
                      <Label htmlFor={`${id}-${index}-required`} className="text-xs font-medium cursor-pointer">
                        {t('workflows.ports.required')}
                      </Label>
                    </div>

                    <div className="border-t border-border pt-3">
                      <IconButton
                        type="button"
                        variant="ghost"
                        onClick={() => removePort(index)}
                        disabled={disabled}
                        aria-label={t('workflows.ports.remove')}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
