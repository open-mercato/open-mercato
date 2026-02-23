/**
 * AI Tools definitions for the Business Rules module.
 *
 * These tool definitions are discovered by the ai-assistant module's generator
 * and registered as MCP tools. The business_rules module does not depend on ai-assistant.
 *
 * Tools:
 * - business_rules_get_form_state: Read the current form state from chat context
 * - business_rules_suggest_conditions: Generate and validate a condition expression
 * - business_rules_suggest_actions: Generate and validate an actions array
 * - business_rules_validate: Validate a condition expression and/or actions
 * - business_rules_dsl_reference: Return DSL documentation
 */

import { z } from 'zod'
import {
  validateConditionExpressionForApi,
  validateActionsForApi,
  isSafeExpression,
  validateRulePayload,
} from './lib/payload-validation'
import { isGroupCondition } from './components/utils/conditionValidation'
import { getDslReference } from './lib/dsl-reference'
import type { DslReferenceTopic } from './lib/dsl-reference'

/**
 * Tool context provided by the MCP server at execution time.
 * Local type alias to avoid depending on @open-mercato/ai-assistant.
 */
type ToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: {
    resolve: <T = unknown>(name: string) => T
  }
  userFeatures: string[]
  isSuperAdmin: boolean
  formState?: Record<string, unknown>
}

/**
 * Tool definition structure.
 */
type AiToolDefinition = {
  name: string
  description: string
  inputSchema: z.ZodType<any>
  requiredFeatures?: string[]
  handler: (input: any, ctx: ToolContext) => Promise<unknown>
}

// =============================================================================
// business_rules_get_form_state
// =============================================================================

const getFormStateTool: AiToolDefinition = {
  name: 'business_rules_get_form_state',
  description: `Read the current business rule form state from the page the user has open.

Returns the current values of the condition expression, success actions, failure actions,
and metadata (rule type, entity type, etc.) from the business rule create/edit form.

Use this FIRST before suggesting any changes, so you understand what the user has already configured.

Returns { error: 'no_form_state' } if no business rule form is currently open.`,
  inputSchema: z.object({}),
  requiredFeatures: ['business_rules.view'],
  handler: async (_input, ctx) => {
    const formState = ctx.formState
    if (!formState || formState.formType !== 'business_rules') {
      return {
        error: 'no_form_state',
        message: 'No business rule form is currently open.',
      }
    }

    // Return the form state as-is — contains formType, conditionExpression,
    // successActions, failureActions, and any metadata the page provides
    return formState
  },
}

// =============================================================================
// business_rules_suggest_conditions
// =============================================================================

const suggestConditionsTool: AiToolDefinition = {
  name: 'business_rules_suggest_conditions',
  description: `Generate a validated condition expression for a business rule based on a natural language description.

The condition expression is a recursive tree of AND/OR/NOT groups containing simple conditions.
Each simple condition compares a field path against a value using one of 16 comparison operators.

Call business_rules_dsl_reference first if you need to know the available operators, template variables, or limits.

The generated condition is validated server-side before being returned. If validation fails,
you'll get an error with details — fix the issue and try again.

The result is returned as a form-suggestion that the user can preview and accept/reject in the UI.

Modes:
- replace: Replace the entire condition expression
- append: Add new conditions to the existing root group (wraps in AND if needed)
- modify: Modify specific parts of the existing expression`,
  inputSchema: z.object({
    description: z.string().min(1).describe('Natural language description of the conditions to generate'),
    conditionExpression: z.any().optional().describe('The proposed condition expression (GroupCondition or SimpleCondition JSON)'),
    mode: z.enum(['replace', 'append', 'modify']).default('replace').describe('How to apply the suggestion: replace, append, or modify'),
  }),
  requiredFeatures: ['business_rules.manage'],
  handler: async (input, _ctx) => {
    const { mode } = input
    // AI agents often pass nested JSON as a string — auto-parse it
    let conditionExpression = input.conditionExpression
    if (typeof conditionExpression === 'string') {
      try {
        conditionExpression = JSON.parse(conditionExpression)
      } catch {
        return {
          error: 'validation_failed',
          details: ['conditionExpression must be a JSON object, not a string. Do not stringify it — pass the object directly.'],
        }
      }
    }

    if (!conditionExpression) {
      return {
        error: 'missing_expression',
        message: 'You must provide a conditionExpression JSON object. Use business_rules_dsl_reference to learn the syntax, then construct the expression and pass it here for validation.',
      }
    }

    // Safety check
    if (!isSafeExpression(conditionExpression)) {
      return {
        error: 'validation_failed',
        details: ['Condition expression exceeds safety limits (max depth: 10, max rules per group: 50, max field path length: 200)'],
      }
    }

    // Structural validation
    const result = validateConditionExpressionForApi(conditionExpression)
    if (!result.valid) {
      return {
        error: 'validation_failed',
        details: result.errors ?? [result.error ?? 'Invalid condition expression'],
      }
    }

    // Normalize to GroupCondition — ConditionBuilder always expects a group at root level
    if (!isGroupCondition(conditionExpression)) {
      console.warn('[business_rules:suggest_conditions] Normalizing SimpleCondition to GroupCondition wrapper')
      conditionExpression = {
        operator: 'AND',
        rules: [conditionExpression],
      }
    }

    return {
      type: 'form-suggestion',
      sections: [{
        sectionId: 'conditionExpression',
        value: conditionExpression,
        explanation: input.description,
        mode,
      }],
    }
  },
}

