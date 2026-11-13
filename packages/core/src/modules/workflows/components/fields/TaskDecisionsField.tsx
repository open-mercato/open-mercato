'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
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
import { Plus, Trash2, Wand2 } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import type { RouteOrderEntry } from '../../lib/route-priority'
import {
  TASK_DECISION_STYLES,
  newDecisionDraft,
  type TaskDecisionDraft,
} from '../../lib/task-inspector-config'
import { buildApprovalPreset } from '../../lib/task-presets'
import type { FormField } from './FormFieldArrayEditor'

/**
 * "Decisions" (spec §6.1, section 5): the buttons the assignee actually
 * presses, each mapped 1:1 to an outgoing route.
 *
 * A decision stores the route's DURABLE transition id, never its position in
 * the list and never a value regenerated on save — route order changes with
 * every edit, and the id is what `pendingTransition` and the branch key already
 * resolve against. The picker therefore lists the step's real outgoing routes
 * (with their target and whether they carry a condition) so the author is
 * choosing a route rather than typing an id.
 *
 * A decision whose route was deleted keeps its binding and raises a Problems
 * WARNING (`lib/flow-logic-warnings.ts`) instead of being silently dropped:
 * losing an author's button because an edge was rewired would be worse than
 * telling them about it.
 */

export interface TaskDecisionsFieldProps extends CrudCustomFieldRenderProps {
  routeOrder?: RouteOrderEntry[]
}

function readFormFields(values: Record<string, unknown> | undefined): FormField[] {
  const fields = values?.formFields
  return Array.isArray(fields) ? (fields as FormField[]) : []
}

