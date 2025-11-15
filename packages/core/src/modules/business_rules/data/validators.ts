import { z } from 'zod'

/**
 * Business Rules Module - Zod Validators
 */

const uuid = z.uuid()

// Rule Types
export const ruleTypeSchema = z.enum(['GUARD', 'VALIDATION', 'CALCULATION', 'ACTION', 'ASSIGNMENT'])
export type RuleType = z.infer<typeof ruleTypeSchema>

// Condition Types
export const conditionTypeSchema = z.enum(['EXPRESSION', 'GROUP'])
export type ConditionType = z.infer<typeof conditionTypeSchema>

// Logical Operators
export const logicalOperatorSchema = z.enum(['AND', 'OR', 'NOT'])
export type LogicalOperator = z.infer<typeof logicalOperatorSchema>

// Comparison Operators
export const comparisonOperatorSchema = z.enum([
  '=',
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'MATCHES',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
])
export type ComparisonOperator = z.infer<typeof comparisonOperatorSchema>

// Data Types
export const dataTypeSchema = z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'ARRAY', 'OBJECT'])
export type DataType = z.infer<typeof dataTypeSchema>

// Action Trigger
export const actionTriggerSchema = z.enum(['ON_SUCCESS', 'ON_FAILURE', 'ALWAYS'])
export type ActionTrigger = z.infer<typeof actionTriggerSchema>

// Execution Result
export const executionResultSchema = z.enum(['SUCCESS', 'FAILURE', 'ERROR'])
export type ExecutionResult = z.infer<typeof executionResultSchema>

// Condition Expression Schema
// Note: This is a recursive schema for nested conditions
// For now, we use z.any() for the full expression, which will be validated at runtime
export const conditionExpressionSchema = z.any()

// Action Schema
export const actionSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.any()).optional(),
})

export const actionsArraySchema = z.array(actionSchema).optional().nullable()

// Date preprocessing helper
const dateOrNull = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}, z.date().nullable())

// BusinessRule Create Schema
export const createBusinessRuleSchema = z.object({
  ruleId: z.string().min(1).max(50),
  ruleName: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  ruleType: ruleTypeSchema,
  ruleCategory: z.string().max(50).optional().nullable(),
  entityType: z.string().min(1).max(50),
  eventType: z.string().max(50).optional().nullable(),
  conditionExpression: conditionExpressionSchema,
  successActions: actionsArraySchema,
  failureActions: actionsArraySchema,
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(0).max(9999).optional().default(100),
  version: z.number().int().min(1).optional().default(1),
  effectiveFrom: dateOrNull.optional(),
  effectiveTo: dateOrNull.optional(),
  tenantId: uuid,
  organizationId: uuid,
  createdBy: z.string().max(50).optional().nullable(),
})

export type CreateBusinessRuleInput = z.infer<typeof createBusinessRuleSchema>

// BusinessRule Update Schema
export const updateBusinessRuleSchema = createBusinessRuleSchema.partial().extend({
  id: uuid,
})

export type UpdateBusinessRuleInput = z.infer<typeof updateBusinessRuleSchema>

