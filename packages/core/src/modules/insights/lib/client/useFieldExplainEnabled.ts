import { useFeatureFlagBoolean } from '@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureFlagBoolean'
import { INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID } from '../fieldExplainToggle'

/**
 * Kill switch for the CrudForm field explain UI (`insights_field_explain`, default on). Fails open:
 * a missing toggle definition or a disabled `feature_toggles` module keeps the feature available,
 * while the check is in flight the UI stays hidden so a disabled switch never flashes.
 */
export function useFieldExplainEnabled(): boolean {
  const { enabled, isLoading } = useFeatureFlagBoolean({ id: INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID, defaultValue: true })
  return enabled && !isLoading
}
