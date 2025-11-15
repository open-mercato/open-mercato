import type { EvaluationContext } from './expression-evaluator'
import { getNestedValue, resolveSpecialValue } from './value-resolver'

/**
 * Action definition
 */
export interface Action {
  type: string
  config?: Record<string, any>
}

/**
 * Action execution context
 */
export interface ActionContext extends EvaluationContext {
  entityType?: string
  entityId?: string
  eventType?: string
  data?: any
  ruleId?: string
  ruleName?: string
  [key: string]: any
}

/**
 * Specific action result types
 */
export interface AllowTransitionResult {
  type: 'ALLOW_TRANSITION'
  allowed: true
  message: string
}

export interface BlockTransitionResult {
  type: 'BLOCK_TRANSITION'
  allowed: false
  message: string
}

export interface LogResult {
  type: 'LOG'
  level: string
  message: string
  timestamp: string
}

export interface ShowErrorResult {
  type: 'SHOW_ERROR'
  severity: 'error'
  message: string
}

export interface ShowWarningResult {
  type: 'SHOW_WARNING'
  severity: 'warning'
  message: string
}

export interface ShowInfoResult {
  type: 'SHOW_INFO'
  severity: 'info'
  message: string
}

export interface NotifyResult {
  type: 'NOTIFY'
  recipients: string[]
  subject: string
  message: string
  template?: string
}

export interface SetFieldResult {
  type: 'SET_FIELD'
  field: string
  value: any
}

export interface CallWebhookResult {
  type: 'CALL_WEBHOOK'
  url: string
  method: string
  headers: Record<string, any>
  body?: any
  status: 'pending'
}

export interface EmitEventResult {
  type: 'EMIT_EVENT'
  event: string
  payload: Record<string, any>
}

/**
 * Union type of all action results
 */
export type ActionHandlerResult =
  | AllowTransitionResult
  | BlockTransitionResult
  | LogResult
  | ShowErrorResult
  | ShowWarningResult
  | ShowInfoResult
  | NotifyResult
  | SetFieldResult
  | CallWebhookResult
  | EmitEventResult

/**
 * Action execution result
 */
export interface ActionResult {
  action: Action
  success: boolean
  result?: ActionHandlerResult
  error?: string
  executionTime: number
}

/**
 * Action execution outcome (aggregated results)
 */
export interface ActionExecutionOutcome {
  success: boolean
  results: ActionResult[]
  totalTime: number
  errors?: string[]
}

/**
 * Execute multiple actions in sequence
 */
