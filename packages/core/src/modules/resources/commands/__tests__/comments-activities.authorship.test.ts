/** @jest-environment node */

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { ResourcesResource, ResourcesResourceActivity, ResourcesResourceComment } from '../../data/entities'
import type {
  ResourcesResourceActivityCreateInput,
  ResourcesResourceActivityUpdateInput,
  ResourcesResourceCommentCreateInput,
  ResourcesResourceCommentUpdateInput,
} from '../../data/validators'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
    setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em, entity, where) => em.findOne(entity, where)),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const COMMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ACTIVITY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const CALLER_USER_ID = '11111111-1111-4111-8111-111111111111'
const SPOOFED_USER_ID = '22222222-2222-4222-8222-222222222222'
const ORIGINAL_AUTHOR_ID = '33333333-3333-4333-8333-333333333333'

type FakeResource = {
  id: string
  tenantId: string
  organizationId: string
}

type FakeUser = {
  id: string
  tenantId: string | null
  organizationId: string | null
  deletedAt?: Date | null
}

type FakeComment = FakeResource & {
  resource: FakeResource
  body: string
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type FakeActivity = FakeResource & {
  resource: FakeResource
  activityType: string
  subject: string | null
  body: string | null
  occurredAt: Date | null
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

function buildResource(): FakeResource {
  return {
    id: RESOURCE_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
  }
}

function buildUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: SPOOFED_USER_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    deletedAt: null,
    ...overrides,
  }
}

function buildComment(overrides: Partial<FakeComment> = {}): FakeComment {
  const resource = buildResource()
  return {
    id: COMMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    resource,
    body: 'Initial comment',
    authorUserId: ORIGINAL_AUTHOR_ID,
    appearanceIcon: null,
    appearanceColor: null,
    ...overrides,
  }
}

function buildActivity(overrides: Partial<FakeActivity> = {}): FakeActivity {
  const resource = buildResource()
  return {
    id: ACTIVITY_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    resource,
    activityType: 'maintenance',
    subject: 'Initial activity',
    body: null,
    occurredAt: null,
    authorUserId: ORIGINAL_AUTHOR_ID,
    appearanceIcon: null,
    appearanceColor: null,
    ...overrides,
  }
}

function buildFakeEm(records: {
  resource?: FakeResource
  comment?: FakeComment | null
  activity?: FakeActivity | null
  user?: FakeUser | null
} = {}) {
  const resource = records.resource ?? buildResource()
  const em = {
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    findOne: jest.fn(async (entity: unknown, where?: Record<string, unknown>) => {
      if (entity === ResourcesResource) return resource
      if (entity === ResourcesResourceComment) return records.comment ?? null
      if (entity === ResourcesResourceActivity) return records.activity ?? null
      if (entity === User) {
        const user = records.user ?? null
        if (!user) return null
        if (where?.id !== user.id) return null
        if (where?.tenantId !== user.tenantId) return null
        if (where?.organizationId !== user.organizationId) return null
        if (where?.deletedAt !== user.deletedAt) return null
        return user
      }
      return null
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === ResourcesResourceComment) return { id: COMMENT_ID, ...data }
      if (entity === ResourcesResourceActivity) return { id: ACTIVITY_ID, ...data }
      return { ...data }
    }),
  }
  return em
}

function buildCtx(
  em: ReturnType<typeof buildFakeEm>,
  authOverrides: Partial<NonNullable<CommandRuntimeContext['auth']>> = {},
): CommandRuntimeContext {
  const emContainer = { fork: jest.fn().mockReturnValue(em) }
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return emContainer
        if (name === 'dataEngine') return {}
        return {}
      }),
    } as CommandRuntimeContext['container'],
    auth: {
      sub: CALLER_USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      isSuperAdmin: false,
      ...authOverrides,
    },
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
}

