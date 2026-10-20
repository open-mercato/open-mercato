import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Change simulator runs: the proposal (`input_json`) and the continuation state / result
 * (`result_json`) are encrypted at rest. They hold ids and aggregates only (defense in depth).
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'insights:insights_simulation_run',
    fields: [{ field: 'input_json' }, { field: 'result_json' }],
  },
]

export default defaultEncryptionMaps
