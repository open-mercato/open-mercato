/**
 * Structured DSL reference for AI-assisted business rule editing.
 *
 * Provides complete documentation of operators, template variables,
 * action types, limits, and examples in a machine-readable format
 * consumed by the business_rules_dsl_reference MCP tool.
 */

export type DslReferenceTopic = 'operators' | 'templates' | 'actions' | 'limits' | 'examples' | 'all'

interface OperatorDoc {
  operator: string
  description: string
  valueType: string
  example: { field: string; operator: string; value: unknown }
}

interface TemplateDoc {
  template: string
  description: string
  resolvedType: string
  example: string
}

interface ActionTypeDoc {
  type: string
  description: string
  requiredConfig: string[]
  optionalConfig: string[]
  example: { type: string; config: Record<string, unknown> }
}

interface LimitDoc {
  name: string
  value: number
  description: string
}

interface ExampleDoc {
  name: string
  description: string
  conditionExpression: unknown
  successActions?: unknown[]
  failureActions?: unknown[]
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

const comparisonOperators: OperatorDoc[] = [
  { operator: '=', description: 'Equal (with type coercion for numbers)', valueType: 'any', example: { field: 'order.status', operator: '=', value: 'completed' } },
  { operator: '==', description: 'Strict equality (same as =)', valueType: 'any', example: { field: 'order.status', operator: '==', value: 'completed' } },
  { operator: '!=', description: 'Not equal', valueType: 'any', example: { field: 'order.status', operator: '!=', value: 'cancelled' } },
  { operator: '>', description: 'Greater than (numeric/date)', valueType: 'number | string', example: { field: 'order.total', operator: '>', value: 10000 } },
  { operator: '>=', description: 'Greater than or equal', valueType: 'number | string', example: { field: 'order.total', operator: '>=', value: 5000 } },
  { operator: '<', description: 'Less than (numeric/date)', valueType: 'number | string', example: { field: 'order.quantity', operator: '<', value: 1 } },
  { operator: '<=', description: 'Less than or equal', valueType: 'number | string', example: { field: 'order.discount', operator: '<=', value: 50 } },
  { operator: 'IN', description: 'Value is in array', valueType: 'array', example: { field: 'customer.tier', operator: 'IN', value: ['gold', 'platinum'] } },
  { operator: 'NOT_IN', description: 'Value is not in array', valueType: 'array', example: { field: 'order.status', operator: 'NOT_IN', value: ['draft', 'cancelled'] } },
  { operator: 'CONTAINS', description: 'Array/string contains value', valueType: 'string', example: { field: 'order.tags', operator: 'CONTAINS', value: 'urgent' } },
  { operator: 'NOT_CONTAINS', description: 'Array/string does not contain value', valueType: 'string', example: { field: 'order.notes', operator: 'NOT_CONTAINS', value: 'test' } },
  { operator: 'STARTS_WITH', description: 'String starts with', valueType: 'string', example: { field: 'customer.name', operator: 'STARTS_WITH', value: 'Corp' } },
  { operator: 'ENDS_WITH', description: 'String ends with', valueType: 'string', example: { field: 'customer.email', operator: 'ENDS_WITH', value: '@example.com' } },
  { operator: 'MATCHES', description: 'Regex match (max 200 chars, 100ms timeout)', valueType: 'string (regex)', example: { field: 'customer.phone', operator: 'MATCHES', value: '^\\+1\\d{10}$' } },
  { operator: 'IS_EMPTY', description: 'Null, undefined, empty string, empty array, or empty object', valueType: 'ignored', example: { field: 'order.notes', operator: 'IS_EMPTY', value: null } },
  { operator: 'IS_NOT_EMPTY', description: 'Not empty (opposite of IS_EMPTY)', valueType: 'ignored', example: { field: 'customer.email', operator: 'IS_NOT_EMPTY', value: null } },
]

const logicalOperators = [
  { operator: 'AND', description: 'All child rules must be true', maxRules: 50 },
  { operator: 'OR', description: 'At least one child rule must be true', maxRules: 50 },
  { operator: 'NOT', description: 'Inverts the result of child rules (all must be true, then negated)', maxRules: 50 },
]

// ---------------------------------------------------------------------------
// Template Variables
// ---------------------------------------------------------------------------

const templateVariables: TemplateDoc[] = [
  { template: '{{today}}', description: 'Current date', resolvedType: 'string (YYYY-MM-DD)', example: '2026-02-12' },
  { template: '{{now}}', description: 'Current timestamp', resolvedType: 'string (ISO 8601)', example: '2026-02-12T14:30:00.000Z' },
  { template: '{{user.id}}', description: 'Current user ID', resolvedType: 'string', example: 'usr_abc123' },
  { template: '{{user.email}}', description: 'Current user email', resolvedType: 'string', example: 'john@example.com' },
  { template: '{{user.role}}', description: 'Current user role', resolvedType: 'string', example: 'admin' },
  { template: '{{tenant.id}}', description: 'Current tenant ID', resolvedType: 'string (UUID)', example: '550e8400-e29b-41d4-a716-446655440000' },
  { template: '{{organization.id}}', description: 'Current organization ID', resolvedType: 'string (UUID)', example: '660e8400-e29b-41d4-a716-446655440001' },
  { template: '{{<any.path>}}', description: 'Resolve any value from the evaluation context via dot notation', resolvedType: 'any', example: '{{data.order.customer.tier}}' },
]

// ---------------------------------------------------------------------------
// Action Types
// ---------------------------------------------------------------------------

const actionTypes: ActionTypeDoc[] = [
  {
    type: 'ALLOW_TRANSITION',
    description: 'Explicitly allow a state transition. Used with GUARD rules to permit an operation.',
    requiredConfig: [],
    optionalConfig: ['message'],
    example: { type: 'ALLOW_TRANSITION', config: { message: 'Order approved for processing' } },
  },
  {
    type: 'BLOCK_TRANSITION',
    description: 'Block a state transition. Used with GUARD rules to prevent an operation.',
    requiredConfig: [],
    optionalConfig: ['message'],
    example: { type: 'BLOCK_TRANSITION', config: { message: 'Order total exceeds credit limit' } },
  },
  {
    type: 'LOG',
    description: 'Write a log message. Supports template interpolation in the message.',
    requiredConfig: ['message'],
    optionalConfig: ['level'],
    example: { type: 'LOG', config: { message: 'Rule triggered for order {{data.orderId}}', level: 'info' } },
  },
  {
    type: 'SHOW_ERROR',
    description: 'Display an error message to the user.',
    requiredConfig: ['message'],
    optionalConfig: [],
    example: { type: 'SHOW_ERROR', config: { message: 'Cannot proceed: order total exceeds $10,000 limit' } },
  },
  {
    type: 'SHOW_WARNING',
    description: 'Display a warning message to the user.',
    requiredConfig: ['message'],
    optionalConfig: [],
    example: { type: 'SHOW_WARNING', config: { message: 'Customer credit score is below threshold' } },
  },
  {
    type: 'SHOW_INFO',
    description: 'Display an informational message to the user.',
    requiredConfig: ['message'],
    optionalConfig: [],
    example: { type: 'SHOW_INFO', config: { message: 'Discount automatically applied for VIP customer' } },
  },
  {
    type: 'NOTIFY',
    description: 'Send a notification to specified recipients.',
    requiredConfig: ['message', 'recipients'],
    optionalConfig: ['template', 'subject'],
    example: { type: 'NOTIFY', config: { message: 'Large order from {{user.email}}', recipients: ['compliance@company.com'], subject: 'Large Order Alert' } },
  },
  {
    type: 'SET_FIELD',
    description: 'Set a field value on the entity being processed.',
    requiredConfig: ['field', 'value'],
    optionalConfig: [],
    example: { type: 'SET_FIELD', config: { field: 'requiresApproval', value: true } },
  },
  {
    type: 'CALL_WEBHOOK',
    description: 'Send an HTTP request to an external URL.',
    requiredConfig: ['url'],
    optionalConfig: ['method', 'headers', 'body'],
    example: { type: 'CALL_WEBHOOK', config: { url: 'https://api.example.com/notify', method: 'POST', body: { orderId: '{{data.orderId}}' } } },
  },
  {
    type: 'EMIT_EVENT',
    description: 'Emit an event on the event bus for other modules to react to.',
    requiredConfig: ['eventName'],
    optionalConfig: ['payload'],
    example: { type: 'EMIT_EVENT', config: { eventName: 'order.flagged', payload: { reason: 'high_value' } } },
  },
]

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const limits: LimitDoc[] = [
  { name: 'maxNestingDepth', value: 10, description: 'Maximum nesting depth for condition groups (safety check)' },
  { name: 'maxValidationDepth', value: 5, description: 'Maximum nesting depth enforced during validation' },
  { name: 'maxRulesPerGroup', value: 50, description: 'Maximum number of rules in a single AND/OR/NOT group' },
  { name: 'maxFieldPathLength', value: 200, description: 'Maximum length of a field path (e.g., "order.items[0].quantity")' },
  { name: 'maxRegexLength', value: 200, description: 'Maximum length of a regex pattern in MATCHES operator' },
  { name: 'maxRulesPerExecution', value: 100, description: 'Maximum rules evaluated in a single execution batch' },
  { name: 'ruleIdMaxLength', value: 50, description: 'Maximum length of a rule identifier string' },
  { name: 'ruleNameMaxLength', value: 200, description: 'Maximum length of a rule name' },
  { name: 'descriptionMaxLength', value: 5000, description: 'Maximum length of a rule description' },
  { name: 'priorityRange', value: 9999, description: 'Priority range: 0 (lowest) to 9999 (highest)' },
]

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

const examples: ExampleDoc[] = [
  {
    name: 'Block high-value orders from non-VIP customers',
    description: 'GUARD rule that blocks orders over $10,000 unless the customer is VIP tier',
    conditionExpression: {
      operator: 'AND',
      rules: [
        { field: 'order.total', operator: '>', value: 10000 },
        { field: 'customer.tier', operator: 'NOT_IN', value: ['vip', 'platinum'] },
      ],
    },
    successActions: [
      { type: 'BLOCK_TRANSITION', config: { message: 'Orders over $10,000 require VIP or Platinum customer status' } },
      { type: 'NOTIFY', config: { message: 'Blocked order from {{user.email}} — total: {{data.order.total}}', recipients: ['compliance@company.com'], subject: 'High-Value Order Blocked' } },
    ],
  },
  {
    name: 'Auto-approve small orders',
    description: 'GUARD rule that automatically approves orders under $500',
    conditionExpression: {
      operator: 'AND',
      rules: [
        { field: 'order.total', operator: '<=', value: 500 },
        { field: 'order.status', operator: '=', value: 'pending' },
      ],
    },
    successActions: [
      { type: 'ALLOW_TRANSITION', config: { message: 'Auto-approved: order under $500' } },
      { type: 'SET_FIELD', config: { field: 'approvedBy', value: 'auto' } },
    ],
  },
  {
    name: 'Warn on missing customer email',
    description: 'VALIDATION rule that warns when a customer record has no email',
    conditionExpression: {
      field: 'customer.email', operator: 'IS_EMPTY', value: null,
    },
    successActions: [
      { type: 'SHOW_WARNING', config: { message: 'Customer has no email address — notifications will not be delivered' } },
    ],
  },
  {
    name: 'Complex nested conditions with OR',
    description: 'Rule using nested AND/OR groups to check multiple criteria',
    conditionExpression: {
      operator: 'OR',
      rules: [
        {
          operator: 'AND',
          rules: [
            { field: 'order.total', operator: '>', value: 5000 },
            { field: 'customer.country', operator: 'IN', value: ['US', 'CA'] },
          ],
        },
        {
          operator: 'AND',
          rules: [
            { field: 'order.total', operator: '>', value: 2000 },
            { field: 'customer.tier', operator: '=', value: 'enterprise' },
          ],
        },
      ],
    },
    successActions: [
      { type: 'LOG', config: { message: 'High-value order flagged for review', level: 'info' } },
    ],
  },
  {
    name: 'Field-to-field comparison',
    description: 'Compare two fields against each other using valueField',
    conditionExpression: {
      field: 'order.requestedQuantity',
      operator: '>',
      value: null,
      valueField: 'product.availableStock',
    },
    successActions: [
      { type: 'SHOW_ERROR', config: { message: 'Requested quantity exceeds available stock' } },
    ],
  },
  {
    name: 'Template values in conditions',
    description: 'Using template variables to compare against dynamic values',
    conditionExpression: {
      operator: 'AND',
      rules: [
        { field: 'order.createdBy', operator: '!=', value: '{{user.id}}' },
        { field: 'order.date', operator: '=', value: '{{today}}' },
      ],
    },
    successActions: [
      { type: 'SHOW_INFO', config: { message: "Viewing another user's order from today" } },
    ],
  },
]

// ---------------------------------------------------------------------------
// Condition structure reference
// ---------------------------------------------------------------------------

const conditionStructure = {
  simpleCondition: {
    description: 'A leaf condition that compares a field value against a static value or another field',
    shape: '{ field: string, operator: ComparisonOperator, value: any, valueField?: string }',
    notes: [
      'field: dot-notation path to resolve from the data payload (e.g., "order.total", "items[0].quantity")',
      'operator: one of the 16 comparison operators listed above',
      'value: static value to compare against, or a {{template}} string',
      'valueField: optional — if set, compares field against another field instead of value',
    ],
  },
  groupCondition: {
    description: 'A container that combines child conditions with AND, OR, or NOT logic',
    shape: '{ operator: "AND" | "OR" | "NOT", rules: ConditionExpression[] }',
    notes: [
      'AND: all child rules must evaluate to true',
      'OR: at least one child rule must evaluate to true',
      'NOT: inverts the result — all child rules must be true, then the result is negated',
      'rules: array of SimpleCondition or GroupCondition (recursive)',
      'A single SimpleCondition (without a group wrapper) is valid as the root expression',
    ],
  },
  ruleTypes: {
    GUARD: 'All GUARD rules must pass for an operation to proceed. Use successActions with ALLOW_TRANSITION or BLOCK_TRANSITION.',
    VALIDATION: 'Validates data and surfaces user-facing messages via SHOW_ERROR/SHOW_WARNING/SHOW_INFO.',
    CALCULATION: 'Performs calculations and sets field values via SET_FIELD.',
    ACTION: 'Triggers side effects like notifications (NOTIFY), webhooks (CALL_WEBHOOK), or events (EMIT_EVENT).',
    ASSIGNMENT: 'Assigns or transforms field values via SET_FIELD.',
  },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getDslReference(topic: DslReferenceTopic = 'all') {
  switch (topic) {
    case 'operators':
      return {
        topic: 'operators',
        comparisonOperators,
        logicalOperators,
        conditionStructure,
      }
    case 'templates':
      return {
        topic: 'templates',
        templateVariables,
        interpolation: {
          description: 'Template variables use {{...}} syntax. They are resolved in condition values and action config messages.',
          pattern: '{{path.to.value}}',
          unresolvedBehavior: 'Unresolved variables are left as-is (the original {{...}} string remains)',
        },
      }
    case 'actions':
      return {
        topic: 'actions',
        actionTypes,
        notes: [
          'Actions are executed in array order',
          'Each action has a type and an optional config object',
          'Config fields support {{template}} interpolation in string values',
          'successActions run when condition evaluates to true, failureActions when false',
        ],
      }
    case 'limits':
      return {
        topic: 'limits',
        limits,
        fieldPathRules: {
          validPattern: '^[a-zA-Z_][a-zA-Z0-9_.\\[\\]]*$',
          examples: ['order.total', 'customer.addresses[0].city', 'data.items[0].quantity'],
        },
      }
    case 'examples':
      return {
        topic: 'examples',
        examples,
      }
    case 'all':
      return {
        topic: 'all',
        comparisonOperators,
        logicalOperators,
        conditionStructure,
        templateVariables,
        interpolation: {
          description: 'Template variables use {{...}} syntax. They are resolved in condition values and action config messages.',
          pattern: '{{path.to.value}}',
          unresolvedBehavior: 'Unresolved variables are left as-is (the original {{...}} string remains)',
        },
        actionTypes,
        limits,
        fieldPathRules: {
          validPattern: '^[a-zA-Z_][a-zA-Z0-9_.\\[\\]]*$',
          examples: ['order.total', 'customer.addresses[0].city', 'data.items[0].quantity'],
        },
        examples,
      }
  }
}