export function TaskDecisionsField({
  id,
  value,
  setValue,
  setFormValue,
  values,
  disabled,
  routeOrder,
}: TaskDecisionsFieldProps) {
  const t = useT()
  const drafts: TaskDecisionDraft[] = Array.isArray(value) ? (value as TaskDecisionDraft[]) : []
  const routes = routeOrder ?? []
  const knownRouteIds = new Set(routes.map((route) => route.transitionId))

  const updateDraft = (index: number, patch: Partial<TaskDecisionDraft>) => {
    setValue(drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)))
  }

  const routeLabel = (route: RouteOrderEntry) => {
    const name = route.label || route.toStepId
    return route.hasCondition
      ? `${name} · ${t('workflows.tasks.inspector.decisions.routeConditional')}`
      : name
  }

  const applyApprovalPreset = () => {
    const preset = buildApprovalPreset({
      approveLabel: t('workflows.tasks.inspector.decisions.presetApprove'),
      rejectLabel: t('workflows.tasks.inspector.decisions.presetReject'),
      commentLabel: t('workflows.tasks.inspector.decisions.presetComment'),
      approveTransitionId: routes[0]?.transitionId,
      rejectTransitionId: routes[1]?.transitionId,
      decisions: drafts,
      formFields: readFormFields(values),
      entityBindings: Array.isArray(values?.taskEntityBindings)
        ? (values.taskEntityBindings as never[])
        : [],
    })
    setValue(preset.decisions)
    setFormValue?.('formFields', preset.formFields)
    setFormValue?.('taskEntityBindings', preset.entityBindings)
  }

  return (
    <div className="space-y-2">
      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('workflows.tasks.inspector.decisions.empty')}
        </p>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft, index) => {
            const routeMissing = draft.transitionId.length > 0 && !knownRouteIds.has(draft.transitionId)
            return (
              <div key={draft.key} className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`${id}-${draft.key}-label`} className="text-xs font-medium">
                      {t('workflows.tasks.inspector.decisions.buttonLabel')}
                    </Label>
                    <Input
                      id={`${id}-${draft.key}-label`}
                      type="text"
                      value={draft.label}
                      onChange={(event) => updateDraft(index, { label: event.target.value })}
                      placeholder={t('workflows.tasks.inspector.decisions.buttonLabelPlaceholder')}
                      disabled={disabled}
                    />
                  </div>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    className="mt-6"
                    disabled={disabled}
                    aria-label={t('workflows.tasks.inspector.decisions.remove')}
                    onClick={() => setValue(drafts.filter((_, position) => position !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`${id}-${draft.key}-route`} className="text-xs font-medium">
                    {t('workflows.tasks.inspector.decisions.route')}
                  </Label>
                  {routes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('workflows.tasks.inspector.decisions.routesEmpty')}
                    </p>
                  ) : (
                    <Select
                      value={draft.transitionId || 'none'}
                      onValueChange={(next) =>
                        updateDraft(index, { transitionId: next === 'none' ? '' : next })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger
                        id={`${id}-${draft.key}-route`}
                        aria-label={t('workflows.tasks.inspector.decisions.route')}
                      >
                        <SelectValue placeholder={t('workflows.tasks.inspector.decisions.routePlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          {t('workflows.tasks.inspector.decisions.routePlaceholder')}
                        </SelectItem>
                        {routes.map((route) => (
                          <SelectItem key={route.transitionId} value={route.transitionId}>
                            {routeLabel(route)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {routeMissing && (
                    <Alert variant="warning">
                      <AlertDescription className="text-xs">
                        {t('workflows.tasks.inspector.decisions.routeMissing')}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Label htmlFor={`${id}-${draft.key}-style`} className="text-xs font-medium">
                    {t('workflows.tasks.inspector.decisions.style')}
                  </Label>
                  <Select
                    value={draft.style || 'none'}
                    onValueChange={(next) =>
                      updateDraft(index, {
                        style: next === 'none' ? '' : (next as TaskDecisionDraft['style']),
                      })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger
                      id={`${id}-${draft.key}-style`}
                      className="w-48"
                      aria-label={t('workflows.tasks.inspector.decisions.style')}
                    >
                      <SelectValue placeholder={t('workflows.tasks.inspector.decisions.styleDefault')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {t('workflows.tasks.inspector.decisions.styleDefault')}
                      </SelectItem>
                      {TASK_DECISION_STYLES.map((style) => (
                        <SelectItem key={style} value={style}>
                          {t(`workflows.tasks.inspector.decisions.styles.${style}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant="muted" className="ml-auto font-mono text-xs">
                    {draft.id}
                  </Badge>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setValue([...drafts, newDecisionDraft(routes[drafts.length]?.transitionId ?? '')])}
        >
          <Plus className="size-3.5 mr-1" />
          {t('workflows.tasks.inspector.decisions.add')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={applyApprovalPreset}
        >
          <Wand2 className="size-3.5 mr-1" />
          {t('workflows.tasks.inspector.decisions.applyApprovalPreset')}
        </Button>
      </div>
    </div>
  )
}

/**
 * The subset of the task's form fields the assignee may edit before deciding
 * (spec §6.1: "selected fields markable editable-prefilled"). It is a list of
 * FIELD NAMES, so renaming a field in the builder leaves an entry pointing at
 * nothing — which is why the list is rendered FROM the declared fields rather
 * than as free text: a name that no longer exists simply stops being offered.
 */
export function TaskEditablePrefilledField({
  id,
  value,
  setValue,
  values,
  disabled,
}: CrudCustomFieldRenderProps) {
  const t = useT()
  const selected: string[] = Array.isArray(value)
    ? (value as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : []
  const formFields = readFormFields(values)

  if (formFields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('workflows.tasks.inspector.decisions.editablePrefilledEmpty')}
      </p>
    )
  }

  const toggle = (name: string, checked: boolean) => {
    if (checked) setValue(selected.includes(name) ? selected : [...selected, name])
    else setValue(selected.filter((entry) => entry !== name))
  }

  return (
    <div className="space-y-1">
      {formFields.map((field) => (
        <CheckboxField
          key={field.name}
          id={`${id}-${field.name}`}
          label={field.label || field.name}
          checked={selected.includes(field.name)}
          onCheckedChange={(checked) => toggle(field.name, checked === true)}
          disabled={disabled}
          size="sm"
        />
      ))}
    </div>
  )
}
