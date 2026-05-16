"use client"

import * as React from 'react'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

const ADD_STAGE_CONTEXT_ID = 'customers-deals-kanban:add-stage'

// Stage color palette — mirrors the kanban's lane accent tones. Empty string = no color
// (lane will fall back to the neutral border tone). Kept as a tuple so the Zod schema can
// validate against the same set without drifting.
const COLOR_OPTIONS = [
  { value: '', labelKey: 'customers.deals.kanban.addStage.color.none', labelFallback: 'No color' },
  { value: '#16a34a', labelKey: 'customers.deals.kanban.addStage.color.green', labelFallback: 'Green' },
  { value: '#f59e0b', labelKey: 'customers.deals.kanban.addStage.color.amber', labelFallback: 'Amber' },
  { value: '#dc2626', labelKey: 'customers.deals.kanban.addStage.color.red', labelFallback: 'Red' },
  { value: '#2563eb', labelKey: 'customers.deals.kanban.addStage.color.blue', labelFallback: 'Blue' },
  { value: '#6b7280', labelKey: 'customers.deals.kanban.addStage.color.gray', labelFallback: 'Gray' },
  { value: '#7c3aed', labelKey: 'customers.deals.kanban.addStage.color.violet', labelFallback: 'Violet' },
] as const

/**
 * Identifier values for the "Position" picker:
 *   - `end` — append after every existing stage (the default; matches the previous
 *     always-at-end behavior so the dialog stays familiar)
 *   - `start` — insert at order 0; existing stages shift right
 *   - `after:<stageId>` — insert directly after the given stage; everything to its right shifts
 *
 * We use a single-string discriminated value rather than a separate "mode" + "afterId"
 * pair because CrudForm's built-in `select` field type expects scalar option values, and
 * the backend payload computation is trivial off this single string.
 */
const POSITION_END = 'end' as const
const POSITION_START = 'start' as const
const POSITION_AFTER_PREFIX = 'after:'

export type AddStageContext = {
  pipelineId: string
  pipelineName: string
  /**
   * Snapshot of every stage already in the pipeline, ordered by their `order` field.
   * Drives the "Position" picker. `order` is the server-side position used to build
   * the create payload (we send `existingOrder + 1` for "after this stage").
   */
  existingStages: ReadonlyArray<{ id: string; label: string; order: number }>
}

type AddStageDialogProps = {
  open: boolean
  context: AddStageContext | null
  onClose: () => void
  onCreated: () => void
}

type AddStageFormValues = {
  label: string
  color: string
  position: string
}

/**
 * Resolve the picker's discriminated string to the integer `order` we send to the API.
 * Returns `undefined` when the operator picked "At end" — the backend treats undefined
 * as "append" so the legacy default behavior is preserved bit-for-bit.
 */
function resolveInsertOrder(
  position: string,
  existingStages: ReadonlyArray<{ id: string; label: string; order: number }>,
): number | undefined {
  if (position === POSITION_END || position === '') return undefined
  if (position === POSITION_START) return 0
  if (position.startsWith(POSITION_AFTER_PREFIX)) {
    const afterId = position.slice(POSITION_AFTER_PREFIX.length)
    const idx = existingStages.findIndex((s) => s.id === afterId)
    if (idx < 0) return undefined
    // Insert position is the existing stage's order + 1; the backend will shift the
    // remainder of the stages by +1 to keep ordering dense and unique.
    return existingStages[idx].order + 1
  }
  return undefined
}

