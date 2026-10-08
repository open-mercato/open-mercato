import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { ExplainService } from './services/explainService'

type ExplainServiceCradle = {
  em: EntityManager
  rbacService: RbacService
  actionLogService: ActionLogService
}

export function register(container: AppContainer) {
  const tryResolve = <TService>(name: string): TService | undefined => {
    try {
      return container.resolve(name) as TService
    } catch {
      return undefined
    }
  }
  container.register({
    explainService: asFunction((cradle: ExplainServiceCradle) => new ExplainService({
      em: cradle.em,
      rbacService: cradle.rbacService,
      actionLogService: cradle.actionLogService,
      resolve: tryResolve,
    })).scoped().proxy(),
  })
}
