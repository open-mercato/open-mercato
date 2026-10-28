/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerInteraction,
  CustomerPersonProfile,
} from '../../data/entities'

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const FOREIGN_TENANT_ID = '99999999-9999-4999-8999-999999999999'
const FOREIGN_ORG_ID = '88888888-8888-4888-8888-888888888888'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const PROFILE_ID = '44444444-4444-4444-8444-444444444444'
const EMAIL_ID = '55555555-5555-4555-8555-555555555555'
const MEETING_ID = '66666666-6666-4666-8666-666666666666'
const NOTE_ID = '77777777-7777-4777-8777-777777777777'
const AUTHOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MESSAGE_LINK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CHANNEL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const DETAIL_KEYS = [
  'externalMessageId',
  'channelProviderKey',
  'channelId',
  'durationMinutes',
  'location',
  'allDay',
  'recurrenceRule',
  'recurrenceEnd',
  'participants',
  'reminderMinutes',
  'visibility',
  'linkedEntities',
  'guestPermissions',
  'pinned',
] as const

type Kind = 'person' | 'company'

function makeEntity(kind: Kind): Record<string, unknown> {
  return {
    id: ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind,
    displayName: 'Record',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    temperature: null,
    renewalQuarter: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    deletedAt: null,
  }
}

function makeProfile(kind: Kind, entity: Record<string, unknown>): Record<string, unknown> {
  const base = { id: PROFILE_ID, organizationId: ORG_ID, tenantId: TENANT_ID, entity }
  return kind === 'person'
    ? { ...base, firstName: 'Ada', lastName: 'Doe', preferredName: null, jobTitle: null, department: null, seniority: null, timezone: null, linkedInUrl: null, twitterUrl: null, company: null }
    : { ...base, legalName: null, brandName: null, domain: null, websiteUrl: null, industry: null, sizeBucket: null, annualRevenue: null }
}

function baseInteraction(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    interactionType: 'note',
    title: null,
    body: null,
    status: 'done',
    scheduledAt: null,
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: null,
    dealId: null,
    externalMessageId: null,
    channelProviderKey: null,
    channelId: null,
    durationMinutes: null,
    location: null,
    allDay: null,
    recurrenceRule: null,
    recurrenceEnd: null,
    participants: null,
    reminderMinutes: null,
    visibility: null,
    linkedEntities: null,
    guestPermissions: null,
    pinned: false,
    createdAt: new Date('2026-09-02T10:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

const PRIVATE_EMAIL = baseInteraction(EMAIL_ID, {
  interactionType: 'email',
  title: 'Contract terms',
  body: 'Private body',
  occurredAt: new Date('2026-09-02T09:00:00.000Z'),
  authorUserId: AUTHOR_ID,
  source: 'email',
  externalMessageId: MESSAGE_LINK_ID,
  channelProviderKey: 'gmail',
  channelId: CHANNEL_ID,
  visibility: 'private',
})

const MEETING = baseInteraction(MEETING_ID, {
  interactionType: 'meeting',
  title: 'Quarterly review',
  status: 'planned',
  scheduledAt: new Date('2026-11-03T09:00:00.000Z'),
  priority: 3,
  durationMinutes: 45,
  location: 'Room 4B',
  allDay: false,
  recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
  recurrenceEnd: new Date('2026-11-24T09:45:00.000Z'),
  participants: [{ name: 'Guest One', email: 'guest-one@example.com', status: 'accepted' }],
  reminderMinutes: 15,
  visibility: 'team',
  linkedEntities: [{ id: PROFILE_ID, type: 'company', label: 'Linked record' }],
  guestPermissions: { canInviteOthers: false, canModify: true, canSeeList: true },
  pinned: true,
})

const NOTE = baseInteraction(NOTE_ID, { title: 'Plain note' })

function createFakeEm(kind: Kind, options: { existing?: boolean; interactions?: Record<string, unknown>[] } = {}) {
  const profileCtor = kind === 'person' ? CustomerPersonProfile : CustomerCompanyProfile
  const state = {
    entity: options.existing ? makeEntity(kind) : null as Record<string, unknown> | null,
    profile: null as Record<string, unknown> | null,
    createdInteractions: [] as Record<string, unknown>[],
  }
  if (state.entity) state.profile = makeProfile(kind, state.entity)
  const em: any = {
    fork: () => em,
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerEntity) return state.entity && where?.id === state.entity.id ? state.entity : null
      if (ctor === profileCtor) return state.profile
      return null
    }),
    find: jest.fn(async (ctor: unknown) => (ctor === CustomerInteraction ? options.interactions ?? [] : [])),
    count: jest.fn(async () => 0),
    create: jest.fn((ctor: unknown, data: Record<string, unknown>) => {
      const created = { ...data }
      if (ctor === CustomerEntity) state.entity = created
      if (ctor === profileCtor) state.profile = created
      if (ctor === CustomerInteraction) state.createdInteractions.push(created)
      return created
    }),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    nativeUpdate: jest.fn(async () => 0),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    transactional: jest.fn(async (fn: (inner: unknown) => unknown) => fn(em)),
    getKysely: () => {
      const chain: any = {}
      for (const method of ['select', 'selectAll', 'where', 'orderBy', 'limit', 'offset', 'values', 'set', 'onConflict', 'returning', 'innerJoin', 'leftJoin']) {
        chain[method] = jest.fn(() => chain)
      }
      chain.executeTakeFirst = jest.fn(async () => undefined)
      chain.execute = jest.fn(async () => [])
      return {
        selectFrom: jest.fn(() => chain),
        insertInto: jest.fn(() => chain),
        updateTable: jest.fn(() => chain),
        deleteFrom: jest.fn(() => chain),
      }
    },
  }
  return { em, state }
}

