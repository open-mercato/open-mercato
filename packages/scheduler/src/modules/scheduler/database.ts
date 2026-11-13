import type { DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { resolvePersistedScheduleDatabaseContext } from './lib/databaseContext.js'

export const database: DatabaseModuleDeclarations = {
  jobProviders: [{
    matches: (input) => input.queue === 'scheduler-execution',
    resolve: (input) => resolvePersistedScheduleDatabaseContext(input.payload),
  }],
  tables: [{
    table: 'scheduled_jobs',
    classification: 'mixed',
    tenantNullable: true,
    reason: 'Module-owned system schedules require global maintenance discovery; tenant schedules execute under their persisted tenant scope.',
  }],
}

export default database