// Query/Filter Schema
export const businessRuleFilterSchema = z.object({
  ruleId: z.string().optional(),
  ruleName: z.string().optional(),
  ruleType: ruleTypeSchema.optional(),
  ruleCategory: z.string().optional(),
  entityType: z.string().optional(),
  eventType: z.string().optional(),
  enabled: z.boolean().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type BusinessRuleFilter = z.infer<typeof businessRuleFilterSchema>

// RuleExecutionLog Create Schema
export const createRuleExecutionLogSchema = z.object({
  ruleId: uuid,
  entityId: uuid,
  entityType: z.string().min(1).max(50),
  executionResult: executionResultSchema,
  inputContext: z.any().optional().nullable(),
  outputContext: z.any().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  executionTimeMs: z.number().int().min(0),
  executedAt: z.date().optional(),
  tenantId: uuid,
  organizationId: uuid.optional().nullable(),
  executedBy: z.string().max(50).optional().nullable(),
})

export type CreateRuleExecutionLogInput = z.infer<typeof createRuleExecutionLogSchema>

// RuleExecutionLog Query/Filter Schema
export const ruleExecutionLogFilterSchema = z.object({
  ruleId: uuid.optional(),
  entityId: uuid.optional(),
  entityType: z.string().optional(),
  executionResult: executionResultSchema.optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  executedBy: z.string().optional(),
  executedAtFrom: z.date().optional(),
  executedAtTo: z.date().optional(),
})

export type RuleExecutionLogFilter = z.infer<typeof ruleExecutionLogFilterSchema>

// RuleSet Create Schema
export const createRuleSetSchema = z.object({
  setId: z.string().min(1).max(50),
  setName: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  enabled: z.boolean().optional().default(true),
  tenantId: uuid,
  organizationId: uuid,
  createdBy: z.string().max(50).optional().nullable(),
})

export type CreateRuleSetInput = z.infer<typeof createRuleSetSchema>

// RuleSet Update Schema
export const updateRuleSetSchema = createRuleSetSchema.partial().extend({
  id: uuid,
})

export type UpdateRuleSetInput = z.infer<typeof updateRuleSetSchema>

// RuleSet Query/Filter Schema
export const ruleSetFilterSchema = z.object({
  setId: z.string().optional(),
  setName: z.string().optional(),
  enabled: z.boolean().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type RuleSetFilter = z.infer<typeof ruleSetFilterSchema>

// RuleSetMember Create Schema
export const createRuleSetMemberSchema = z.object({
  ruleSetId: uuid,
  ruleId: uuid,
  sequence: z.number().int().min(0).optional().default(0),
  enabled: z.boolean().optional().default(true),
  tenantId: uuid,
  organizationId: uuid,
})

export type CreateRuleSetMemberInput = z.infer<typeof createRuleSetMemberSchema>

// RuleSetMember Update Schema
export const updateRuleSetMemberSchema = z.object({
  id: uuid,
  sequence: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
})

export type UpdateRuleSetMemberInput = z.infer<typeof updateRuleSetMemberSchema>

// RuleSetMember Query/Filter Schema
export const ruleSetMemberFilterSchema = z.object({
  ruleSetId: uuid.optional(),
  ruleId: uuid.optional(),
  enabled: z.boolean().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type RuleSetMemberFilter = z.infer<typeof ruleSetMemberFilterSchema>

// Rule Engine Context Schema
export const ruleEngineContextSchema = z.looseObject({
  entityType: z.string().min(1, 'entityType is required'),
  entityId: z.string().optional(),
  eventType: z.string().optional(),
  data: z.any(),
  user: z.looseObject({
    id: z.string().optional(),
    email: z.string().optional(),
    role: z.string().optional(),
  }).optional(),
  tenant: z.looseObject({
    id: z.string().optional(),
  }).optional(),
  organization: z.looseObject({
    id: z.string().optional(),
  }).optional(),
  tenantId: z.uuid('tenantId must be a valid UUID'),
  organizationId: z.uuid('organizationId must be a valid UUID'),
  executedBy: z.string().optional(),
  dryRun: z.boolean().optional(),
})

export type RuleEngineContextInput = z.infer<typeof ruleEngineContextSchema>

// Rule Discovery Options Schema
export const ruleDiscoveryOptionsSchema = z.object({
  entityType: z.string().min(1, 'entityType is required'),
  eventType: z.string().optional(),
  tenantId: z.uuid('tenantId must be a valid UUID'),
  organizationId: z.uuid('organizationId must be a valid UUID'),
  ruleType: ruleTypeSchema.optional(),
})

export type RuleDiscoveryOptionsInput = z.infer<typeof ruleDiscoveryOptionsSchema>
