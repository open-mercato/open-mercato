import { randomUUID } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { AiToolDefinition, McpToolDefinition, ToolExecutionResult } from './types'

const logger = createLogger('ai_assistant').child({ component: 'mcp-audit' })

export const MCP_AUDIT_RESOURCE_KIND = 'ai_assistant.mcp_tool_call'
export const MCP_AUDIT_ACCESS_TYPE = 'call'
export const MCP_AUDIT_WRITE_TIMEOUT_MS = 500
export const CORRELATION_ID_HEADER = 'x-correlation-id'

const SESSION_TOKEN_ARG_KEY = '_sessionToken'
const CORRELATION_ID_MAX_LENGTH = 128
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

export type McpAuditChannel = 'mcp' | 'tools-api'

export type McpAuditServer = 'http' | 'dev' | 'stdio'

export type McpAuditPrincipal = 'session' | 'api_key'

export type McpAuditOutcome =
  | 'ok'
  | 'denied'
  | 'invalid_input'
  | 'error'
  | 'mutation_denied'
  | 'pending_approval'
  | 'dispatcher_unavailable'

export type McpToolCallAuditEntry = {
  toolName: string
  tenantId: string | null
  organizationId: string | null
  sessionUserId?: string | null
  apiKeySessionUserId?: string | null
  apiKeyCreatedBy?: string | null
  channel: McpAuditChannel
  mcpServer: McpAuditServer | null
  apiKeyId?: string | null
  sessionKeyId?: string | null
  principal: McpAuditPrincipal
  outcome: McpAuditOutcome
  errorCode?: string | null
  durationMs: number
  isMutation: boolean
  agentId?: string | null
  aiAgentRunId?: string | null
  agentRunId?: string | null
  pendingActionIds?: string[] | null
  correlationId: string
  args: unknown
}

export type McpAuditIdentity = {
  apiKeyId: string | null
  apiKeySessionUserId: string | null
  apiKeyCreatedBy: string | null
  sessionUserId: string | null
}

export const EMPTY_MCP_AUDIT_IDENTITY: McpAuditIdentity = {
  apiKeyId: null,
  apiKeySessionUserId: null,
  apiKeyCreatedBy: null,
  sessionUserId: null,
}

export type McpAuditAccessLogInput = {
  tenantId: string | null
  organizationId: string | null
  actorUserId: string | null
  resourceKind: string
  resourceId: string
  accessType: string
  context: Record<string, unknown>
}

type AccessLogWriter = {
  log(input: McpAuditAccessLogInput): Promise<unknown>
}

type ServiceResolver = {
  resolve<T>(name: string): T
}

const ERROR_CODE_OUTCOMES: Record<string, McpAuditOutcome> = {
  UNAUTHORIZED: 'denied',
  NOT_FOUND: 'denied',
  VALIDATION_ERROR: 'invalid_input',
  EXECUTION_ERROR: 'error',
  MUTATION_REQUIRES_APPROVAL: 'mutation_denied',
  DISPATCHER_UNAVAILABLE: 'dispatcher_unavailable',
}

export function extractArgKeys(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  return Object.keys(input).filter((key) => key !== SESSION_TOKEN_ARG_KEY)
}

export function resolveCorrelationId(headerValue: string | null | undefined): string {
  if (typeof headerValue !== 'string') return randomUUID()
  const candidate = headerValue.trim()
  if (
    candidate.length === 0 ||
    candidate.length > CORRELATION_ID_MAX_LENGTH ||
    !CORRELATION_ID_PATTERN.test(candidate)
  ) {
    return randomUUID()
  }
  return candidate
}

export function isMutationTool(tool: McpToolDefinition | undefined): boolean {
  return (tool as AiToolDefinition | undefined)?.isMutation === true
}

export function attachCorrelationMeta<T extends object>(
  result: T,
  correlationId: string,
): T & { _meta: { correlationId: string } } {
  return { ...result, _meta: { correlationId } }
}

export function mapToolResultToAuditOutcome(
  result: ToolExecutionResult & { pendingApproval?: unknown },
): McpAuditOutcome {
  if (result.pendingApproval) return 'pending_approval'
  if (result.success) return 'ok'
  const errorCode: string | undefined = result.errorCode
  if (!errorCode) return 'error'
  return ERROR_CODE_OUTCOMES[errorCode] ?? 'error'
}

export function resolveAuditActorUserId(
  entry: Pick<McpToolCallAuditEntry, 'sessionUserId' | 'apiKeySessionUserId' | 'apiKeyCreatedBy'>,
): string | null {
  return entry.sessionUserId ?? entry.apiKeySessionUserId ?? entry.apiKeyCreatedBy ?? null
}

export function buildMcpAuditAccessLogInput(entry: McpToolCallAuditEntry): McpAuditAccessLogInput {
  return {
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    actorUserId: resolveAuditActorUserId(entry),
    resourceKind: MCP_AUDIT_RESOURCE_KIND,
    resourceId: entry.toolName,
    accessType: MCP_AUDIT_ACCESS_TYPE,
    context: {
      channel: entry.channel,
      mcpServer: entry.mcpServer,
      apiKeyId: entry.apiKeyId ?? null,
      sessionKeyId: entry.sessionKeyId ?? null,
      principal: entry.principal,
      outcome: entry.outcome,
      errorCode: entry.errorCode ?? null,
      durationMs: entry.durationMs,
      isMutation: entry.isMutation,
      agentId: entry.agentId ?? null,
      aiAgentRunId: entry.aiAgentRunId ?? null,
      agentRunId: entry.agentRunId ?? null,
      pendingActionIds: entry.pendingActionIds ?? null,
      correlationId: entry.correlationId,
      argKeys: extractArgKeys(entry.args),
    },
  }
}

function tryResolveAccessLogService(container: ServiceResolver | null | undefined): AccessLogWriter | undefined {
  if (!container) return undefined
  try {
    const service = container.resolve<AccessLogWriter | undefined>('accessLogService')
    if (service && typeof service.log === 'function') return service
    return undefined
  } catch {
    return undefined
  }
}

type BoundedWriteResult = { status: 'written' } | { status: 'timeout' }

function writeWithinBound(service: AccessLogWriter, input: McpAuditAccessLogInput): Promise<BoundedWriteResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<BoundedWriteResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), MCP_AUDIT_WRITE_TIMEOUT_MS)
  })
  const write = Promise.resolve()
    .then(() => service.log(input))
    .then((): BoundedWriteResult => ({ status: 'written' }))
  return Promise.race([write, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function recordMcpToolCall(
  container: ServiceResolver | null | undefined,
  entry: McpToolCallAuditEntry,
): Promise<void> {
  const correlationId = entry.correlationId
  const toolName = entry.toolName
  if (!toolName) {
    logger.warn('MCP tool-call audit row skipped: missing tool name', { correlationId })
    return
  }
  const service = tryResolveAccessLogService(container)
  if (!service) {
    logger.warn('MCP tool-call audit row dropped: accessLogService unavailable', { correlationId, toolName })
    return
  }
  try {
    const result = await writeWithinBound(service, buildMcpAuditAccessLogInput(entry))
    if (result.status === 'timeout') {
      logger.warn('MCP tool-call audit write abandoned after timeout', {
        correlationId,
        toolName,
        timeoutMs: MCP_AUDIT_WRITE_TIMEOUT_MS,
      })
    }
  } catch (error) {
    logger.warn('MCP tool-call audit write failed', { correlationId, toolName, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'ai_assistant',
      code: 'ai_assistant.mcp_audit_write_failed',
      attributes: { correlationId, toolName },
    })
  }
}
