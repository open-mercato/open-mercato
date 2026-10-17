import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('insights').child({ component: 'xray-kill-switch' })

export const XRAY_INGEST_TOGGLE_ID = 'insights_xray_ingest'

export const XRAY_INGEST_TOGGLE_DEFINITION = {
  identifier: XRAY_INGEST_TOGGLE_ID,
  name: 'Process X-Ray ingest',
  description: 'Projects audited changes into the Process X-Ray tables. Disable to pause ingest, backfill and reconciliation (retention pruning continues).',
  category: 'insights',
  type: 'boolean' as const,
  defaultValue: true,
}

type BoolConfigResult = { ok: boolean; value?: unknown }

type FeatureTogglesServiceLike = {
  getBoolConfig: (identifier: string, tenantId: string) => Promise<BoolConfigResult>
}

export type ServiceResolver = <TService>(name: string) => TService | undefined

function isFeatureTogglesService(value: unknown): value is FeatureTogglesServiceLike {
  return Boolean(value) && typeof (value as FeatureTogglesServiceLike).getBoolConfig === 'function'
}

/**
 * Kill switch for X-Ray ingest. Fails open: ingest stays on unless the toggle explicitly
 * resolves to `false`, so a disabled `feature_toggles` module, a missing toggle or a toggle
 * lookup error never stops the projection.
 */
export async function isXrayIngestEnabled(resolve: ServiceResolver, tenantId: string): Promise<boolean> {
  const service = resolve<unknown>('featureTogglesService')
  if (!isFeatureTogglesService(service)) return true
  try {
    const result = await service.getBoolConfig(XRAY_INGEST_TOGGLE_ID, tenantId)
    return !(result.ok === true && result.value === false)
  } catch (error) {
    logger.warn('[internal] X-Ray kill switch lookup failed; ingest stays enabled', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_toggle_lookup_failed' })
    return true
  }
}

/**
 * Registers the kill-switch toggle when the optional `feature_toggles` module is present.
 * Never resurrects a deleted toggle and never fails tenant setup.
 */
export async function seedXrayIngestToggle(
  em: EntityManager,
  container: { hasRegistration?: (name: string) => boolean },
): Promise<void> {
  if (typeof container.hasRegistration !== 'function' || !container.hasRegistration('featureTogglesService')) return
  try {
    const [{ FeatureToggle }, { findOneWithDecryption }] = await Promise.all([
      import('@open-mercato/core/modules/feature_toggles/data/entities'),
      import('@open-mercato/shared/lib/encryption/find'),
    ])
    const existing = await findOneWithDecryption(em, FeatureToggle, { identifier: XRAY_INGEST_TOGGLE_DEFINITION.identifier })
    if (existing) return
    em.persist(em.create(FeatureToggle, {
      identifier: XRAY_INGEST_TOGGLE_DEFINITION.identifier,
      name: XRAY_INGEST_TOGGLE_DEFINITION.name,
      description: XRAY_INGEST_TOGGLE_DEFINITION.description,
      category: XRAY_INGEST_TOGGLE_DEFINITION.category,
      type: XRAY_INGEST_TOGGLE_DEFINITION.type,
      defaultValue: XRAY_INGEST_TOGGLE_DEFINITION.defaultValue,
    }))
    await em.flush()
  } catch (error) {
    logger.warn('[internal] Could not seed the X-Ray ingest toggle', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_toggle_seed_failed' })
  }
}
