import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { getAllOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { createCommandOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createRecordLockService } from './lib/recordLockService'
import type { RecordLockService } from './lib/recordLockService'
import { createRecordLockCrudMutationGuardService } from './lib/crudMutationGuardService'

export function register(container: AppContainer) {
  container.register({
    recordLockService: asFunction((cradle: {
      em: EntityManager
      moduleConfigService?: ModuleConfigService | null
      actionLogService?: ActionLogService | null
      rbacService?: RbacService | null
    }) =>
      createRecordLockService({
        em: cradle.em,
        moduleConfigService: cradle.moduleConfigService ?? null,
        actionLogService: cradle.actionLogService ?? null,
        rbacService: cradle.rbacService ?? null,
      }),
    ).scoped().proxy(),
    // CRUD guard decorator: chains the OSS `updated_at` floor first (built here
    // because this DI key overrides the platform default), then adds the
    // record_locks enrichment. record_locks can only ADD a 409, never skip the
    // floor (S1/H2). Spec: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md (Phase 0)
    // `.proxy()`: CLASSIC injection resolves by parameter NAME, which a bundler
    // may rename — see the comment on the platform default in
    // packages/shared/src/lib/di/container.ts. A silent failure here disables
    // the record-lock 409 as well as the OSS floor beneath it.
    crudMutationGuardService: asFunction((cradle: {
      recordLockService: RecordLockService
      em: EntityManager
    }) =>
      createRecordLockCrudMutationGuardService(
        cradle.recordLockService,
        createOptimisticLockGuardService({
          getEm: () => cradle.em,
          readers: getAllOptimisticLockReaders(),
        }),
      ),
    ).scoped().proxy(),
    // Command guard override: lock-backed `resolveExpected` derived from
    // authoritative server state (never requiring a client lock token, H2),
    // awaited by `enforceCommandOptimisticLockWithGuards`. The OSS floor still
    // runs first inside that runner.
    commandOptimisticLockGuardService: asFunction((cradle: { recordLockService: RecordLockService }) =>
      createCommandOptimisticLockGuardService({
        resolveExpected: ({ expectedFromHeader, resourceKind }) =>
          cradle.recordLockService.resolveExpectedVersion({ expectedFromHeader, resourceKind }),
      }),
    ).scoped().proxy(),
  })
}
