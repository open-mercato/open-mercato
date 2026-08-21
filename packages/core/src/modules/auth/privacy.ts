import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { PrivacyDataClassHandler, PrivacySubjectInput } from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EventBus } from '@open-mercato/events'
import { PasswordReset, Session, User, UserSidebarPreference } from './data/entities'
import { emitAuthEvent } from './events'

export const AUTH_USERS_DATA_CLASS_ID = 'auth.users'

registerPrivacyDataClass({
  id: AUTH_USERS_DATA_CLASS_ID,
  module: 'auth',
  title: 'Application users',
  description: 'User profile, authentication state, sessions, and preferences.',
  handlerService: 'authUsersPrivacyHandler',
  subjectKinds: ['auth:user'],
  subjectActions: ['discover', 'export', 'erase', 'anonymize'],
})

export class AuthUsersPrivacyHandler implements PrivacyDataClassHandler {
  constructor(
    private readonly em: EntityManager,
    private readonly commandBus: CommandBus,
  ) {}

  async discoverSubject(input: PrivacySubjectInput) {
    const user = await this.findUser(input)
    return { found: user !== null, recordCount: user ? 1 : 0 }
  }

  async exportSubject(input: PrivacySubjectInput) {
    const user = await this.findUser(input)
    if (!user) return { recordCount: 0, data: null }
    return {
      recordCount: 1,
      data: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        kind: user.kind,
        isConfirmed: user.isConfirmed,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      },
    }
  }

  async eraseSubject(input: PrivacySubjectInput) {
    const user = await this.findUser(input)
    if (!user) return { affected: 0 }
    if (input.dryRun) return { affected: 1 }
    const commandContext = requireCommandContext(input)
    await this.commandBus.execute('auth.users.delete', {
      input: { body: { id: user.id } },
      ctx: commandContext,
      metadata: { skipLog: true },
    })
    return { affected: 1 }
  }

  async anonymizeSubject(input: PrivacySubjectInput) {
    const user = await this.findUser(input)
    if (!user) return { affected: 0 }
    if (input.dryRun) return { affected: 1 }
    const commandContext = requireCommandContext(input)

    await this.em.transactional(async (transactionalEm) => {
      const managedUser = await findOneWithDecryption(
        transactionalEm,
        User,
        {
          id: user.id,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
          deletedAt: null,
        },
        {},
        input.scope,
      )
      if (!managedUser) return
      managedUser.email = `anonymized+${managedUser.id}@example.invalid`
      managedUser.emailHash = null
      managedUser.name = null
      managedUser.passwordHash = null
      managedUser.isConfirmed = false
      await transactionalEm.nativeDelete(Session, { user: managedUser.id })
      await transactionalEm.nativeDelete(PasswordReset, { user: managedUser.id })
      await transactionalEm.nativeDelete(UserSidebarPreference, { user: managedUser.id })
      transactionalEm.persist(managedUser)
      await transactionalEm.flush()
    })

    await emitAuthEvent('auth.user.updated', {
      id: user.id,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    })
    await emitIndexUpdate(commandContext, 'auth:user', user.id, input)
    return { affected: 1 }
  }

  private findUser(input: PrivacySubjectInput): Promise<User | null> {
    return findOneWithDecryption(
      this.em,
      User,
      {
        id: input.subject.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        deletedAt: null,
      },
      {},
      input.scope,
    )
  }
}

function requireCommandContext(input: PrivacySubjectInput): CommandRuntimeContext {
  if (!input.commandContext) {
    throw new Error('[internal] Privacy subject mutation requires a command context')
  }
  return input.commandContext
}

async function emitIndexUpdate(
  commandContext: CommandRuntimeContext,
  entityType: string,
  recordId: string,
  input: PrivacySubjectInput,
): Promise<void> {
  if (!commandContext.container.hasRegistration('eventBus')) return
  const eventBus = commandContext.container.resolve<EventBus>('eventBus')
  await eventBus.emitEvent('query_index.upsert_one', {
    entityType,
    recordId,
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    crudAction: 'updated',
  }, input.scope)
}