describe('resources comment/activity authorship', () => {
  beforeAll(async () => {
    commandRegistry.clear()
    await import('../comments')
    await import('../activities')
  })

  it('derives created comment authors from auth instead of request input (#3891)', async () => {
    const em = buildFakeEm()
    const ctx = buildCtx(em)
    const handler = commandRegistry.get<
      ResourcesResourceCommentCreateInput,
      { commentId: string; authorUserId: string | null }
    >('resources.resource-comments.create')

    const result = await handler!.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        entityId: RESOURCE_ID,
        body: 'Forged comment author',
        authorUserId: SPOOFED_USER_ID,
      },
      ctx,
    )

    expect(result.authorUserId).toBe(CALLER_USER_ID)
    expect(em.create).toHaveBeenCalledWith(
      ResourcesResourceComment,
      expect.objectContaining({ authorUserId: CALLER_USER_ID }),
    )
  })

  it('lets super admins delegate comment authorship to a live user in the resource scope (#3891)', async () => {
    const em = buildFakeEm({ user: buildUser() })
    const ctx = buildCtx(em, { isSuperAdmin: true })
    const handler = commandRegistry.get<
      ResourcesResourceCommentCreateInput,
      { commentId: string; authorUserId: string | null }
    >('resources.resource-comments.create')

    const result = await handler!.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        entityId: RESOURCE_ID,
        body: 'Delegated comment author',
        authorUserId: SPOOFED_USER_ID,
      },
      ctx,
    )

    expect(result.authorUserId).toBe(SPOOFED_USER_ID)
    expect(em.create).toHaveBeenCalledWith(
      ResourcesResourceComment,
      expect.objectContaining({ authorUserId: SPOOFED_USER_ID }),
    )
  })

  it('falls back to the caller when a super admin delegates comment authorship outside resource scope (#3891)', async () => {
    const em = buildFakeEm({
      user: buildUser({ organizationId: '99999999-9999-4999-8999-999999999999' }),
    })
    const ctx = buildCtx(em, { isSuperAdmin: true })
    const handler = commandRegistry.get<
      ResourcesResourceCommentCreateInput,
      { commentId: string; authorUserId: string | null }
    >('resources.resource-comments.create')

    const result = await handler!.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        entityId: RESOURCE_ID,
        body: 'Out-of-scope delegated comment author',
        authorUserId: SPOOFED_USER_ID,
      },
      ctx,
    )

    expect(result.authorUserId).toBe(CALLER_USER_ID)
    expect(em.create).toHaveBeenCalledWith(
      ResourcesResourceComment,
      expect.objectContaining({ authorUserId: CALLER_USER_ID }),
    )
  })

  it('does not let comment updates reassign the author from request input (#3891)', async () => {
    const comment = buildComment()
    const em = buildFakeEm({ comment })
    const ctx = buildCtx(em)
    const handler = commandRegistry.get<ResourcesResourceCommentUpdateInput, { commentId: string }>(
      'resources.resource-comments.update',
    )

    await handler!.execute(
      {
        id: COMMENT_ID,
        body: 'Updated comment body',
        authorUserId: SPOOFED_USER_ID,
      },
      ctx,
    )

    expect(comment.body).toBe('Updated comment body')
    expect(comment.authorUserId).toBe(ORIGINAL_AUTHOR_ID)
  })

  it('derives created activity authors from auth instead of request input (#3891)', async () => {
    const em = buildFakeEm()
    const ctx = buildCtx(em)
    const handler = commandRegistry.get<
      ResourcesResourceActivityCreateInput,
      { activityId: string; authorUserId: string | null }
    >('resources.resource-activities.create')

    const result = await handler!.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        entityId: RESOURCE_ID,
        activityType: 'maintenance',
        subject: 'Forged activity author',
        authorUserId: SPOOFED_USER_ID,
      },
      ctx,
    )

    expect(result.authorUserId).toBe(CALLER_USER_ID)
    expect(em.create).toHaveBeenCalledWith(
      ResourcesResourceActivity,
      expect.objectContaining({ authorUserId: CALLER_USER_ID }),
    )
  })

  it('does not let activity updates reassign the author from request input (#3891)', async () => {
    const activity = buildActivity()
    const em = buildFakeEm({ activity })
    const ctx = buildCtx(em)
    const handler = commandRegistry.get<ResourcesResourceActivityUpdateInput, { activityId: string }>(
      'resources.resource-activities.update',
    )

    await handler!.execute(
      {
        id: ACTIVITY_ID,
        subject: 'Updated activity subject',
        authorUserId: SPOOFED_USER_ID,
      },
      ctx,
    )

    expect(activity.subject).toBe('Updated activity subject')
    expect(activity.authorUserId).toBe(ORIGINAL_AUTHOR_ID)
  })
})
