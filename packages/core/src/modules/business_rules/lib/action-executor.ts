import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { EvaluationContext } from './expression-evaluator'
import { getNestedValue, resolveSpecialValue } from './value-resolver'
import {
  findOpenMercatoEndpointOption,
  getCurrentOpenMercatoEndpointOptions,
  resolveOpenMercatoApiKeyProfile,
} from './openmercato-call-options'
import type { OpenMercatoEndpointOption } from './openmercato-call-options-types'

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
  tenantId?: string
  organizationId?: string
  executedBy?: string | null
  em?: PostgreSqlEntityManager
  openMercatoEndpointOptions?: OpenMercatoEndpointOption[]
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

export interface CallOpenMercatoResult {
  type: 'CALL_OPEN_MERCATO'
  endpoint: string
  method: string
  apiKeyId: string
  status: number
  statusText: string
  body: any
  authenticated: true
  tenantId: string
  organizationId: string
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
  | CallOpenMercatoResult
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
    CALL_OPEN_MERCATO: handleCallOpenMercato,
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
 * CALL_OPEN_MERCATO action handler
 */
async function handleCallOpenMercato(
  action: Action,
  context: ActionContext
): Promise<CallOpenMercatoResult> {
  const endpoint = String(action.config?.endpoint ?? '').trim()
  const method = String(action.config?.method ?? '').trim().toUpperCase()
  const apiKeyId = String(action.config?.apiKeyId ?? '').trim()

  if (!endpoint) {
    throw new Error('CALL_OPEN_MERCATO action requires an endpoint')
  }
  if (!method) {
    throw new Error('CALL_OPEN_MERCATO action requires an HTTP method')
  }
  if (!apiKeyId) {
    throw new Error('CALL_OPEN_MERCATO action requires an API key profile')
  }

  const endpointOptions = context.openMercatoEndpointOptions ?? await getCurrentOpenMercatoEndpointOptions()
  const endpointOption = findOpenMercatoEndpointOption(
    endpoint,
    method,
    endpointOptions,
  )
  if (!endpointOption) {
    throw new Error('CALL_OPEN_MERCATO action requires a currently available /api/* endpoint')
  }

  const em = context.em
  if (!em) {
    throw new Error('CALL_OPEN_MERCATO action requires an EntityManager in action context')
  }

  const tenantId = context.tenantId ?? context.tenant?.id
  const organizationId = context.organizationId ?? context.organization?.id
  if (!tenantId || !organizationId) {
    throw new Error('CALL_OPEN_MERCATO action requires tenant and organization context')
  }

  const apiKeyProfile = await resolveOpenMercatoApiKeyProfile(em, apiKeyId, {
    tenantId,
    organizationId,
  })
  if (!apiKeyProfile) {
    throw new Error('CALL_OPEN_MERCATO action requires an active API key profile in scope')
  }

  const roleIds = Array.isArray(apiKeyProfile.rolesJson)
    ? apiKeyProfile.rolesJson.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
    : []
  if (roleIds.length === 0) {
    throw new Error('CALL_OPEN_MERCATO action requires an API key profile with at least one role')
  }

  const { withOnetimeApiKey } = await import('../../api_keys/services/apiKeyService')
  const fullUrl = buildOpenMercatoApiUrl(endpointOption.path)
  const requestBody = method === 'GET'
    ? undefined
    : normalizeOpenMercatoRequestBody(action.config?.body, context)

  return await withOnetimeApiKey(
    em,
    {
      name: `__business_rule_${context.ruleId || 'unknown'}__`,
      description: `One-time key for business rule ${context.ruleId || 'unknown'}`,
      tenantId,
      organizationId,
      roles: roleIds,
      createdBy: context.executedBy ?? context.user?.id ?? null,
      expiresAt: null,
    },
    async (apiKeySecret) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `apikey ${apiKeySecret}`,
        'X-Tenant-Id': tenantId,
        'X-Organization-Id': organizationId,
      }
      if (context.ruleId) headers['X-Business-Rule-Id'] = context.ruleId
      if (context.ruleName) headers['X-Business-Rule-Name'] = context.ruleName
      if (context.entityType) headers['X-Business-Rule-Entity-Type'] = context.entityType
      if (context.entityId) headers['X-Business-Rule-Entity-Id'] = context.entityId

      const response = await fetch(fullUrl, {
        method,
        headers,
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      })

      const responseBody = await parseOpenMercatoResponseBody(response)
      if (!response.ok) {
        throwOpenMercatoResponseError(response.status, responseBody)
      }

      return {
        type: 'CALL_OPEN_MERCATO',
        endpoint: endpointOption.path,
        method,
        apiKeyId,
        status: response.status,
        statusText: response.statusText,
        body: responseBody,
        authenticated: true,
        tenantId,
        organizationId,
      }
    },
  )
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

function buildOpenMercatoApiUrl(endpoint: string): string {
  if (!endpoint.startsWith('/api/')) {
    throw new Error(`CALL_OPEN_MERCATO only supports /api/* paths, got: ${endpoint}`)
  }
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${appUrl}${endpoint}`
}

function normalizeOpenMercatoRequestBody(value: any, context: ActionContext): any {
  if (value === undefined || value === null || value === '') return undefined
  const interpolated = interpolateActionValue(value, context)
  if (typeof interpolated !== 'string') return interpolated

  const trimmed = interpolated.trim()
  if (!trimmed) return undefined

  try {
    return JSON.parse(trimmed)
  } catch {
    return interpolated
  }
}

function interpolateActionValue(value: any, context: ActionContext): any {
  if (typeof value === 'string') {
    return interpolateMessage(value, context)
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateActionValue(item, context))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, interpolateActionValue(entry, context)]),
    )
  }
  return value
}

async function parseOpenMercatoResponseBody(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type')
  try {
    if (contentType && contentType.includes('application/json')) {
      return await response.json()
    }
    return await response.text()
  } catch {
    return null
  }
}

function throwOpenMercatoResponseError(status: number, body: any): never {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  if (status >= 400 && status < 500) {
    throw new Error(`CALL_OPEN_MERCATO request failed with status ${status}: ${bodyText}`)
  }

  const error: any = new Error(`CALL_OPEN_MERCATO request failed with status ${status}: ${bodyText}`)
  if (status >= 500) {
    error.retriable = true
  }
  throw error
}
