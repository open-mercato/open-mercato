"use client"

/**
 * Form-editor configuration — DEPRECATED (spec section 10).
 *
 * The form editor is retired: `/backend/definitions/create` and
 * `/backend/definitions/[id]` now forward to the Studio, and nothing in this
 * module builds a workflow `CrudForm` any more. Every export below stays for at
 * least one minor release so third-party pages that embed the definition form
 * keep compiling (BACKWARD_COMPATIBILITY.md deprecation protocol); they are
 * scheduled for removal one minor after the UPGRADE_NOTES entry.
 *
 * @deprecated Author workflows in `/backend/definitions/visual-editor`.
 */

import * as React from 'react'
import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { WorkflowDefinitionTrigger } from '../data/entities'

/**
 * Form Values Type
 * Represents the structure of form data for creating/editing workflow definitions
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export type WorkflowDefinitionFormValues = {
  workflowId: string
  workflowName: string
  description?: string | null
  version: number
  enabled: boolean
  effectiveFrom?: string | null
  effectiveTo?: string | null
  // Metadata fields are declared on the form with dot-path ids
  // (`metadata.category`, `metadata.tags`, `metadata.icon`). CrudForm only
  // collapses dot-paths for injected/custom fields, so declared base fields are
  // carried as flat keys end-to-end; buildWorkflowPayload reassembles them into
  // the nested metadata object the API expects. See issue #2503.
  'metadata.category'?: string
  'metadata.tags'?: string[]
  'metadata.icon'?: string
  steps: any[]
  transitions: any[]
  triggers: WorkflowDefinitionTrigger[]
  loadedDefinition?: Record<string, unknown> | null
  loadedMetadata?: Record<string, unknown> | null
  id?: string
  updatedAt?: string | null
}

/**
 * Form Validation Schema
 * Extends the API schema with additional client-side validation
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export const workflowDefinitionFormSchema = z.object({
  workflowId: z.string()
    .min(1, 'Workflow ID is required')
    .max(100, 'Workflow ID must be 100 characters or less')
    .regex(/^[a-z0-9_.-]+$/, 'Workflow ID must contain only lowercase letters, numbers, hyphens, underscores, and dots'),
  workflowName: z.string()
    .min(1, 'Workflow name is required')
    .max(200, 'Workflow name must be 200 characters or less'),
  description: z.string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional()
    .nullable(),
  version: z.number().int().min(1),
  enabled: z.boolean(),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  // Flat dot-path keys mirror the field ids so CrudForm's non-strict
  // schema.safeParse keeps them instead of stripping them before onSubmit.
  'metadata.category': z.string().max(50).optional(),
  'metadata.tags': z.array(z.string()).optional(),
  'metadata.icon': z.string().max(50).optional(),
  steps: z.array(z.any()),
  transitions: z.array(z.any()),
  triggers: z.array(z.any()).default([]),
})

/**
 * Default Form Values
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export const defaultFormValues: WorkflowDefinitionFormValues = {
  workflowId: '',
  workflowName: '',
  description: null,
  version: 1,
  enabled: true,
  effectiveFrom: null,
  effectiveTo: null,
  'metadata.category': '',
  'metadata.tags': [],
  'metadata.icon': '',
  steps: [],
  transitions: [],
  triggers: [],
}

/**
 * Create Field Definitions
 * Returns field configurations for the CrudForm
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export function createFieldDefinitions(t: (key: string) => string): CrudField[] {
  return [
    {
      id: 'workflowId',
      label: t('workflows.form.workflowId'),
      type: 'text',
      required: true,
      placeholder: t('workflows.form.placeholders.workflowId'),
      description: t('workflows.form.descriptions.workflowId'),
    },
    {
      id: 'workflowName',
      label: t('workflows.form.workflowName'),
      type: 'text',
      required: true,
      placeholder: t('workflows.form.placeholders.workflowName'),
    },
    {
      id: 'description',
      label: t('workflows.form.description'),
      type: 'textarea',
      placeholder: t('workflows.form.placeholders.description'),
    },
    {
      id: 'version',
      label: t('workflows.form.version'),
      type: 'number',
      required: true,
      description: t('workflows.form.descriptions.version'),
    },
    {
      id: 'enabled',
      label: t('workflows.form.enabled'),
      type: 'checkbox',
      description: t('workflows.form.descriptions.enabled'),
    },
    {
      id: 'effectiveFrom',
      label: t('workflows.form.effectiveFrom'),
      type: 'date',
      description: t('workflows.form.descriptions.effectiveFrom'),
    },
    {
      id: 'effectiveTo',
      label: t('workflows.form.effectiveTo'),
      type: 'date',
      description: t('workflows.form.descriptions.effectiveTo'),
    },
    {
      id: 'metadata.category',
      label: t('workflows.form.category'),
      type: 'text',
      placeholder: t('workflows.form.placeholders.category'),
    },
    {
      id: 'metadata.tags',
      label: t('workflows.form.tags'),
      type: 'tags',
      placeholder: t('workflows.form.placeholders.tags'),
      description: t('workflows.form.descriptions.tags'),
    },
    {
      id: 'metadata.icon',
      label: t('workflows.form.icon'),
      type: 'text',
      placeholder: t('workflows.form.placeholders.icon'),
      description: t('workflows.form.descriptions.icon'),
    },
  ]
}

/**
 * Create Form Groups
 * Returns grouped layout configuration for the CrudForm
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export function createFormGroups(
  t: (key: string) => string,
  StepsEditorComponent: React.ComponentType<any>,
  TransitionsEditorComponent: React.ComponentType<any>,
  options?: { onInvalidActivityConfigsChange?: (activityLabels: string[]) => void }
): CrudFormGroup[] {
  const onInvalidActivityConfigsChange = options?.onInvalidActivityConfigsChange

  // Wrapper components to adapt CrudForm props
  const StepsEditorWrapper = (props: { value: any; setValue: (v: any) => void; error?: string; values?: any }) => {
    return <StepsEditorComponent value={props.value} onChange={props.setValue} error={props.error} />
  }

  const TransitionsEditorWrapper = (props: { value: any; setValue: (v: any) => void; error?: string; values?: any }) => {
    // Pass the steps from values (all form values) so transitions can reference them
    return (
      <TransitionsEditorComponent
        value={props.value}
        onChange={props.setValue}
        steps={props.values?.steps || []}
        error={props.error}
        onInvalidActivityConfigsChange={onInvalidActivityConfigsChange}
      />
    )
  }

  return [
    {
      id: 'basic',
      title: t('workflows.form.groups.basic'),
      column: 1,
      fields: [
        'workflowId',
        'workflowName',
        'description',
        'version',
        'enabled',
      ],
    },
    {
      id: 'metadata',
      title: t('workflows.form.groups.metadata'),
      column: 1,
      fields: [
        'metadata.category',
        'metadata.tags',
        'metadata.icon',
        'effectiveFrom',
        'effectiveTo',
      ],
    },
    {
      id: 'steps',
      title: t('workflows.form.groups.steps'),
      column: 1,
      fields: [
        {
          id: 'steps',
          label: t('workflows.form.stepsLabel'),
          type: 'custom',
          required: true,
          component: StepsEditorWrapper,
        },
      ],
    },
    {
      id: 'transitions',
      title: t('workflows.form.groups.transitions'),
      column: 1,
      fields: [
        {
          id: 'transitions',
          label: t('workflows.form.transitionsLabel'),
          type: 'custom',
          required: true,
          component: TransitionsEditorWrapper,
        },
      ],
    },
  ]
}

/**
 * Save gate for invalid activity configuration JSON.
 *
 * The activity config textareas keep invalid text local (so keystrokes are not
 * lost), which means the form values still hold the last VALID config. Without
 * this gate, saving while a textarea holds invalid JSON silently persists the
 * stale config. Pages wire `createFormGroups`'s `onInvalidActivityConfigsChange`
 * into state and call this at the top of their submit handler.
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export function assertNoInvalidActivityConfigs(
  invalidActivityLabels: string[],
  t: (key: string, params?: Record<string, string | number>) => string,
): void {
  if (invalidActivityLabels.length === 0) return
  throw createCrudFormError(
    t('workflows.validation.invalidActivityConfigJson', { activity: invalidActivityLabels.join(', ') }),
  )
}

import { toDateInputValue } from '@open-mercato/shared/lib/date/format'

/**
 * Parse workflow definition to form values
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export function parseWorkflowToFormValues(workflow: any): WorkflowDefinitionFormValues {
  const updatedAt = workflow.updatedAt ?? workflow.updated_at ?? null
  const metadata = workflow.metadata || {}
  return {
    workflowId: workflow.workflowId || '',
    workflowName: workflow.workflowName || '',
    description: workflow.description || null,
    version: workflow.version || 1,
    enabled: workflow.enabled ?? true,
    effectiveFrom: toDateInputValue(workflow.effectiveFrom),
    effectiveTo: toDateInputValue(workflow.effectiveTo),
    // Hydrate the flat dot-path keys the CrudForm inputs actually read.
    'metadata.category': metadata.category || '',
    'metadata.tags': Array.isArray(metadata.tags) ? metadata.tags : [],
    'metadata.icon': metadata.icon || '',
    steps: workflow.definition?.steps || [],
    transitions: workflow.definition?.transitions || [],
    triggers: workflow.definition?.triggers || [],
    loadedDefinition: workflow.definition || null,
    loadedMetadata: workflow.metadata || null,
    id: workflow.id,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : updatedAt ? String(updatedAt) : null,
  }
}

/**
 * Build API payload from form values
 *
 * @deprecated Retired with the form editor (spec section 10) — author workflows in the Studio.
 */
