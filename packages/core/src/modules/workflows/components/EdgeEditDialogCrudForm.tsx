'use client'

import type { Edge } from '@xyflow/react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Trash2 } from 'lucide-react'
import { CrudForm, type CrudFormGroup, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ConditionBuilder } from '@open-mercato/core/modules/business_rules/components/ConditionBuilder'
import type { GroupCondition } from '@open-mercato/core/modules/business_rules/components/utils/conditionValidation'
import { InputDataPanel } from './InputDataPanel'
import { InspectorPanel, type InspectorPanelVariant } from './InspectorPanel'
import { BusinessRuleConditionsEditor } from './fields/BusinessRuleConditionsEditor'
import { ActivityArrayEditor } from './fields/ActivityArrayEditor'
import { edgeToFormValues, formValuesToEdgeUpdates, type EdgeFormValues } from '../lib/edgeFormTransforms'
import type { LedgerEntry } from '../lib/context-ledger'

/**
 * JsonConfigEditor - Custom field wrapper for JsonBuilder
 */
function JsonConfigEditor({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  return (
    <JsonBuilder
      value={value || {}}
      onChange={setValue}
      disabled={disabled}
    />
  )
}

export interface EdgeEditDialogCrudFormProps {
  edge: Edge | null
  isOpen: boolean
  onClose: () => void
  onSave: (edgeId: string, updates: Partial<Edge['data']>) => void
  onDelete: (edgeId: string) => void
  ledgerEntries?: LedgerEntry[]
  /**
   * Field the dialog scrolls to and focuses on open. Route chips (#4244) pass
   * the field behind the chip that was clicked, so the author lands on the
   * condition or the activity list instead of the top of the form.
   */
  focusFieldId?: string | null
  /**
   * How the inspector is presented. Defaults to `overlay` so a caller that has
   * not opted in keeps the modal shape it had.
   */
  variant?: InspectorPanelVariant
  /** Widen the overlay Drawer and lay the ledger out as a sticky side column. */
  wide?: boolean
}

/**
 * EdgeEditDialogCrudForm - CrudForm-based modal dialog for editing transition properties
 *
 * Migrated from EdgeEditDialog to use CrudForm for:
 * - UI coherence with other admin forms
 * - Custom fields support (future enhancement)
 * - Standardized validation and error handling
 * - Consistent keyboard shortcuts
 *
 * Features:
 * - Basic configuration (name, trigger, priority)
 * - Business rules (pre/post conditions with modal integration)
 * - Activities with nested retry policies
 * - Advanced JSON configuration
 * - Delete functionality with confirmation
 * - Keyboard shortcuts (Cmd/Ctrl+Enter save, Escape cancel)
 */
export function EdgeEditDialogCrudForm({ edge, isOpen, onClose, onSave, onDelete, ledgerEntries, focusFieldId, variant = 'overlay', wide }: EdgeEditDialogCrudFormProps) {
  const t = useT()
  const [initialValues, setInitialValues] = useState<Partial<EdgeFormValues>>({})
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Load edge data when dialog opens
  useEffect(() => {
    if (edge && isOpen) {
      const values = edgeToFormValues(edge)
      setInitialValues(values)
    }
  }, [edge, isOpen])

  const handleSubmit = useCallback(async (values: Record<string, unknown>) => {
    if (!edge) return

    try {
      const updates = formValuesToEdgeUpdates(values as unknown as EdgeFormValues, edge)
      onSave(edge.id, updates)
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(t(message))
    }
  }, [edge, onSave, onClose, t])

  // Chip-driven deep link: CrudForm marks each field container with
  // `data-crud-field-id`, so scrolling to it is enough to land the author on the
  // right section without reordering or collapsing anything.
  useEffect(() => {
    if (!isOpen || !focusFieldId) return
    const frame = requestAnimationFrame(() => {
      const container = bodyRef.current?.querySelector<HTMLElement>(`[data-crud-field-id="${focusFieldId}"]`)
      if (!container) return
      container.scrollIntoView({ block: 'center' })
      container.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusFieldId, isOpen, initialValues])

  const handleDelete = useCallback(() => {
    if (!edge) return
    onDelete(edge.id)
  }, [edge, onDelete])

  // Define form groups
  const groups: CrudFormGroup[] = useMemo(() => [
    {
      id: 'basic',
      title: t('workflows.edgeEditor.groups.basic'),
      column: 1,
      fields: ['transitionName', 'trigger', 'priority', 'continueOnActivityFailure'],
    },
    {
      id: 'routing',
      title: t('workflows.edgeEditor.groups.routing'),
      column: 1,
      description: t('workflows.edgeEditor.groups.routingDescription'),
      fields: ['condition'],
    },
    {
      id: 'businessRules',
      title: t('workflows.edgeEditor.groups.businessRules'),
      column: 1,
      description: t('workflows.edgeEditor.groups.businessRulesDescription'),
      fields: ['preConditions', 'postConditions'],
    },
    {
      id: 'activities',
      title: t('workflows.edgeEditor.activities'),
      column: 1,
      description: t('workflows.edgeEditor.activitiesDescription'),
      fields: ['activities'],
    },
    {
      id: 'advanced',
      title: t('workflows.edgeEditor.advancedConfiguration'),
      column: 1,
      description: t('workflows.edgeEditor.advancedConfigHint'),
      fields: ['advancedConfig'],
    },
  ], [t])

  // Define form fields
  const fields: CrudField[] = useMemo(() => [
    {
      id: 'transitionName',
      label: t('workflows.edgeEditor.transitionName'),
      type: 'text',
      placeholder: t('workflows.edgeEditor.placeholders.transitionName'),
      required: true,
      description: t('workflows.edgeEditor.transitionNameHint'),
    },
    {
      id: 'trigger',
      label: t('workflows.edgeEditor.triggerType'),
      type: 'select',
      required: true,
      options: [
        { value: 'auto', label: t('workflows.transitions.triggers.auto') },
        { value: 'manual', label: t('workflows.transitions.triggers.manual') },
        { value: 'signal', label: t('workflows.transitions.triggers.signal') },
        { value: 'timer', label: t('workflows.transitions.triggers.timer') },
      ],
      description: t('workflows.edgeEditor.triggerTypeDescription'),
    },
    {
      id: 'priority',
      label: t('workflows.edgeEditor.priority'),
      type: 'number',
      placeholder: '100',
      description: t('workflows.edgeEditor.priorityHint'),
    },
    {
      id: 'continueOnActivityFailure',
      label: t('workflows.edgeEditor.continueOnActivityFailure'),
      type: 'checkbox',
      description: t('workflows.edgeEditor.continueOnActivityFailureHint'),
    },
    {
      id: 'condition',
      label: t('workflows.edgeEditor.condition'),
      type: 'custom',
      description: t('workflows.edgeEditor.conditionHint'),
      component: (props) => (
        <ConditionBuilder
          value={(props.value as GroupCondition | null | undefined) ?? null}
          onChangeAction={props.setValue}
          error={props.error}
          showJsonPreview
        />
      ),
    },
    {
      id: 'preConditions',
      label: t('workflows.edgeEditor.preConditions'),
      type: 'custom',
      description: t('workflows.edgeEditor.preConditionsHint'),
      component: (props) => (
        <BusinessRuleConditionsEditor
          {...props}
          value={props.value as any}
        />
      ),
    },
    {
      id: 'postConditions',
      label: t('workflows.edgeEditor.postConditions'),
      type: 'custom',
      description: t('workflows.edgeEditor.postConditionsHint'),
      component: (props) => (
        <BusinessRuleConditionsEditor
          {...props}
          value={props.value as any}
        />
      ),
    },
    {
      id: 'activities',
      label: t('workflows.edgeEditor.activities'),
      type: 'custom',
      description: t('workflows.edgeEditor.activitiesDescription'),
      component: (props) => <ActivityArrayEditor {...props} value={props.value as any} ledgerEntries={ledgerEntries} />,
    },
    {
      id: 'advancedConfig',
      label: t('workflows.edgeEditor.advancedConfiguration'),
      type: 'custom',
      description: t('workflows.edgeEditor.advancedConfigHint'),
      component: (props) => <JsonConfigEditor {...props} />,
    },
  ], [ledgerEntries, t])

  if (!isOpen || !edge) return null

  const edgeData = edge.data as any
  const trigger = edgeData?.trigger || 'auto'
  const triggerVariant = trigger === 'auto' ? 'default' : trigger === 'manual' ? 'secondary' : 'outline'

  return (
    <InspectorPanel
      open={isOpen}
      onClose={onClose}
      variant={variant}
      wide={wide}
      title={t('workflows.edgeEditor.title')}
      typeLabel={t(`workflows.transitions.triggers.${trigger}`)}
      typeLabelVariant={triggerVariant}
      description={t('workflows.edgeEditor.description')}
      recordId={edge.id}
      recordIdLabel={t('workflows.edgeEditor.id')}
      headerExtra={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{t('workflows.edgeEditor.flow')}:</span>
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono">{edge.source}</code>
          <span aria-hidden="true">→</span>
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono">{edge.target}</code>
        </div>
      }
    >
      <div className={wide ? 'flex gap-6' : undefined}>
        <div ref={bodyRef} className={wide ? 'min-w-0 flex-1' : undefined}>
          {/* Remount on re-target — see the note in NodeEditDialogCrudForm. */}
          <CrudForm
            key={edge.id}
            density="compact"
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            embedded={true}
            submitLabel={t('workflows.edgeEditor.saveTransition')}
            extraActions={
              <Button
                type="button"
                variant="destructive-outline"
                onClick={handleDelete}
              >
                <Trash2 className="size-4 mr-2" />
                {t('workflows.edgeEditor.deleteTransition')}
              </Button>
            }
          />
        </div>
        <div className={wide ? 'sticky top-0 w-96 shrink-0 self-start' : 'mt-4'}>
          <InputDataPanel
            entries={ledgerEntries}
            stepId={edge.target}
            defaultCollapsed={!wide}
          />
        </div>
      </div>
    </InspectorPanel>
  )
}