// =============================================================================
// business_rules_suggest_actions
// =============================================================================

const suggestActionsTool: AiToolDefinition = {
  name: 'business_rules_suggest_actions',
  description: `Generate a validated array of actions for a business rule based on a natural language description.

10 action types are available: ALLOW_TRANSITION, BLOCK_TRANSITION, LOG, SHOW_ERROR,
SHOW_WARNING, SHOW_INFO, NOTIFY, SET_FIELD, CALL_WEBHOOK, EMIT_EVENT.

Each action has a type and an optional config object with type-specific fields.
Action config messages support {{template}} interpolation (e.g., {{user.email}}, {{data.order.total}}).

Call business_rules_dsl_reference with topic='actions' for full details on each action type.

The result is returned as a form-suggestion that the user can preview and accept/reject in the UI.

Modes:
- replace: Replace all actions in the target section
- append: Add new actions to the existing array`,
  inputSchema: z.object({
    description: z.string().min(1).describe('Natural language description of the actions to generate'),
    actions: z.array(z.object({
      type: z.string().min(1),
      config: z.record(z.string(), z.any()).optional(),
    })).optional().describe('The proposed actions array'),
    actionTarget: z.enum(['success', 'failure']).describe('Which action list to target: success or failure'),
    mode: z.enum(['replace', 'append']).default('replace').describe('How to apply: replace all or append'),
  }),
  requiredFeatures: ['business_rules.manage'],
  handler: async (input, _ctx) => {
    const { actions, actionTarget, mode } = input

    if (!actions || actions.length === 0) {
      return {
        error: 'missing_actions',
        message: 'You must provide an actions array. Use business_rules_dsl_reference with topic="actions" to learn the available action types and their config fields.',
      }
    }

    const fieldName = actionTarget === 'success' ? 'successActions' : 'failureActions'
    const result = validateActionsForApi(actions, fieldName)
    if (!result.valid) {
      return {
        error: 'validation_failed',
        details: result.errors ?? [result.error ?? 'Invalid actions'],
      }
    }

    const sectionId = actionTarget === 'success' ? 'successActions' : 'failureActions'

    return {
      type: 'form-suggestion',
      sections: [{
        sectionId,
        value: actions,
        explanation: input.description,
        mode,
      }],
    }
  },
}

// =============================================================================
// business_rules_validate
// =============================================================================

const validateTool: AiToolDefinition = {
  name: 'business_rules_validate',
  description: `Validate a condition expression and/or actions array without generating a form suggestion.

Use this to check if a hand-built or AI-generated condition/action structure is valid
before presenting it to the user. Returns { valid: true } or { valid: false, errors: [...] }.`,
  inputSchema: z.object({
    conditionExpression: z.any().optional().describe('Condition expression to validate (GroupCondition or SimpleCondition)'),
    successActions: z.array(z.object({
      type: z.string().min(1),
      config: z.record(z.string(), z.any()).optional(),
    })).optional().describe('Success actions array to validate'),
    failureActions: z.array(z.object({
      type: z.string().min(1),
      config: z.record(z.string(), z.any()).optional(),
    })).optional().describe('Failure actions array to validate'),
  }),
  requiredFeatures: ['business_rules.view'],
  handler: async (input, _ctx) => {
    const errors: string[] = []

    // AI agents often pass nested JSON as a string — auto-parse
    let conditionExpression = input.conditionExpression
    if (typeof conditionExpression === 'string') {
      try {
        conditionExpression = JSON.parse(conditionExpression)
      } catch {
        errors.push('conditionExpression must be a JSON object, not a string')
      }
    }

    // Safety check on condition expression
    if (conditionExpression && !isSafeExpression(conditionExpression)) {
      errors.push('Condition expression exceeds safety limits (max depth: 10, max rules per group: 50, max field path length: 200)')
    }

    // Use the combined validator
    const result = validateRulePayload({
      conditionExpression,
      successActions: input.successActions,
      failureActions: input.failureActions,
    })

    if (!result.valid && result.errors) {
      errors.push(...result.errors)
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  },
}

// =============================================================================
// business_rules_dsl_reference
// =============================================================================

const dslReferenceTool: AiToolDefinition = {
  name: 'business_rules_dsl_reference',
  description: `Get structured documentation for the business rules DSL.

Topics:
- operators: All 16 comparison operators and 3 logical operators with examples
- templates: Template variables ({{today}}, {{user.id}}, etc.) and interpolation syntax
- actions: All 10 action types with required/optional config fields and examples
- limits: Maximum nesting depth, rules per group, field path length, etc.
- examples: Complete example rules (condition + actions) for common scenarios
- all: Everything above combined

Call this before generating conditions or actions to ensure you use correct syntax.`,
  inputSchema: z.object({
    topic: z.enum(['operators', 'templates', 'actions', 'limits', 'examples', 'all'])
      .optional()
      .default('all')
      .describe('Which topic to return documentation for'),
  }),
  requiredFeatures: ['business_rules.view'],
  handler: async (input, _ctx) => {
    return getDslReference(input.topic as DslReferenceTopic)
  },
}

// =============================================================================
// Export
// =============================================================================

/**
 * All AI tools exported by the business_rules module.
 * Discovered by ai-assistant module's generator.
 */
export const aiTools = [
  getFormStateTool,
  suggestConditionsTool,
  suggestActionsTool,
  validateTool,
  dslReferenceTool,
]

export default aiTools
