import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { OTEL_EXPORT_CONFIG_MODULE } from './exportSettings'

const logger = createLogger('agent_orchestrator').child({ component: 'otel-export-health' })

export const OTEL_EXPORT_HEALTH_CONFIG_NAME = 'otel_export_health'

const ERROR_CODE_MAX_LENGTH = 100
const ERROR_CODE_RE = /^[A-Za-z0-9_.:-]+$/

const otelExportHealthSchema = z.object({
  lastSuccessAt: z.string().nullable().default(null),
  lastErrorAt: z.string().nullable().default(null),
  lastErrorCode: z.string().nullable().default(null),
})

export type OtelExportHealth = z.infer<typeof otelExportHealthSchema>

export const EMPTY_OTEL_EXPORT_HEALTH: OtelExportHealth = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
}

type ModuleConfigServiceLike = {
  getRecord(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<{ value: unknown; source?: string } | null>
  setValue(moduleId: string, name: string, value: unknown, scope?: { tenantId?: string | null }): Promise<unknown>
}

function resolveModuleConfig(container: AwilixContainer): ModuleConfigServiceLike | null {
  try {
    return container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    return null
  }
}

function sanitizeErrorCode(code: string): string {
  const trimmed = code.trim().slice(0, ERROR_CODE_MAX_LENGTH)
  return ERROR_CODE_RE.test(trimmed) ? trimmed : 'unknown'
}

async function readStoredHealth(service: ModuleConfigServiceLike, tenantId: string): Promise<OtelExportHealth> {
  const record = await service.getRecord(OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_HEALTH_CONFIG_NAME, { tenantId })
  if (!record || record.source === 'instance' || record.value === null || record.value === undefined) {
    return { ...EMPTY_OTEL_EXPORT_HEALTH }
  }
  const parsed = otelExportHealthSchema.safeParse(record.value)
  return parsed.success ? parsed.data : { ...EMPTY_OTEL_EXPORT_HEALTH }
}

/**
 * The tenant's last OTel export success/error. Never throws: any failure
 * yields the empty health record.
 */
export async function readOtelExportHealth(
  container: AwilixContainer,
  tenantId: string,
): Promise<OtelExportHealth> {
  const service = resolveModuleConfig(container)
  if (!service) return { ...EMPTY_OTEL_EXPORT_HEALTH }
  try {
    return await readStoredHealth(service, tenantId)
  } catch (error) {
    logger.warn('otel export health unreadable', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ...EMPTY_OTEL_EXPORT_HEALTH }
  }
}

export type OtelExportHealthUpdate =
  | { outcome: 'success'; at?: Date }
  | { outcome: 'error'; errorCode: string; at?: Date }

/**
 * Records one export outcome for a tenant, keeping the other fields. Never
 * throws: a write failure is logged and reported, and export carries on.
 */
export async function recordOtelExportHealth(
  container: AwilixContainer,
  tenantId: string,
  update: OtelExportHealthUpdate,
): Promise<void> {
  const service = resolveModuleConfig(container)
  if (!service) return
  try {
    const current = await readStoredHealth(service, tenantId)
    const at = (update.at ?? new Date()).toISOString()
    const next: OtelExportHealth =
      update.outcome === 'success'
        ? { ...current, lastSuccessAt: at }
        : { ...current, lastErrorAt: at, lastErrorCode: sanitizeErrorCode(update.errorCode) }
    await service.setValue(OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_HEALTH_CONFIG_NAME, next, { tenantId })
  } catch (error) {
    logger.warn('otel export health write failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'otel_export_health_write_failed',
      attributes: { tenantId },
    })
  }
}