function createCtx(em: unknown): CommandRuntimeContext {
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'actor-user', tenantId: TENANT_ID, orgId: ORG_ID } as unknown as CommandRuntimeContext['auth'],
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as unknown as CommandRuntimeContext['request'],
  }
}

function deleteCommand(kind: Kind): CommandHandler {
  const id = `customers.${kind === 'person' ? 'people' : 'companies'}.delete`
  const handler = commandRegistry.get(id) as CommandHandler | undefined
  if (!handler) throw new Error(`[internal] command ${id} not registered`)
  return handler
}

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type DeleteLog = {
  snapshotBefore: { interactions: Record<string, unknown>[] }
  payload: { undo: { before: { interactions: Record<string, unknown>[] } } }
}

async function captureDeleteLog(kind: Kind, interactions: Record<string, unknown>[]): Promise<DeleteLog> {
  const { em } = createFakeEm(kind, { existing: true, interactions })
  const handler = deleteCommand(kind)
  const ctx = createCtx(em)
  const snapshots = await handler.prepare!({ body: { id: ENTITY_ID } }, ctx)
  const log = await handler.buildLog!({ snapshots, ctx, input: { body: { id: ENTITY_ID } }, result: { entityId: ENTITY_ID } } as never)
  return log as unknown as DeleteLog
}

function snapshotFor(kind: Kind, interactions: Record<string, unknown>[]) {
  const entity = makeEntity(kind)
  for (const key of ['kind', 'createdAt', 'updatedAt', 'deletedAt']) delete entity[key]
  if (kind === 'person') {
    delete entity.temperature
    delete entity.renewalQuarter
  }
  const profile = makeProfile(kind, {})
  for (const key of ['entity', 'organizationId', 'tenantId', 'company']) delete profile[key]
  return {
    entity,
    profile: kind === 'person' ? { ...profile, companyEntityId: null } : profile,
    ...(kind === 'person' ? { companies: [] } : { members: [] }),
    tagIds: [],
    addresses: [],
    comments: [],
    deals: [],
    activities: [],
    todos: [],
    interactions,
    custom: {},
  }
}

async function undoDelete(kind: Kind, interactionSnapshots: Record<string, unknown>[]) {
  const { em, state } = createFakeEm(kind)
  const logEntry = roundTrip({ resourceId: ENTITY_ID, commandPayload: { undo: { before: snapshotFor(kind, interactionSnapshots) } } })
  await deleteCommand(kind).undo!({ logEntry, ctx: createCtx(em) } as never)
  return new Map(state.createdInteractions.map((row) => [row.id as string, row]))
}

function legacySnapshot(row: Record<string, unknown>): Record<string, unknown> {
  const legacy: Record<string, unknown> = {}
  for (const key of ['id', 'interactionType', 'title', 'body', 'status', 'scheduledAt', 'occurredAt', 'priority', 'authorUserId', 'ownerUserId', 'appearanceIcon', 'appearanceColor', 'source', 'dealId', 'createdAt', 'updatedAt', 'deletedAt']) {
    legacy[key] = row[key]
  }
  return legacy
}

function expectSameDate(actual: unknown, expected: unknown) {
  expect(new Date(actual as string | Date).toISOString()).toBe((expected as Date).toISOString())
}

