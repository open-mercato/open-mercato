import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
  PrivacyRetentionInput,
  PrivacySubjectResolutionInput,
  PrivacySubjectInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import {
  findAndCountWithDecryption,
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import type { EventBus } from '@open-mercato/events'
import { PasswordReset, Session, User, UserSidebarPreference } from './data/entities'
import { emitAuthEvent } from './events'
import { emailHashLookupValues } from './lib/emailHash'

export const AUTH_USERS_DATA_CLASS_ID = 'auth.users'

registerPrivacyDataClass({
  id: AUTH_USERS_DATA_CLASS_ID,
  module: 'auth',
  title: 'Application users',
  description: 'User profile, authentication state, sessions, and preferences.',
  handlerService: 'authUsersPrivacyHandler',
  subjectKinds: ['auth:user'],
  subjectIdentifierKinds: ['email'],
  retention: { actions: ['delete', 'anonymize'], defaultDays: 365 },
  subjectActions: ['discover', 'export', 'erase', 'anonymize'],
  environmentSanitization: { categories: ['personal_data', 'authentication'] },
})

export class AuthUsersPrivacyHandler implements PrivacyDataClassHandler {
  constructor(
    private readonly em: EntityManager,
    private readonly commandBus: CommandBus,
  ) {}

  async runRetention(input: PrivacyRetentionInput) {
    const where = buildAuthUserRetentionFilter(input)
    if (input.dryRun) {
      return {
        matched: await this.em.count(User, where),
        affected: 0,
        hasMore: false,
      }
    }

    const [users, total] = await findAndCountWithDecryption(
      this.em,
      User,
      where,
      {
        limit: input.batchSize,
        orderBy: { createdAt: 'asc', id: 'asc' },
      },
      input.scope,
    )
    const execution = requireRetentionExecutionContext(input)
    let affected = 0
    for (const user of users) {
      const subjectInput: PrivacySubjectInput = {
        scope: input.scope,
        subject: { kind: 'auth:user', id: user.id },
        dryRun: false,
        actorId: execution.actorId,
        commandContext: execution.commandContext,
      }
      const result = input.action === 'delete'
        ? await this.eraseSubject(subjectInput)
        : await this.anonymizeSubject(subjectInput)
      affected += result.affected
    }
    return {
      matched: users.length,
      affected,
      hasMore: total > users.length,
    }
  }

  async resolveSubjects(input: PrivacySubjectResolutionInput) {
    if (input.identifier.kind !== 'email') return { subjects: [] }
    const users = await findWithDecryption(
      this.em,
      User,
      {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        deletedAt: null,
        emailHash: { $in: emailHashLookupValues(input.identifier.value) },
      },
      { limit: 100, orderBy: { id: 'asc' } },
      input.scope,
    )
    return {
      subjects: users.map((user) => ({ kind: 'auth:user', id: user.id })),
    }
  }

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

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const users = await this.findScopedUsers(input)
    const userIds = users.map((user) => user.id)
    const sessionCount = userIds.length > 0
      ? await this.em.count(Session, { user: { $in: userIds } })
      : 0
    const resetCount = userIds.length > 0
      ? await this.em.count(PasswordReset, { user: { $in: userIds } })
      : 0
    const preferenceCount = await this.em.count(UserSidebarPreference, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    })
    const matched = users.length + sessionCount + resetCount + preferenceCount
    if (input.dryRun || matched === 0) return { matched, affected: 0 }

    await this.em.transactional(async (transactionalEm) => {
      const managedUsers = await findWithDecryption(
        transactionalEm,
        User,
        {
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
          deletedAt: null,
        },
        {},
        input.scope,
      )
      const managedIds = managedUsers.map((user) => user.id)
      for (const user of managedUsers) {
        user.email = `sandbox+${user.id}@example.invalid`
        user.emailHash = null
        user.name = null
        user.passwordHash = null
        user.isConfirmed = false
        transactionalEm.persist(user)
      }
      await transactionalEm.nativeUpdate(User, {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        deletedAt: null,
      }, { lastLoginAt: null as never })
      if (managedIds.length > 0) {
        await transactionalEm.nativeDelete(Session, { user: { $in: managedIds } })
        await transactionalEm.nativeDelete(PasswordReset, { user: { $in: managedIds } })
      }
      await transactionalEm.nativeDelete(UserSidebarPreference, {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      })
      await transactionalEm.flush()
    })

    return { matched, affected: matched }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const users = await this.findScopedUsers(input)
    const unsafeUsers = users.filter((user) => (
      user.passwordHash
      || user.name
      || user.emailHash
      || user.isConfirmed
      || user.lastLoginAt
      || !user.email.endsWith('@example.invalid')
    )).length
    const userIds = users.map((user) => user.id)
    const activeSessions = userIds.length > 0
      ? await this.em.count(Session, { user: { $in: userIds } })
      : 0
    const resetTokens = userIds.length > 0
      ? await this.em.count(PasswordReset, { user: { $in: userIds } })
      : 0
    const preferences = await this.em.count(UserSidebarPreference, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    })
    const findings = [
      { code: 'auth.users_not_sanitized', count: unsafeUsers },
      { code: 'auth.active_sessions', count: activeSessions },
      { code: 'auth.password_reset_tokens', count: resetTokens },
      { code: 'auth.user_preferences', count: preferences },
    ].filter((finding) => finding.count > 0)
    return { passed: findings.length === 0, findings }
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

  private findScopedUsers(input: PrivacyEnvironmentSanitizationInput): Promise<User[]> {
    return findWithDecryption(
      this.em,
      User,
      {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        deletedAt: null,
      },
      {},
      input.scope,
    )
  }
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export function buildAuthUserRetentionFilter(input: PrivacyRetentionInput): FilterQuery<User> {
  const cutoff = new Date((input.now ?? new Date()).getTime() - input.retentionDays * MILLISECONDS_PER_DAY)
  const excludedIds = new Set(
    input.excludedSubjects
      .filter((subject) => subject.kind === 'auth:user')
      .map((subject) => subject.id),
  )
  if (input.actorId) excludedIds.add(input.actorId)
  return {
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    deletedAt: null,
    createdAt: { $lt: cutoff },
    ...(excludedIds.size > 0 ? { id: { $nin: Array.from(excludedIds) } } : {}),
    $and: [
      { $or: [{ updatedAt: null }, { updatedAt: { $lt: cutoff } }] },
      { $or: [{ lastLoginAt: null }, { lastLoginAt: { $lt: cutoff } }] },
    ],
  }
}

function requireRetentionExecutionContext(input: PrivacyRetentionInput): {
  actorId: string
  commandContext: CommandRuntimeContext
} {
  if (!input.actorId || !input.commandContext) {
    throw new Error('[internal] Applied user retention requires an actor and command context')
  }
  return { actorId: input.actorId, commandContext: input.commandContext }
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
