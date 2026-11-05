jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    auth: {
      user: 'auth:user',
      role: 'auth:role',
    },
    directory: {
      organization: 'directory:organization',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type {
  CommandHandler,
  CommandLogBuilderArgs,
  CommandLogMetadata,
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '../../data/entities'

/**
 * Regression coverage for issue #1978 — "Undo token not available" on every
 * auth.users.* mutation.
 *
 * Root cause: buildLog returned only `tenantId`, never `organizationId`. The
 * command bus then fell back to `ctx.selectedOrganizationId ?? ctx.auth.orgId`.
 * For a super-admin actor (the default seeded admin) the scope resolver widens
 * to "all organizations" and nulls out both, so action_log rows landed with
 * `organization_id = NULL`. The undo route's `latestUndoableForResource` lookup
 * filters by `auth.orgId` and never matches, returning 400.
 *
 * Fixing this means anchoring the audit log row to the user's actual
 * organization (mirrors how customers.* commands behave), so the undo route's
 * resource lookup can still find the row regardless of the actor's selected
 * org scope.
 */
describe('auth.users.* buildLog organization scoping (issue #1978)', () => {
  function makeCtx(overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
    const em = {
      find: async () => [],
      findOne: async () => null,
      fork: () => em,
      remove: () => undefined,
      persist: () => undefined,
      flush: async () => undefined,
      nativeDelete: async () => 0,
      create: (_entity: unknown, data: unknown) => data,
    } as unknown as EntityManager

    const container = {
      resolve: (token: string) => {
        if (token === 'em') return em
        throw new Error(`Unexpected dependency: ${token}`)
      },
    }

    return {
      container: container as unknown as CommandRuntimeContext['container'],
      // Super-admin without an explicit selected org reproduces the bug:
      // selectedOrganizationId is null and auth.orgId gets scoped to null
      // by the CRUD factory, so persistLog has nothing to fall back to.
      auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: null } as any,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      request: undefined as any,
      ...overrides,
    }
  }

  it('auth.users.create attaches the user organization to the audit log', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.create') as CommandHandler
    expect(handler?.buildLog).toBeDefined()

    const user = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'new@example.com',
      organizationId: 'org-target',
      tenantId: 'tenant-1',
      name: null,
      isConfirmed: true,
    } as unknown as User

    const args: CommandLogBuilderArgs<Record<string, unknown>, { user: User }> = {
      input: { email: user.email, organizationId: user.organizationId },
      result: { user },
      ctx: makeCtx(),
      snapshots: {},
    }
    const metadata = (await handler.buildLog!(args)) as CommandLogMetadata
    expect(metadata).toBeDefined()
    expect(metadata.organizationId).toBe('org-target')
    expect(metadata.tenantId).toBe('tenant-1')
    expect(metadata.resourceKind).toBe('auth.user')
    expect(metadata.resourceId).toBe(user.id)
  })

  it('auth.users.update attaches the user organization to the audit log', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler
    expect(handler?.buildLog).toBeDefined()

    const user = {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'edit@example.com',
      organizationId: 'org-target',
      tenantId: 'tenant-1',
      name: 'After',
      isConfirmed: true,
    } as unknown as User

    const args: CommandLogBuilderArgs<Record<string, unknown>, User> = {
      input: { id: user.id, name: 'After' },
      result: user,
      ctx: makeCtx(),
      snapshots: {
        before: {
          view: {
            email: 'edit@example.com',
            organizationId: 'org-target',
            tenantId: 'tenant-1',
            roles: [],
            name: 'Before',
            isConfirmed: true,
          },
          undo: {
            id: user.id,
            email: 'edit@example.com',
            organizationId: 'org-target',
            tenantId: 'tenant-1',
            passwordHash: null,
            name: 'Before',
            isConfirmed: true,
            roles: [],
            acls: [],
          },
        },
      },
    }
    const metadata = (await handler.buildLog!(args)) as CommandLogMetadata
    expect(metadata).toBeDefined()
    expect(metadata.organizationId).toBe('org-target')
    expect(metadata.tenantId).toBe('tenant-1')
    expect(metadata.resourceKind).toBe('auth.user')
    expect(metadata.resourceId).toBe(user.id)
  })

  it('auth.users.delete attaches the user organization to the audit log', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.delete') as CommandHandler
    expect(handler?.buildLog).toBeDefined()

    const userId = '33333333-3333-3333-3333-333333333333'
    const args: CommandLogBuilderArgs<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, User> = {
      input: { query: { id: userId } },
      result: { id: userId } as unknown as User,
      ctx: makeCtx(),
      snapshots: {
        before: {
          view: {
            email: 'gone@example.com',
            organizationId: 'org-target',
            tenantId: 'tenant-1',
            roles: [],
            name: null,
            isConfirmed: true,
          },
          undo: {
            id: userId,
            email: 'gone@example.com',
            organizationId: 'org-target',
            tenantId: 'tenant-1',
            passwordHash: null,
            name: null,
            isConfirmed: true,
            roles: [],
            acls: [],
          },
        },
      },
    }
    const metadata = (await handler.buildLog!(args)) as CommandLogMetadata
    expect(metadata).toBeDefined()
    expect(metadata.organizationId).toBe('org-target')
    expect(metadata.tenantId).toBe('tenant-1')
    expect(metadata.resourceKind).toBe('auth.user')
    expect(metadata.resourceId).toBe(userId)
  })
})
