/**
 * Workflows Module - Start Validator Service
 *
 * Validates pre-conditions on START step before workflow instance creation.
 * This enables guard rules that determine whether a workflow can be started
 * based on the initial context provided.
 */

import { EntityManager } from '@mikro-orm/core'
import { WorkflowDefinition } from '../data/entities'
import * as ruleEngine from '../../business_rules/lib/rule-engine'
import type { StartPreCondition } from '../data/validators'

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface ValidateStartOptions {
  workflowId: string
  version?: number
  context: Record<string, any>
  locale?: string
  tenantId: string
  organizationId: string
}

export interface ValidationError {
  ruleId: string
  message: string
  code: string
}

export interface ValidatedRule {
  ruleId: string
  passed: boolean
  executionTime?: number
}

export interface ValidateStartResult {
  canStart: boolean
  errors: ValidationError[]
  validatedRules: ValidatedRule[]
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate if a workflow can be started with the given context
 *
 * @param em - Entity manager for database operations
 * @param options - Validation options including workflowId, context, and scope
 * @returns Validation result with canStart flag, errors, and validated rules
 */
export async function validateWorkflowStart(
  em: EntityManager,
  options: ValidateStartOptions
): Promise<ValidateStartResult> {
  const { workflowId, version, context, locale = 'en', tenantId, organizationId } = options

  // Find workflow definition
  const definition = await findWorkflowDefinition(em, {
    workflowId,
    version,
    tenantId,
    organizationId,
  })

  if (!definition) {
    return {
      canStart: false,
      errors: [{
        ruleId: '_DEFINITION_NOT_FOUND',
        message: `Workflow definition not found: ${workflowId}`,
        code: 'DEFINITION_NOT_FOUND',
      }],
      validatedRules: [],
    }
  }

  if (!definition.enabled) {
    return {
      canStart: false,
      errors: [{
        ruleId: '_DEFINITION_DISABLED',
        message: `Workflow is disabled: ${workflowId}`,
        code: 'DEFINITION_DISABLED',
      }],
      validatedRules: [],
    }
  }

  // Find START step and get pre-conditions
  const startStep = definition.definition.steps.find(
    (s: any) => s.stepType === 'START'
  )

  if (!startStep) {
    return {
      canStart: false,
      errors: [{
        ruleId: '_NO_START_STEP',
        message: 'Workflow has no START step',
        code: 'INVALID_DEFINITION',
      }],
      validatedRules: [],
    }
  }

  const preConditions: StartPreCondition[] = startStep.preConditions || []

  console.log('[start-validator] START step:', JSON.stringify(startStep, null, 2))
  console.log('[start-validator] preConditions:', preConditions.length, JSON.stringify(preConditions))

  // If no pre-conditions, workflow can start
  if (preConditions.length === 0) {
    console.log('[start-validator] No pre-conditions defined, allowing start')
    return {
      canStart: true,
      errors: [],
      validatedRules: [],
    }
  }

  // Evaluate each pre-condition using rule engine
  const errors: ValidationError[] = []
  const validatedRules: ValidatedRule[] = []

  for (const condition of preConditions) {
    // Execute rule directly by string rule_id
    const result = await ruleEngine.executeRuleByRuleId(em, {
      ruleId: condition.ruleId,  // String identifier like "workflow_checkout_inventory_available"
      data: {
        workflowId,
        workflowContext: context,
      },
      tenantId,
      organizationId,
      entityType: `workflow:${workflowId}:start`,
      entityId: 'pre_start_validation',
      eventType: 'validate_start',
      dryRun: true, // Don't log execution during validation
    })

    validatedRules.push({
      ruleId: condition.ruleId,
      passed: result.conditionResult,
      executionTime: result.executionTime,
    })

    // Handle rule not found
    if (result.error === 'Rule not found') {
      if (condition.required) {
        errors.push({
          ruleId: condition.ruleId,
          message: getLocalizedMessage(condition, null, locale, `Business rule not found: ${condition.ruleId}`),
          code: 'RULE_NOT_FOUND',
        })
      }
      continue
    }

    // Handle disabled rule
    if (result.error === 'Rule is disabled') {
      if (condition.required) {
        errors.push({
          ruleId: condition.ruleId,
          message: getLocalizedMessage(condition, null, locale, `Business rule is disabled: ${result.ruleName}`),
          code: 'RULE_DISABLED',
        })
      }
      continue
    }

    // Handle other errors (not yet effective, expired, etc.)
    if (result.error && condition.required) {
      errors.push({
        ruleId: condition.ruleId,
        message: getLocalizedMessage(condition, null, locale, `Rule error: ${result.error}`),
        code: 'RULE_ERROR',
      })
      continue
    }

    // Handle condition failure
    if (!result.conditionResult && condition.required) {
      // Get localized message from condition or use default with rule name
      const message = getLocalizedMessage(
        condition,
        null,
        locale,
        `Pre-condition '${result.ruleName || condition.ruleId}' failed`
      )
      errors.push({
        ruleId: condition.ruleId,
        message,
        code: 'PRE_CONDITION_FAILED',
      })
    }
  }

  return {
    canStart: errors.length === 0,
    errors,
    validatedRules,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get localized message with fallback chain
 *
 * Priority:
 * 1. condition.validationMessage[locale]
 * 2. condition.validationMessage['en']
 * 3. rule.failureActions[BLOCK_TRANSITION].config.message
 * 4. rule.description
 * 5. defaultMessage
 */
function getLocalizedMessage(
  condition: StartPreCondition,
  rule: any | null,
  locale: string,
  defaultMessage: string
): string {
  // Priority 1: Localized message in condition definition (requested locale)
  if (condition.validationMessage?.[locale]) {
    return condition.validationMessage[locale]
  }

  // Priority 2: English fallback in condition
  if (condition.validationMessage?.['en']) {
    return condition.validationMessage['en']
  }

  if (rule) {
    // Priority 3: Message from rule's failureActions
    if (rule.failureActions && Array.isArray(rule.failureActions)) {
      const blockAction = rule.failureActions.find(
        (a: any) => a.type === 'BLOCK_TRANSITION'
      )
      if (blockAction?.config?.message) {
        return blockAction.config.message
      }
    }

    // Priority 4: Rule description
    if (rule.description) {
      return rule.description
    }
  }

  // Priority 5: Default message
  return defaultMessage
}

/**
 * Find workflow definition by ID and optional version
 */
async function findWorkflowDefinition(
  em: EntityManager,
  options: {
    workflowId: string
    version?: number
    tenantId: string
    organizationId: string
  }
): Promise<WorkflowDefinition | null> {
  const { workflowId, version, tenantId, organizationId } = options

  const where: any = {
    workflowId,
    tenantId,
    organizationId,
    deletedAt: null,
  }

  if (version !== undefined) {
    where.version = version
  }

  // If no version specified, get latest enabled version
  if (version === undefined) {
    where.enabled = true
    return em.findOne(WorkflowDefinition, where, {
      orderBy: { version: 'DESC' },
    })
  }

  return em.findOne(WorkflowDefinition, where)
}
