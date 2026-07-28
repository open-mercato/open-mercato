'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Plus, Trash2 } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import type { LedgerEntry } from '../../lib/context-ledger'
import { newEntityBindingDraft, type TaskEntityBindingDraft } from '../../lib/task-inspector-config'
import { TemplateTextControl } from './TemplateTextControl'

/**
 * "About what" (spec §6.1, section 2): the records a task is about.
 *
 * A binding is an entity type plus the context path that yields the record id
 * at task-creation time. The id path is picked from the LEDGER — the same
 * vocabulary every other template-capable field in the editor speaks — and is
 * inserted BARE (`context.order.id`), because `resolveTaskEntityBindings`
 * wraps a bare path itself and a path is what the binding stores.
 *
 * Multiple bindings are allowed: a task can be about an order AND the customer
 * who placed it.
 */

export interface TaskEntityBindingsFieldProps extends CrudCustomFieldRenderProps {
  ledgerEntries?: LedgerEntry[]
}

export function TaskEntityBindingsField({
  id,
  value,
  setValue,
  disabled,
  ledgerEntries,
}: TaskEntityBindingsFieldProps) {
  const t = useT()
  const drafts: TaskEntityBindingDraft[] = Array.isArray(value) ? (value as TaskEntityBindingDraft[]) : []

  const updateDraft = (index: number, patch: Partial<TaskEntityBindingDraft>) => {
    setValue(drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)))
  }

  const removeDraft = (index: number) => {
    setValue(drafts.filter((_, position) => position !== index))
  }

  return (
    <div className="space-y-2">
      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('workflows.tasks.inspector.bindings.empty')}
        </p>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft, index) => (
            <div key={draft.key} className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`${id}-${draft.key}-type`} className="text-xs font-medium">
                    {t('workflows.tasks.inspector.bindings.entityType')}
                  </Label>
                  <Input
                    id={`${id}-${draft.key}-type`}
                    type="text"
                    value={draft.entityType}
                    onChange={(event) => updateDraft(index, { entityType: event.target.value })}
                    placeholder={t('workflows.tasks.inspector.bindings.entityTypePlaceholder')}
                    disabled={disabled}
                    className="font-mono"
                  />
                </div>
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="mt-6"
                  disabled={disabled}
                  onClick={() => removeDraft(index)}
                  aria-label={t('workflows.tasks.inspector.bindings.remove')}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-${draft.key}-path`} className="text-xs font-medium">
                  {t('workflows.tasks.inspector.bindings.idPath')}
                </Label>
                <TemplateTextControl
                  id={`${id}-${draft.key}-path`}
                  value={draft.idPath}
                  onValueChange={(nextValue) => updateDraft(index, { idPath: nextValue })}
                  ledgerEntries={ledgerEntries}
                  insertMode="bare"
                  placeholder={t('workflows.tasks.inspector.bindings.idPathPlaceholder')}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-${draft.key}-label`} className="text-xs font-medium">
                  {t('workflows.tasks.inspector.bindings.label')}
                </Label>
                <Input
                  id={`${id}-${draft.key}-label`}
                  type="text"
                  value={draft.label}
                  onChange={(event) => updateDraft(index, { label: event.target.value })}
                  placeholder={t('workflows.tasks.inspector.bindings.labelPlaceholder')}
                  disabled={disabled}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setValue([...drafts, newEntityBindingDraft()])}
      >
        <Plus className="size-3.5 mr-1" />
        {t('workflows.tasks.inspector.bindings.add')}
      </Button>
    </div>
  )
}
