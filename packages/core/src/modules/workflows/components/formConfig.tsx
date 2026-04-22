"use client"

import * as React from 'react'
import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

/**
 * Form Values Type
 * Represents the structure of form data for creating/editing workflow definitions
 */
export type WorkflowDefinitionFormValues = {
  workflowId: string
  workflowName: string
  description?: string | null
  version: number
  enabled: boolean
  effectiveFrom?: Date | null
  effectiveTo?: Date | null
  metadata?: {
    tags?: string[]
    category?: string
    icon?: string
  } | null
  steps: any[]
  transitions: any[]
}

/**
 * Form Validation Schema
 * Extends the API schema with additional client-side validation
 */
export const workflowDefinitionFormSchema = z.object({
  workflowId: z.string()
    .min(1, 'Workflow ID is required')
    .max(50, 'Workflow ID must be 50 characters or less')
    .regex(/^[a-z0-9_-]+$/, 'Workflow ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  workflowName: z.string()
    .min(1, 'Workflow name is required')
    .max(200, 'Workflow name must be 200 characters or less'),
  description: z.string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional()
    .nullable(),
  version: z.number().int().min(1),
  enabled: z.boolean(),
  effectiveFrom: z.date().optional().nullable(),
  effectiveTo: z.date().optional().nullable(),
  metadata: z.object({
    tags: z.array(z.string()).optional(),
    category: z.string().max(50).optional(),
    icon: z.string().max(50).optional(),
  }).optional().nullable(),
  steps: z.array(z.any()),
  transitions: z.array(z.any()),
})

/**
 * Default Form Values
 */
export const defaultFormValues: WorkflowDefinitionFormValues = {
  workflowId: '',
  workflowName: '',
  description: null,
  version: 1,
  enabled: true,
  effectiveFrom: null,
  effectiveTo: null,
  metadata: {
    tags: [],
    category: '',
    icon: '',
  },
  steps: [],
  transitions: [],
}

/**
 * Create Field Definitions
 * Returns field configurations for the CrudForm
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
 */
export function createFormGroups(
  t: (key: string) => string,
  StepsEditorComponent: React.ComponentType<any>,
  TransitionsEditorComponent: React.ComponentType<any>
): CrudFormGroup[] {
  // Wrapper components to adapt CrudForm props
  const StepsEditorWrapper = (props: { value: any; setValue: (v: any) => void; error?: string; values?: any }) => {
    return <StepsEditorComponent value={props.value} onChange={props.setValue} error={props.error} />
  }

  const TransitionsEditorWrapper = (props: { value: any; setValue: (v: any) => void; error?: string; values?: any }) => {
    // Pass the steps from values (all form values) so transitions can reference them
    return <TransitionsEditorComponent value={props.value} onChange={props.setValue} steps={props.values?.steps || []} error={props.error} />
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
 * Parse workflow definition to form values
 */
export function parseWorkflowToFormValues(workflow: any): WorkflowDefinitionFormValues {
  return {
    workflowId: workflow.workflowId || '',
    workflowName: workflow.workflowName || '',
    description: workflow.description || null,
    version: workflow.version || 1,
    enabled: workflow.enabled ?? true,
    effectiveFrom: workflow.effectiveFrom ? new Date(workflow.effectiveFrom) : null,
    effectiveTo: workflow.effectiveTo ? new Date(workflow.effectiveTo) : null,
    metadata: workflow.metadata || { tags: [], category: '', icon: '' },
    steps: workflow.definition?.steps || [],
    transitions: workflow.definition?.transitions || [],
  }
}

/**
 * Build API payload from form values
 */
export function buildWorkflowPayload(values: WorkflowDefinitionFormValues) {
  return {
    workflowId: values.workflowId,
    workflowName: values.workflowName,
    description: values.description || null,
    version: values.version,
    enabled: values.enabled,
    effectiveFrom: values.effectiveFrom ? values.effectiveFrom.toISOString() : null,
    effectiveTo: values.effectiveTo ? values.effectiveTo.toISOString() : null,
    metadata: values.metadata || null,
    definition: {
      steps: values.steps,
      transitions: values.transitions,
    },
  }
}
