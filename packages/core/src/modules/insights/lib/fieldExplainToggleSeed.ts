import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION } from './fieldExplainToggle'

const FEATURE_TOGGLES_SERVICE_NAME = 'featureTogglesService'

/**
 * Registers the `insights_field_explain` kill switch when the optional `feature_toggles` module is
 * enabled (detected through its DI registration, so `insights` never requires it). An existing row,
 * including a soft-deleted one, is left untouched: the identifier is unique across deleted rows and an
 * operator's deletion must not be undone by a later tenant seed. Returns whether a row was created.
 */
export async function seedInsightsFieldExplainToggle(
  em: EntityManager,
  container: Pick<AwilixContainer, 'hasRegistration'>,
): Promise<boolean> {
  if (!container.hasRegistration(FEATURE_TOGGLES_SERVICE_NAME)) return false
  const { FeatureToggle } = await import('@open-mercato/core/modules/feature_toggles/data/entities')
  const existing = await findOneWithDecryption(em, FeatureToggle, {
    identifier: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.identifier,
  })
  if (existing) return false
  em.persist(
    em.create(FeatureToggle, {
      identifier: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.identifier,
      name: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.name,
      description: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.description,
      category: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.category,
      type: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.type,
      defaultValue: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.defaultValue,
    }),
  )
  await em.flush()
  return true
}
