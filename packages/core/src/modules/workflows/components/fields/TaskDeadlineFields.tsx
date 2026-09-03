'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { DurationInput } from '@open-mercato/ui/backend/inputs/DurationInput'
import { Plus, Trash2 } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import type { RouteOrderEntry } from '../../lib/route-priority'
import {
  TASK_ON_BREACH_ACTIONS,
  onBreachToDraft,
  type TaskOnBreachDraft,
} from '../../lib/task-inspector-config'

/**
 * "When" (spec §6.1, section 4): reminders and the breach action.
 *
 * The deadline itself stays on the existing duration field — it is one control
 * and CrudForm already renders it; only the two parts that are lists or have
 * dependent inputs need their own components.
 *
 * The vocabulary here is deliberately the BUSINESS one: a task has a deadline
 * and reminders before it, never a "timeout". A timeout is what a machine step
 * gives up after; a deadline is what a person is asked to meet.
 */

export function TaskRemindersField({ id, value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const offsets: string[] = Array.isArray(value)
    ? (value as unknown[]).map((entry) => (typeof entry === 'string' ? entry : ''))
    : []

  const updateOffset = (index: number, nextValue: string) => {
    setValue(offsets.map((offset, position) => (position === index ? nextValue : offset)))
  }

  return (
    <div className="space-y-2">
      {offsets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('workflows.tasks.inspector.when.remindersEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {offsets.map((offset, index) => (
            <div key={`${id}-reminder-${index}`} className="flex items-center gap-2">
              <div className="flex-1">
                <DurationInput
                  id={`${id}-reminder-${index}`}
                  value={offset}
                  onChange={(nextValue) => updateOffset(index, nextValue)}
                  disabled={disabled}
                  aria-label={t('workflows.tasks.inspector.when.reminderOffset')}
                />
              </div>
              <IconButton
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t('workflows.tasks.inspector.when.removeReminder')}
                onClick={() => setValue(offsets.filter((_, position) => position !== index))}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setValue([...offsets, ''])}
      >
        <Plus className="size-3.5 mr-1" />
        {t('workflows.tasks.inspector.when.addReminder')}
      </Button>
    </div>
  )
}

export interface TaskOnBreachFieldProps extends CrudCustomFieldRenderProps {
  /** Outgoing routes of this step, so "route the breach" names a real one. */
  routeOrder?: RouteOrderEntry[]
}

export function TaskOnBreachField({ id, value, setValue, disabled, routeOrder }: TaskOnBreachFieldProps) {
  const t = useT()
  const draft: TaskOnBreachDraft =
    value && typeof value === 'object' ? (value as TaskOnBreachDraft) : onBreachToDraft(null)
  const routes = routeOrder ?? []

  const update = (patch: Partial<TaskOnBreachDraft>) => setValue({ ...draft, ...patch })

  return (
    <div className="space-y-2">
      <Select
        value={draft.action || 'none'}
        onValueChange={(next) => update({ action: next === 'none' ? '' : (next as TaskOnBreachDraft['action']) })}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label={t('workflows.tasks.inspector.when.onBreach')}>
          <SelectValue placeholder={t('workflows.tasks.inspector.when.onBreachNone')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('workflows.tasks.inspector.when.onBreachNone')}</SelectItem>
          {TASK_ON_BREACH_ACTIONS.map((action) => (
            <SelectItem key={action} value={action}>
              {t(`workflows.tasks.inspector.when.onBreachActions.${action}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {draft.action === 'reassign' && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-reassign`} className="text-xs font-medium">
            {t('workflows.tasks.inspector.when.reassignTo')}
          </Label>
          <Input
            id={`${id}-reassign`}
            type="text"
            value={draft.reassignTo}
            onChange={(event) => update({ reassignTo: event.target.value })}
            placeholder={t('workflows.tasks.inspector.when.reassignToPlaceholder')}
            disabled={disabled}
          />
        </div>
      )}

      {draft.action === 'route' && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-route`} className="text-xs font-medium">
            {t('workflows.tasks.inspector.when.breachRoute')}
          </Label>
          {routes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('workflows.tasks.inspector.when.breachRouteEmpty')}
            </p>
          ) : (
            <Select
              value={draft.transitionId || 'none'}
              onValueChange={(next) => update({ transitionId: next === 'none' ? '' : next })}
              disabled={disabled}
            >
              <SelectTrigger id={`${id}-route`} aria-label={t('workflows.tasks.inspector.when.breachRoute')}>
                <SelectValue placeholder={t('workflows.tasks.inspector.when.breachRoutePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('workflows.tasks.inspector.when.breachRoutePlaceholder')}</SelectItem>
                {routes.map((route) => (
                  <SelectItem key={route.transitionId} value={route.transitionId}>
                    {route.label || route.toStepId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  )
}
