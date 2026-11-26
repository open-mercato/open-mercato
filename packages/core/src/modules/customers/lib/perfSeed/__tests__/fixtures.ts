import { parseAnchorDate, resolveEntityCount } from '../generator'
import { PERF_V1, type PerfTier } from '../profile'
import { defaultSeedDictionaries, placeholderIds, placeholderPipelines } from '../setup'
import type { GeneratorContext } from '../types'

export const TEST_TENANT_ID = '11111111-1111-4111-8111-111111111111'
export const TEST_ORG_ID = '22222222-2222-4222-8222-222222222222'
export const TEST_ANCHOR = '2026-11-26'

export function buildTestContext(overrides: { tier?: PerfTier; scale?: number; seed?: number; entityCount?: number } = {}): GeneratorContext {
  const tier = overrides.tier ?? 'XS'
  const namespace = 'perf-seed-test'
  return {
    profile: PERF_V1,
    tier,
    seed: overrides.seed ?? 42,
    anchor: parseAnchorDate(TEST_ANCHOR),
    scope: { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID },
    entityCount: overrides.entityCount ?? resolveEntityCount(PERF_V1, tier, overrides.scale ?? 1),
    refs: {
      owners: placeholderIds(namespace, 'owner', 200),
      pipelines: placeholderPipelines(PERF_V1, namespace),
      tagIds: placeholderIds(namespace, 'tag', PERF_V1.tagCount),
      dictionaries: defaultSeedDictionaries(),
    },
  }
}