describe.each<Kind>(['person', 'company'])('customers %s delete → undo restores interaction state', (kind) => {
  afterEach(() => jest.clearAllMocks())

  it('captures every restore column in the undo payload and keeps them out of snapshotBefore', async () => {
    const log = await captureDeleteLog(kind, [PRIVATE_EMAIL, MEETING, NOTE])
    const undoInteractions = roundTrip(log.payload.undo.before.interactions)
    expect(undoInteractions).toHaveLength(3)
    for (const interaction of undoInteractions) {
      for (const key of DETAIL_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(interaction, key)).toBe(true)
      }
    }
    const email = undoInteractions.find((row) => row.id === EMAIL_ID)!
    expect(email).toMatchObject({ visibility: 'private', channelId: CHANNEL_ID, externalMessageId: MESSAGE_LINK_ID, channelProviderKey: 'gmail' })

    for (const interaction of log.snapshotBefore.interactions) {
      for (const key of DETAIL_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(interaction, key)).toBe(false)
      }
      expect(interaction.id).toBeDefined()
      expect(interaction).toHaveProperty('title')
    }
  })

  it('restores a private, source-linked email with its channel linkage and visibility', async () => {
    const log = await captureDeleteLog(kind, [PRIVATE_EMAIL])
    const restored = await undoDelete(kind, log.payload.undo.before.interactions)
    const email = restored.get(EMAIL_ID)!
    expect(email).toMatchObject({
      id: EMAIL_ID,
      interactionType: 'email',
      title: 'Contract terms',
      body: 'Private body',
      authorUserId: AUTHOR_ID,
      source: 'email',
      visibility: 'private',
      externalMessageId: MESSAGE_LINK_ID,
      channelProviderKey: 'gmail',
      channelId: CHANNEL_ID,
      pinned: false,
    })
    expectSameDate(email.occurredAt, PRIVATE_EMAIL.occurredAt)
    expectSameDate(email.createdAt, PRIVATE_EMAIL.createdAt)
    expectSameDate(email.updatedAt, PRIVATE_EMAIL.updatedAt)
  })

  it('restores meeting metadata, keeps nulls null and restores ordinary interactions', async () => {
    const log = await captureDeleteLog(kind, [MEETING, NOTE])
    const restored = await undoDelete(kind, log.payload.undo.before.interactions)
    const meeting = restored.get(MEETING_ID)!
    expect(meeting).toMatchObject({
      durationMinutes: 45,
      location: 'Room 4B',
      allDay: false,
      recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
      participants: MEETING.participants,
      reminderMinutes: 15,
      visibility: 'team',
      linkedEntities: MEETING.linkedEntities,
      guestPermissions: MEETING.guestPermissions,
      pinned: true,
    })
    expect(meeting.recurrenceEnd).toBeInstanceOf(Date)
    expectSameDate(meeting.recurrenceEnd, MEETING.recurrenceEnd)

    const note = restored.get(NOTE_ID)!
    expect(note.title).toBe('Plain note')
    for (const key of DETAIL_KEYS) {
      if (key === 'pinned') expect(note.pinned).toBe(false)
      else expect(note[key]).toBeNull()
    }
  })

  it('takes scope from the restored record, never from the interaction entry', async () => {
    const log = await captureDeleteLog(kind, [PRIVATE_EMAIL])
    const tampered = log.payload.undo.before.interactions.map((row) => ({ ...row, organizationId: FOREIGN_ORG_ID, tenantId: FOREIGN_TENANT_ID }))
    const restored = await undoDelete(kind, tampered)
    expect(restored.get(EMAIL_ID)).toMatchObject({ organizationId: ORG_ID, tenantId: TENANT_ID })
  })

  it('rejects an unparsable recurrenceEnd instead of writing an invalid date', async () => {
    const log = await captureDeleteLog(kind, [MEETING])
    const corrupt = log.payload.undo.before.interactions.map((row) => ({ ...row, recurrenceEnd: 'not-a-date' }))
    await expect(undoDelete(kind, corrupt)).rejects.toThrow()
  })

  describe('delete logs written before the restore columns were captured', () => {
    it('restores an authored email as private and keeps the other columns at their previous defaults', async () => {
      const restored = await undoDelete(kind, roundTrip([legacySnapshot(PRIVATE_EMAIL)]))
      const email = restored.get(EMAIL_ID)!
      expect(email.visibility).toBe('private')
      expect(email.title).toBe('Contract terms')
      for (const key of DETAIL_KEYS) {
        if (key === 'visibility') continue
        if (key === 'pinned') expect(email.pinned).toBe(false)
        else expect(email[key]).toBeNull()
      }
    })

    it('restores a hand-logged authored email without a visibility key as private', async () => {
      const handLogged = legacySnapshot({ ...MEETING, interactionType: 'email', authorUserId: AUTHOR_ID })
      const restored = await undoDelete(kind, roundTrip([handLogged]))
      expect(restored.get(MEETING_ID)!.visibility).toBe('private')
    })

    it('keeps visibility null for an email without an author and for non-email interactions', async () => {
      const authorless = legacySnapshot({ ...PRIVATE_EMAIL, authorUserId: null })
      const restored = await undoDelete(kind, roundTrip([authorless, legacySnapshot(MEETING)]))
      expect(restored.get(EMAIL_ID)!.visibility).toBeNull()
      expect(restored.get(MEETING_ID)!.visibility).toBeNull()
      expect(restored.get(MEETING_ID)!.pinned).toBe(false)
    })

    it('keeps an explicitly captured null visibility null', async () => {
      const log = await captureDeleteLog(kind, [{ ...PRIVATE_EMAIL, visibility: null }])
      const restored = await undoDelete(kind, log.payload.undo.before.interactions)
      expect(restored.get(EMAIL_ID)!.visibility).toBeNull()
    })
  })
})
