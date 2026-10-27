import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { traceIdFor } from './ids'
import { resolveRootRunId } from './loadRunExportBundle'
import {
  readOtelExportSettings,
  resolveOtelExportDeployment,
  type OtelExportContainer,
  type OtelExportDeploymentConfig,
} from './exportSettings'

const logger = createLogger('agent_orchestrator').child({ component: 'otel-trace-link' })

export const OTEL_TRACE_URL_TRACE_ID_TOKEN = '{traceId}'

export type RunOtelLink = { traceId: string; url: string }

export type RunOtelLinkRun = {
  id: string
  tenantId: string
  organizationId: string
  workflowInstanceId?: string | null
  parentRunId?: string | null
}

/**
 * Fills `{traceId}` in the deployment's trace URL template. Returns `null`
 * unless the result is an http(s) URL, so a template can never become a
 * script link in the trace page.
 */
export function buildOtelTraceUrl(template: string, traceId: string): string | null {
  const filled = template.split(OTEL_TRACE_URL_TRACE_ID_TOKEN).join(encodeURIComponent(traceId))
  let parsed: URL
  try {
    parsed = new URL(filled)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return filled
}

export type ResolveRunOtelLinkInput = {
  container: OtelExportContainer
  em: EntityManager
  run: RunOtelLinkRun
  deployment?: OtelExportDeploymentConfig
}

/**
 * The run's exported trace id and its link in the tracing backend, or `null`
 * unless the deployment exports, the tenant exports and a trace URL template
 * is configured. The template is read server-side only. Never throws.
 */
export async function resolveRunOtelLink(input: ResolveRunOtelLinkInput): Promise<RunOtelLink | null> {
  const deployment = input.deployment ?? resolveOtelExportDeployment()
  if (!deployment.enabled || !deployment.traceUrlTemplate) return null
  try {
    const { settings } = await readOtelExportSettings(input.container, input.run.tenantId)
    if (!settings.enabled) return null
    const workflowInstanceId = input.run.workflowInstanceId ?? null
    const rootRunId = workflowInstanceId
      ? input.run.id
      : await resolveRootRunId(
          input.em,
          { tenantId: input.run.tenantId, organizationId: input.run.organizationId },
          { id: input.run.id, parentRunId: input.run.parentRunId ?? null },
        )
    const traceId = traceIdFor({ tenantId: input.run.tenantId, workflowInstanceId, rootRunId })
    const url = buildOtelTraceUrl(deployment.traceUrlTemplate, traceId)
    return url ? { traceId, url } : null
  } catch (error) {
    logger.warn('could not resolve the otel trace link for a run', {
      runId: input.run.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