export function buildWorkflowPayload(values: WorkflowDefinitionFormValues) {
  const triggers = values.triggers ?? []
  // Collapse the flat dot-path keys back into the nested metadata object the API
  // expects. Empty category/icon are dropped so they don't persist as blanks.
  const category = (values['metadata.category'] || '').trim()
  const icon = (values['metadata.icon'] || '').trim()
  const tags = Array.isArray(values['metadata.tags']) ? values['metadata.tags'] : []
  const metadata: Record<string, unknown> = {
    ...(values.loadedMetadata ?? {}),
    tags,
  }
  if (category) metadata.category = category
  else delete metadata.category
  if (icon) metadata.icon = icon
  else delete metadata.icon
  return {
    workflowId: values.workflowId,
    workflowName: values.workflowName,
    description: values.description || null,
    version: values.version,
    enabled: values.enabled,
    effectiveFrom: values.effectiveFrom || null,
    effectiveTo: values.effectiveTo || null,
    metadata,
    definition: buildLegacyDefinition(values, triggers),
  }
}

function buildLegacyDefinition(values: WorkflowDefinitionFormValues, triggers: WorkflowDefinitionTrigger[]) {
  const definition: Record<string, unknown> = {
    ...(values.loadedDefinition ?? {}),
    steps: values.steps,
    transitions: values.transitions,
  }
  if (triggers.length > 0) definition.triggers = triggers
  else delete definition.triggers
  return definition
}
