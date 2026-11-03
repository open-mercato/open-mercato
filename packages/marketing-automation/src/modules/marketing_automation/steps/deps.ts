import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { EngineLogger } from '../lib/engine/types.js'

export type StepDeps = {
  em: EntityManager
  container: AwilixContainer
  logger: EngineLogger
  now: Date
  /** Scope every read and write carries; never inferred from the context blob. */
  scope: { tenantId: string; organizationId: string }
  /** Built once per run so each step does not re-derive a synthetic actor. */
  commandContext: CommandRuntimeContext
}