export function AddStageDialog({
  open,
  context,
  onClose,
  onCreated,
}: AddStageDialogProps): React.ReactElement | null {
  const t = useT()
  // Re-mount CrudForm whenever the dialog opens so cleared state is consistently fresh and
  // any stale field errors from a previous open don't carry over.
  const [formInstanceKey, setFormInstanceKey] = React.useState(0)
  React.useEffect(() => {
    if (open) setFormInstanceKey((c) => c + 1)
  }, [open])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: ADD_STAGE_CONTEXT_ID,
    blockedMessage: translateWithFallback(t, 'ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const labelRequiredMessage = translateWithFallback(
    t,
    'customers.deals.kanban.addStage.label.required',
    'Stage name is required.',
  )

  // Cast widens to AddStageFormValues so CrudForm's TValues generic stays exact — Zod's
  // inferred type is structurally identical but the generic parameters carry extra
  // metadata that doesn't match `z.ZodType<TValues>` literally.
  const formSchema = React.useMemo(
    () =>
      z.object({
        label: z.string().trim().min(1, labelRequiredMessage),
        color: z.string().optional(),
        position: z.string().optional(),
      }) as unknown as z.ZodType<AddStageFormValues>,
    [labelRequiredMessage],
  )

  const positionOptions = React.useMemo(() => {
    const existingStages = context?.existingStages ?? []
    const opts: Array<{ value: string; label: string }> = [
      {
        value: POSITION_END,
        label: translateWithFallback(
          t,
          'customers.deals.kanban.addStage.position.end',
          'At the end (default)',
        ),
      },
      {
        value: POSITION_START,
        label: translateWithFallback(
          t,
          'customers.deals.kanban.addStage.position.start',
          'At the start',
        ),
      },
    ]
    for (const stage of existingStages) {
      opts.push({
        value: `${POSITION_AFTER_PREFIX}${stage.id}`,
        label: translateWithFallback(
          t,
          'customers.deals.kanban.addStage.position.after',
          'After {label}',
          { label: stage.label },
        ),
      })
    }
    return opts
  }, [context?.existingStages, t])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        // CrudForm auto-focuses the first field of the first group on mount, so we don't
        // need an explicit `autoFocus: true` here — and adding one would be a type error
        // because `autoFocus` is only valid on CrudCustomFieldRenderProps.
        id: 'label',
        label: translateWithFallback(t, 'customers.deals.kanban.addStage.label', 'Stage name'),
        type: 'text',
        required: true,
        placeholder: translateWithFallback(
          t,
          'customers.deals.kanban.addStage.label.placeholder',
          'e.g. Discovery',
        ),
      },
      {
        // Custom inline radio-style list instead of a Radix Select — when the dialog sits
        // near the bottom of the viewport, Radix's Select dropdown clips to the available
        // vertical space (`--radix-select-content-available-height`), which can leave only
        // 1–2 visible options and hide the rest behind a small scroll affordance the
        // operator doesn't notice. Rendering the picker inline inside the dialog body
        // gives it a deterministic max-height + clearly scrollable area, and "After {label}"
        // entries are always visible without portal clipping.
        id: 'position',
        label: translateWithFallback(
          t,
          'customers.deals.kanban.addStage.position',
          'Position in pipeline',
        ),
        type: 'custom',
        description: translateWithFallback(
          t,
          'customers.deals.kanban.addStage.position.help',
          'Choose where the new stage appears on the kanban. Existing stages after the chosen position shift one step to the right.',
        ),
        component: ({ value, setValue }) => {
          const current = typeof value === 'string' && value.length > 0 ? value : POSITION_END
          return (
            <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded-md border border-input bg-card p-1">
              {positionOptions.map((option) => {
                const selected = current === option.value
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    key={option.value}
                    type="button"
                    onClick={() => setValue(option.value)}
                    aria-pressed={selected}
                    className={`flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      selected
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                    <span
                      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        selected ? 'border-primary bg-primary' : 'border-input'
                      }`}
                      aria-hidden="true"
                    >
                      {selected ? (
                        <span className="size-1.5 rounded-full bg-primary-foreground" />
                      ) : null}
                    </span>
                  </Button>
                )
              })}
            </div>
          )
        },
      },
      {
        // Custom render — built-in `select` can't render a swatch alongside each label.
        // Keep the same palette + "No color" semantics the previous version exposed.
        id: 'color',
        label: translateWithFallback(t, 'customers.deals.kanban.addStage.color', 'Color'),
        type: 'custom',
        component: ({ value, setValue }) => {
          const current = typeof value === 'string' ? value : ''
          return (
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((option) => {
                const selected = current === option.value
                const label = translateWithFallback(t, option.labelKey, option.labelFallback)
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    key={option.value || 'none'}
                    type="button"
                    onClick={() => setValue(option.value)}
                    aria-pressed={selected}
                    title={label}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      selected
                        ? 'border-primary bg-muted text-foreground'
                        : 'border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {option.value ? (
                      <span
                        className="size-3 rounded-sm border border-border"
                        style={{ backgroundColor: option.value }}
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="size-3 rounded-sm border border-dashed border-border"
                        aria-hidden="true"
                      />
                    )}
                    <span>{label}</span>
                  </Button>
                )
              })}
            </div>
          )
        },
      },
    ],
    [positionOptions, t],
  )

  const initialValues = React.useMemo<Partial<AddStageFormValues>>(
    () => ({ label: '', color: '', position: POSITION_END }),
    [],
  )

  const handleSubmit = React.useCallback(
    async (values: AddStageFormValues) => {
      if (!context) return
      const trimmedLabel = values.label.trim()
      if (!trimmedLabel.length) {
        // Zod schema should already catch this — but we re-verify defensively because the
        // Zod check uses `trim().min(1)` and the field renders trimmed values consistently.
        throw createCrudFormError(labelRequiredMessage, { label: labelRequiredMessage })
      }
      const payload: Record<string, unknown> = {
        pipelineId: context.pipelineId,
        label: trimmedLabel,
      }
      if (values.color) payload.color = values.color
      const insertOrder = resolveInsertOrder(values.position ?? POSITION_END, context.existingStages)
      // Only send `order` when the operator explicitly chose a non-default position. Letting
      // it stay undefined preserves the legacy "append to end" behavior on the backend
      // (and keeps payloads clean / debugger-friendly for typical add flows).
      if (insertOrder !== undefined) payload.order = insertOrder
      const operation = () =>
        createCrud('customers/pipeline-stages', payload, {
          errorMessage: translateWithFallback(
            t,
            'customers.deals.kanban.addStage.error',
            'Failed to add stage.',
          ),
        })
      await runMutation({
        operation,
        context: {
          formId: ADD_STAGE_CONTEXT_ID,
          resourceKind: 'customers.pipeline_stage',
          retryLastMutation,
        },
      })
      flash(translateWithFallback(t, 'customers.deals.kanban.addStage.success', 'Stage added.'), 'success')
      onCreated()
      onClose()
    },
    [context, labelRequiredMessage, onClose, onCreated, retryLastMutation, runMutation, t],
  )

  if (!context) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translateWithFallback(t, 'customers.deals.kanban.addStage.title', 'New stage')}
          </DialogTitle>
          <DialogDescription>
            {translateWithFallback(
              t,
              'customers.deals.kanban.addStage.context',
              'Pipeline: {pipeline}',
              { pipeline: context.pipelineName },
            )}
          </DialogDescription>
        </DialogHeader>

        <CrudForm<AddStageFormValues>
          key={`${context.pipelineId}:${formInstanceKey}`}
          embedded
          fields={fields}
          initialValues={initialValues}
          schema={formSchema}
          submitLabel={translateWithFallback(
            t,
            'customers.deals.kanban.addStage.submit',
            'Add stage',
          )}
          onSubmit={handleSubmit}
          extraActions={
            <Button type="button" variant="outline" onClick={onClose}>
              {translateWithFallback(t, 'customers.deals.kanban.quickDeal.cancel', 'Cancel')}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

export default AddStageDialog