export async function executeActions(
  actions: Action[],
  context: ActionContext
): Promise<ActionExecutionOutcome> {
  const startTime = Date.now()
  const results: ActionResult[] = []
  const errors: string[] = []

  for (const action of actions) {
    try {
      const result = await executeAction(action, context)
      results.push(result)

      if (result.error) {
        errors.push(`Action ${action.type}: ${result.error}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errors.push(`Action ${action.type}: ${errorMessage}`)

      results.push({
        action,
        success: false,
        error: errorMessage,
        executionTime: 0,
      })
    }
  }

  const totalTime = Date.now() - startTime

  return {
    success: results.every((r) => r.success),
    results,
    totalTime,
    errors: errors.length > 0 ? errors : undefined,
  }
}

/**
 * Execute a single action
 */
export async function executeAction(action: Action, context: ActionContext): Promise<ActionResult> {
  const startTime = Date.now()

  try {
    const handler = getActionHandler(action.type)
    const result = await handler(action, context)

    const executionTime = Date.now() - startTime

    return {
      action,
      success: true,
      result,
      executionTime,
    }
  } catch (error) {
    const executionTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      action,
      success: false,
      error: errorMessage,
      executionTime,
    }
  }
}

/**
 * Action handler function type
 */
type ActionHandler = (action: Action, context: ActionContext) => Promise<ActionHandlerResult>

/**
 * Get action handler by type
 */
function getActionHandler(actionType: string): ActionHandler {
  const handlers: Record<string, ActionHandler> = {
    ALLOW_TRANSITION: handleAllowTransition,
    BLOCK_TRANSITION: handleBlockTransition,
    LOG: handleLog,
    SHOW_ERROR: handleShowError,
    SHOW_WARNING: handleShowWarning,
    SHOW_INFO: handleShowInfo,
    NOTIFY: handleNotify,
    SET_FIELD: handleSetField,
    CALL_WEBHOOK: handleCallWebhook,
    EMIT_EVENT: handleEmitEvent,
  }

  const handler = handlers[actionType]

  if (!handler) {
    throw new Error(`Unknown action type: ${actionType}`)
  }

  return handler
}

/**
 * ALLOW_TRANSITION action handler
 */
async function handleAllowTransition(
  action: Action,
  context: ActionContext
): Promise<AllowTransitionResult> {
  return {
    type: 'ALLOW_TRANSITION',
    allowed: true,
    message: interpolateMessage(action.config?.message || 'Transition allowed', context),
  }
}

/**
 * BLOCK_TRANSITION action handler
 */
async function handleBlockTransition(
  action: Action,
  context: ActionContext
): Promise<BlockTransitionResult> {
  return {
    type: 'BLOCK_TRANSITION',
    allowed: false,
    message: interpolateMessage(action.config?.message || 'Transition blocked', context),
  }
}

/**
 * LOG action handler
 */
async function handleLog(action: Action, context: ActionContext): Promise<LogResult> {
  const level = action.config?.level || 'info'
  const message = interpolateMessage(action.config?.message || '', context)

  return {
    type: 'LOG',
    level,
    message,
    timestamp: new Date().toISOString(),
  }
}

/**
 * SHOW_ERROR action handler
 */
async function handleShowError(action: Action, context: ActionContext): Promise<ShowErrorResult> {
  const message = interpolateMessage(action.config?.message || '', context)

  return {
    type: 'SHOW_ERROR',
    severity: 'error',
    message,
  }
}

/**
 * SHOW_WARNING action handler
 */
async function handleShowWarning(
  action: Action,
  context: ActionContext
): Promise<ShowWarningResult> {
  const message = interpolateMessage(action.config?.message || '', context)

  return {
    type: 'SHOW_WARNING',
    severity: 'warning',
    message,
  }
}

/**
 * SHOW_INFO action handler
 */
async function handleShowInfo(action: Action, context: ActionContext): Promise<ShowInfoResult> {
  const message = interpolateMessage(action.config?.message || '', context)

  return {
    type: 'SHOW_INFO',
    severity: 'info',
    message,
  }
}

/**
 * NOTIFY action handler
 */
async function handleNotify(action: Action, context: ActionContext): Promise<NotifyResult> {
  const recipients = action.config?.recipients || []
  const message = interpolateMessage(action.config?.message || '', context)
  const subject = interpolateMessage(action.config?.subject || '', context)
  const template = action.config?.template

  if (!Array.isArray(recipients)) {
    throw new Error('NOTIFY action requires recipients to be an array')
  }

  if (recipients.length === 0) {
    throw new Error('NOTIFY action requires at least one recipient')
  }

  return {
    type: 'NOTIFY',
    recipients,
    subject,
    message,
    template,
  }
}

/**
 * SET_FIELD action handler
 */
async function handleSetField(action: Action, context: ActionContext): Promise<SetFieldResult> {
  const field = action.config?.field
  const value = resolveValue(action.config?.value, context)

  if (!field) {
    throw new Error('SET_FIELD action requires a field name')
  }

  if (typeof field !== 'string' || field.trim() === '') {
    throw new Error('SET_FIELD action requires a non-empty field name')
  }

  return {
    type: 'SET_FIELD',
    field,
    value,
  }
}

/**
 * CALL_WEBHOOK action handler
 */
async function handleCallWebhook(
  action: Action,
  context: ActionContext
): Promise<CallWebhookResult> {
  const url = interpolateMessage(action.config?.url || '', context)
  const method = action.config?.method || 'POST'
  const headers = action.config?.headers || {}
  const body = action.config?.body

  if (!url || url.trim() === '') {
    throw new Error('CALL_WEBHOOK action requires a non-empty URL')
  }

  const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  if (!validMethods.includes(method.toUpperCase())) {
    throw new Error(
      `CALL_WEBHOOK action requires a valid HTTP method (${validMethods.join(', ')})`
    )
  }

  return {
    type: 'CALL_WEBHOOK',
    url,
    method: method.toUpperCase(),
    headers,
    body,
    status: 'pending',
  }
}

/**
 * EMIT_EVENT action handler
 */
async function handleEmitEvent(action: Action, context: ActionContext): Promise<EmitEventResult> {
  const eventName = action.config?.event
  const payload = action.config?.payload || {}

  if (!eventName) {
    throw new Error('EMIT_EVENT action requires an event name')
  }

  if (typeof eventName !== 'string' || eventName.trim() === '') {
    throw new Error('EMIT_EVENT action requires a non-empty event name')
  }

  return {
    type: 'EMIT_EVENT',
    event: eventName,
    payload,
  }
}

/**
 * Interpolate message template with context values
 * Supports {{field}} syntax for variable substitution
 */
export function interpolateMessage(template: string, context: ActionContext): string {
  if (!template) {
    return ''
  }

  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim()
    const value = resolveValue(`{{${trimmedPath}}}`, context)

    if (value === undefined || value === null) {
      return match
    }

    return String(value)
  })
}

/**
 * Resolve a value from context (supports special values like {{today}}, {{user.id}}, etc.)
 */
function resolveValue(value: any, context: ActionContext): any {
  if (typeof value !== 'string') {
    return value
  }

  if (value.startsWith('{{') && value.endsWith('}}')) {
    return resolveSpecialValue(value, context)
  }

  return value
}
