import type { DataQualityGeneratedRegistry, DataQualityTargetEntry } from '@open-mercato/shared/modules/data-quality'
import {
  getDataQualityTargetEntries,
  registerDataQualityTargetEntries,
  loadDataQualityTargetRegistry,
} from '@open-mercato/shared/modules/data-quality'

export type { DataQualityTargetEntry }
export { registerDataQualityTargetEntries, getDataQualityTargetEntries }

export function loadTargetRegistry(): DataQualityGeneratedRegistry {
  return loadDataQualityTargetRegistry()
}
