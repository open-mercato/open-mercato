/** @jest-environment node */

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { ResourcesResource, ResourcesResourceActivity } from '../../data/entities'

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

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ACTIVITY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const OCCURRED_AT_ISO = '2026-03-04T05:06:07.000Z'

const resource = { id: RESOURCE_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

function buildBeforeSnapshotJson(occurredAt: string | null) {
  return {
    activity: {
      id: ACTIVITY_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      activityType: 'maintenance',
      subject: 'Before',
      body: null,
      occurredAt,
      authorUserId: null,
      appearanceIcon: null,
      appearanceColor: null,
    },
  }
}

function buildFakeEm(existingActivity: Record<string, unknown> | null) {
  return {
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === ResourcesResource) return resource
      if (entity === ResourcesResourceActivity) return existingActivity
      return null
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
  }
}

function buildCtx(em: ReturnType<typeof buildFakeEm>): CommandRuntimeContext {
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { fork: () => em }
        return {}
      }),
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORGANIZATION_ID, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
}

function buildLogEntry(before: ReturnType<typeof buildBeforeSnapshotJson>) {
  return JSON.parse(JSON.stringify({ resourceId: ACTIVITY_ID, commandPayload: { undo: { before, after: null } } }))
}

describe('resources activity undo restores snapshot dates as Date (#6336)', () => {
  beforeAll(async () => {
    commandRegistry.clear()
    await import('../activities')
  })

  it('assigns occurredAt as a Date when undoing an update', async () => {
    const existing: Record<string, unknown> = { id: ACTIVITY_ID, occurredAt: new Date('2026-09-01T00:00:00.000Z') }
    const em = buildFakeEm(existing)
    const handler = commandRegistry.get('resources.resource-activities.update')

    await handler!.undo!({ logEntry: buildLogEntry(buildBeforeSnapshotJson(OCCURRED_AT_ISO)), ctx: buildCtx(em) } as never)

    expect(existing.occurredAt).toBeInstanceOf(Date)
    expect((existing.occurredAt as Date).toISOString()).toBe(OCCURRED_AT_ISO)
  })

  it('re-creates a deleted activity with occurredAt as a Date', async () => {
    const em = buildFakeEm(null)
    const handler = commandRegistry.get('resources.resource-activities.delete')

    await handler!.undo!({ logEntry: buildLogEntry(buildBeforeSnapshotJson(OCCURRED_AT_ISO)), ctx: buildCtx(em) } as never)

    const createdData = em.create.mock.calls[0][1]
    expect(createdData.occurredAt).toBeInstanceOf(Date)
    expect((createdData.occurredAt as Date).toISOString()).toBe(OCCURRED_AT_ISO)
  })

  it('keeps a null occurredAt null', async () => {
    const existing: Record<string, unknown> = { id: ACTIVITY_ID, occurredAt: new Date() }
    const em = buildFakeEm(existing)
    const handler = commandRegistry.get('resources.resource-activities.update')

    await handler!.undo!({ logEntry: buildLogEntry(buildBeforeSnapshotJson(null)), ctx: buildCtx(em) } as never)

    expect(existing.occurredAt).toBeNull()
  })
})
