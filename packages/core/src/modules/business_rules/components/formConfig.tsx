"use client"

import * as React from 'react'
import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import {
  createBusinessRuleSchema,
  ruleTypeSchema,
  type RuleType,
} from '../data/validators'

/**
 * Form Values Type
 * Represents the structure of form data for creating/editing business rules
 */
export type BusinessRuleFormValues = {
  ruleId: string
  ruleName: string
  description?: string | null
  ruleType: RuleType
  ruleCategory?: string | null
  entityType: string
  eventType?: string | null
  conditionExpression: any
  successActions?: any[] | null
  failureActions?: any[] | null
  enabled: boolean
  priority: number
  version: number
  effectiveFrom?: Date | null
  effectiveTo?: Date | null
}

/**
 * Form Validation Schema
 * Extends the API schema with additional client-side validation
 */
export const businessRuleFormSchema = z.object({
  ruleId: z.string().min(1, 'Rule ID is required').max(50, 'Rule ID must be 50 characters or less'),
  ruleName: z.string().min(1, 'Rule name is required').max(200, 'Rule name must be 200 characters or less'),
  description: z.string().max(5000, 'Description must be 5000 characters or less').optional().nullable(),
  ruleType: ruleTypeSchema,
  ruleCategory: z.string().max(50, 'Category must be 50 characters or less').optional().nullable(),
  entityType: z.string().min(1, 'Entity type is required').max(50, 'Entity type must be 50 characters or less'),
  eventType: z.string().max(50, 'Event type must be 50 characters or less').optional().nullable(),
  conditionExpression: z.any(), // Validated by custom validator
  successActions: z.array(z.any()).optional().nullable(),
  failureActions: z.array(z.any()).optional().nullable(),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(9999),
  version: z.number().int().min(1),
  effectiveFrom: z.date().optional().nullable(),
  effectiveTo: z.date().optional().nullable(),
})

/**
 * Get Rule Type Options
 */
export function getRuleTypeOptions(t: (key: string) => string) {
  return [
    { label: t('business_rules.types.guard'), value: 'GUARD' },
    { label: t('business_rules.types.validation'), value: 'VALIDATION' },
    { label: t('business_rules.types.calculation'), value: 'CALCULATION' },
    { label: t('business_rules.types.action'), value: 'ACTION' },
    { label: t('business_rules.types.assignment'), value: 'ASSIGNMENT' },
  ]
}

/**
 * Create Field Definitions
 * Returns field configurations for the CrudForm
 */
export function createFieldDefinitions(t: (key: string) => string): CrudField[] {
  return [
    {
      id: 'ruleId',
      label: t('business_rules.rules.form.ruleId'),
      type: 'text',
      required: true,
      placeholder: t('business_rules.rules.form.placeholders.ruleId'),
      description: t('business_rules.rules.form.descriptions.ruleId'),
    },
    {
      id: 'ruleName',
      label: t('business_rules.rules.form.ruleName'),
      type: 'text',
      required: true,
      placeholder: t('business_rules.rules.form.placeholders.ruleName'),
    },
    {
      id: 'description',
      label: t('business_rules.rules.form.description'),
      type: 'textarea',
      placeholder: t('business_rules.rules.form.placeholders.description'),
      rows: 3,
    },
    {
      id: 'ruleType',
      label: t('business_rules.rules.form.ruleType'),
      type: 'select',
      required: true,
      options: getRuleTypeOptions(t),
    },
    {
      id: 'ruleCategory',
      label: t('business_rules.rules.form.ruleCategory'),
      type: 'text',
      placeholder: t('business_rules.rules.form.placeholders.ruleCategory'),
    },
    {
      id: 'entityType',
      label: t('business_rules.rules.form.entityType'),
      type: 'text',
      required: true,
      placeholder: t('business_rules.rules.form.placeholders.entityType'),
    },
    {
      id: 'eventType',
      label: t('business_rules.rules.form.eventType'),
      type: 'text',
      placeholder: t('business_rules.rules.form.placeholders.eventType'),
    },
    {
      id: 'priority',
      label: t('business_rules.rules.form.priority'),
      type: 'number',
      required: true,
      placeholder: '100',
      description: t('business_rules.rules.form.descriptions.priority'),
    },
    {
      id: 'enabled',
      label: t('business_rules.rules.form.enabled'),
      type: 'checkbox',
      description: t('business_rules.rules.form.descriptions.enabled'),
    },
    {
      id: 'version',
      label: t('business_rules.rules.form.version'),
      type: 'number',
      required: true,
    },
    {
      id: 'effectiveFrom',
      label: t('business_rules.rules.form.effectiveFrom'),
      type: 'date',
      description: t('business_rules.rules.form.descriptions.effectiveFrom'),
    },
    {
      id: 'effectiveTo',
      label: t('business_rules.rules.form.effectiveTo'),
      type: 'date',
      description: t('business_rules.rules.form.descriptions.effectiveTo'),
    },
  ]
}

/**
 * Create Form Groups
 * Returns grouped layout configuration for the CrudForm
 */
export function createFormGroups(
  t: (key: string) => string,
  ConditionBuilderComponent: React.ComponentType<any>,
  ActionBuilderComponent: React.ComponentType<any>
): CrudFormGroup[] {
  // Wrapper to adapt CrudForm props to ConditionBuilder props
  const ConditionBuilderWrapper = (props: { value: any; setValue: (v: any) => void; error?: string }) => {
    return <ConditionBuilderComponent value={props.value} onChangeAction={props.setValue} error={props.error} showJsonPreview />
  }

  // Wrapper to adapt CrudForm props to ActionBuilder props
  const ActionBuilderWrapper = (props: { value: any; setValue: (v: any) => void; error?: string }) => {
    return <ActionBuilderComponent value={props.value} onChange={props.setValue} error={props.error} showJsonPreview />
  }
  return [
    {
      id: 'basic',
      title: t('business_rules.rules.form.basic.title'),
      column: 1,
      fields: [
        'ruleId',
        'ruleName',
        'description',
        'ruleType',
        'ruleCategory',
        'entityType',
        'eventType',
      ],
    },
    {
      id: 'conditions',
      title: t('business_rules.rules.form.conditions.title'),
      column: 1,
      fields: [
        {
          id: 'conditionExpression',
          label: '',
          type: 'custom',
          component: ConditionBuilderWrapper,
          description: t('business_rules.rules.form.conditions.description'),
        },
      ],
    },
    {
      id: 'successActions',
      title: t('business_rules.rules.form.actions.title') + ' - ' + t('business_rules.rules.form.actions.success'),
      column: 1,
      fields: [
        {
          id: 'successActions',
          label: '',
          type: 'custom',
          component: ActionBuilderWrapper,
        },
      ],
    },
    {
      id: 'failureActions',
      title: t('business_rules.rules.form.actions.title') + ' - ' + t('business_rules.rules.form.actions.failure'),
      column: 1,
      fields: [
        {
          id: 'failureActions',
          label: '',
          type: 'custom',
          component: ActionBuilderWrapper,
        },
      ],
    },
    {
      id: 'metadata',
      title: t('business_rules.rules.form.metadata.title'),
      column: 2,
      fields: ['priority', 'enabled', 'version', 'effectiveFrom', 'effectiveTo'],
    },
  ]
}

/**
 * Default Form Values
 * Initial values for creating a new rule
 */
export const defaultFormValues: Partial<BusinessRuleFormValues> = {
  enabled: true,
  priority: 100,
  version: 1,
  conditionExpression: null,
  successActions: null,
  failureActions: null,
}
