jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

// Simulates the tenant-encryption afterFind/onLoad behavior (issue #2507):
// every find re-baselines the change tracking of the entities it returns
// (subscriber.syncOriginalEntityData with syncOriginal: true), so scalar
// mutations made BEFORE a query that re-selects the same managed entity are
// silently dropped at flush time. The fake EM below mirrors MikroORM's
// snapshot-diff flush so the undo handlers are exercised against the same
// semantics that made `customers.personCompanyLinks.create` undo a no-op.
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [])),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [])),
}))

import '@open-mercato/core/modules/customers/commands'
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '../../data/entities'

// Real UUIDs: the delete command validates its input with zod before executing, so the
// profile-only cases below cannot run against readable placeholder ids.
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const COMPANY_A_ID = '44444444-4444-4444-8444-444444444444'
const COMPANY_B_ID = '55555555-5555-4555-8555-555555555555'
const COMPANY_C_ID = '88888888-8888-4888-8888-888888888888'
const LINK_A_ID = '66666666-6666-4666-8666-666666666666'
const LINK_B_ID = '77777777-7777-4777-8777-777777777777'
const LINK_C_ID = '99999999-9999-4999-8999-999999999999'

type LinkRow = {
  isPrimary: boolean
  deletedAt: Date | null
  employmentStatus?: 'active' | 'ended'
  employmentEndedOn?: string | null
}
type ProfileRow = { companyId: string | null }

type Fixtures = {
  person: CustomerEntity
  companyA: CustomerEntity
  companyB: CustomerEntity
  profile: CustomerPersonProfile
  links: CustomerPersonCompanyLink[]
  linkRows: Map<string, LinkRow>
  profileRow: ProfileRow
  em: any
}

function makeCustomerEntity(id: string, kind: 'person' | 'company', displayName: string): CustomerEntity {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind,
    displayName,
    deletedAt: null,
  } as unknown as CustomerEntity
}

function makeLink(id: string, person: CustomerEntity, company: CustomerEntity, state: LinkRow): CustomerPersonCompanyLink {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    person,
    company,
    isPrimary: state.isPrimary,
    deletedAt: state.deletedAt,
    employmentStatus: state.employmentStatus ?? 'active',
    employmentEndedOn: state.employmentEndedOn ?? null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  } as unknown as CustomerPersonCompanyLink
}

function makeFixtures(linkStates: Array<{ id: string; companyId: string } & LinkRow>, profileCompanyId: string | null): Fixtures {
  const person = makeCustomerEntity(PERSON_ID, 'person', 'Jane Doe')
  const companyA = makeCustomerEntity(COMPANY_A_ID, 'company', 'Acme A')
  const companyB = makeCustomerEntity(COMPANY_B_ID, 'company', 'Acme B')
  const companyC = makeCustomerEntity(COMPANY_C_ID, 'company', 'Acme C')
  const companies = new Map([[COMPANY_A_ID, companyA], [COMPANY_B_ID, companyB], [COMPANY_C_ID, companyC]])

  const linkRows = new Map<string, LinkRow>()
  const links = linkStates.map((state) => {
    const { id, companyId, ...fields } = state
    linkRows.set(id, fields)
    return makeLink(id, person, companies.get(companyId)!, fields)
  })

  const profileRow: ProfileRow = { companyId: profileCompanyId }
  const profile = {
    id: 'profile-pcl-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity: person,
    company: profileCompanyId ? companies.get(profileCompanyId) ?? null : null,
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  } as unknown as CustomerPersonProfile

  const linkSnapshots = new Map<string, LinkRow>()
  let profileSnapshot: ProfileRow = { companyId: profileCompanyId }

  const snapshotLink = (link: CustomerPersonCompanyLink) => {
    linkSnapshots.set(link.id, {
      isPrimary: Boolean(link.isPrimary),
      deletedAt: link.deletedAt ?? null,
      employmentStatus: link.employmentStatus,
      employmentEndedOn: link.employmentEndedOn ?? null,
    })
  }
  const snapshotProfile = () => {
    const company = profile.company
    profileSnapshot = { companyId: company && typeof company !== 'string' ? company.id : null }
  }

  links.forEach(snapshotLink)
  snapshotProfile()

  const rebaseline = (entity: unknown) => {
    if (entity === profile) {
      snapshotProfile()
      return
    }
    const link = links.find((candidate) => candidate === entity)
    if (link) snapshotLink(link)
  }

  mockFindOneWithDecryption.mockImplementation(async (...args: unknown[]) => {
    const [, ctor, rawWhere] = args as [unknown, unknown, Record<string, unknown>]
    if (ctor === CustomerPersonCompanyLink) {
      const found = links.find((link) => {
        if (typeof rawWhere.id === 'string' && link.id !== rawWhere.id) return false
        const idFilter = rawWhere.id as { $in?: string[] } | undefined
        if (idFilter?.$in && !idFilter.$in.includes(link.id)) return false
        const companyId = typeof link.company === 'string' ? link.company : link.company.id
        const company = rawWhere.company as CustomerEntity | string | undefined
        if (company && companyId !== (typeof company === 'string' ? company : company.id)) return false
        const row = linkRows.get(link.id)
        if (rawWhere.deletedAt === null && row?.deletedAt != null) return false
        if (rawWhere.deletedAt && row?.deletedAt == null) return false
        if (rawWhere.employmentStatus && rawWhere.employmentStatus !== (row?.employmentStatus ?? 'active')) return false
        return true
      }) ?? null
      if (found) rebaseline(found)
      return found
    }
    if (ctor === CustomerEntity) {
      if (rawWhere.kind === 'person') return rawWhere.id === person.id ? person : null
      if (rawWhere.kind === 'company') {
        const company = companies.get(String(rawWhere.id)) ?? null
        return company
      }
      return null
    }
    if (ctor === CustomerPersonProfile) {
      rebaseline(profile)
      return profile
    }
    return null
  })

  mockFindWithDecryption.mockImplementation(async (...args: unknown[]) => {
    const [, ctor, where] = args as [unknown, unknown, Record<string, unknown>]
    if (ctor !== CustomerPersonCompanyLink) return []
    const active = links.filter((link) => {
      const row = linkRows.get(link.id)
      const idFilter = where.id as { $in?: string[] } | undefined
      return row?.deletedAt == null && (!where.employmentStatus || where.employmentStatus === (row?.employmentStatus ?? 'active'))
        && (!idFilter?.$in || idFilter.$in.includes(link.id))
    })
    active.sort((left, right) => Number(linkRows.get(right.id)?.isPrimary) - Number(linkRows.get(left.id)?.isPrimary))
    active.forEach(rebaseline)
    return active
  })

  const lockQuery = {
    selectFrom: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    forNoKeyUpdate: jest.fn().mockReturnThis(),
    executeTakeFirst: jest.fn(async () => ({ id: person.id })),
  }
  const em: any = {
    fork: jest.fn(),
    getKysely: jest.fn(() => lockQuery),
    create: jest.fn((ctor: unknown, values: Record<string, unknown>) => {
      if (ctor !== CustomerPersonCompanyLink) throw new Error('Unexpected fixture entity')
      const id = typeof values.id === 'string' ? values.id : LINK_B_ID
      const state = { isPrimary: Boolean(values.isPrimary), deletedAt: null }
      const link = makeLink(id, person, values.company as CustomerEntity, state)
      links.push(link)
      linkRows.set(id, { ...state })
      snapshotLink(link)
      return link
    }),
    persist: jest.fn(),
    isInTransaction: jest.fn(() => false),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async (ctor: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      if (ctor !== CustomerPersonCompanyLink) return 0
      let affected = 0
      for (const link of links) {
        const row = linkRows.get(link.id)!
        if (where.person && where.person !== link.person) continue
        if (where.deletedAt === null && row.deletedAt !== null) continue
        if (typeof where.id === 'string' && link.id !== where.id) continue
        if (where.id && typeof where.id === 'object') {
          const idFilter = where.id as { $ne?: string; $in?: string[] }
          if (idFilter.$ne === link.id) continue
          if (idFilter.$in && !idFilter.$in.includes(link.id)) continue
        }
        if ('isPrimary' in where && row.isPrimary !== where.isPrimary) continue
        if ('isPrimary' in data) {
          row.isPrimary = Boolean(data.isPrimary)
          if (data.updatedAt instanceof Date) link.updatedAt = data.updatedAt
          affected += 1
        }
      }
      return affected
    }),
    flush: jest.fn(async () => {
      for (const link of links) {
        const snapshot = linkSnapshots.get(link.id)!
        const row = linkRows.get(link.id)!
        const currentDeletedAt = link.deletedAt ?? null
        const currentEndedOn = link.employmentEndedOn ?? null
        if (Boolean(link.isPrimary) !== snapshot.isPrimary || currentDeletedAt !== snapshot.deletedAt
          || link.employmentStatus !== snapshot.employmentStatus || currentEndedOn !== snapshot.employmentEndedOn) {
          link.updatedAt = new Date(link.updatedAt.getTime() + 1)
        }
        if (Boolean(link.isPrimary) !== snapshot.isPrimary) row.isPrimary = Boolean(link.isPrimary)
        if (currentDeletedAt !== snapshot.deletedAt) row.deletedAt = currentDeletedAt
        if (link.employmentStatus !== snapshot.employmentStatus) row.employmentStatus = link.employmentStatus
        if (currentEndedOn !== snapshot.employmentEndedOn) row.employmentEndedOn = currentEndedOn
        snapshotLink(link)
      }
      const company = profile.company
      const currentCompanyId = company && typeof company !== 'string' ? company.id : null
      if (currentCompanyId !== profileSnapshot.companyId) {
        profileRow.companyId = currentCompanyId
        profile.updatedAt = new Date(profile.updatedAt.getTime() + 1)
      }
      snapshotProfile()
    }),
  }
  em.fork.mockReturnValue(em)

  return { person, companyA, companyB, profile, links, linkRows, profileRow, em }
}

function makeCtx(em: any, eventBus?: { emitEvent: jest.Mock }): CommandRuntimeContext {
  const dataEngine: any = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
  }
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus' && eventBus) return eventBus
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID } as any,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

function makeLinkSnapshot(linkId: string, companyId: string, isPrimary: boolean) {
  return {
    id: linkId,
    personEntityId: PERSON_ID,
    companyEntityId: companyId,
    isPrimary,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
  }
}

describe('customers.personCompanyLinks.create — repeated request undo (#7857)', () => {
  afterEach(() => jest.clearAllMocks())

  const inputFor = (companyEntityId: string, isPrimary = false) => ({
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    personEntityId: PERSON_ID,
    companyEntityId,
    isPrimary,
  })

  async function createAndLog(fixtures: Fixtures, companyId: string, isPrimary = false) {
    const handler = commandRegistry.get('customers.personCompanyLinks.create') as CommandHandler
    const input = inputFor(companyId, isPrimary)
    const ctx = makeCtx(fixtures.em)
    const before = await handler.prepare!(input, ctx)
    const result = await handler.execute(input, ctx)
    const after = await handler.captureAfter!(input, result, ctx)
    const log = await handler.buildLog!({ input, ctx, result, snapshots: { ...before, after } })
    return { handler, input, ctx, log }
  }

  it.each([true, false])('does not make an unchanged existing link undoable (primary=%s)', async (isPrimary) => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
      { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
    ], COMPANY_A_ID)
    const { log } = await createAndLog(fixtures, isPrimary ? COMPANY_A_ID : COMPANY_B_ID)

    expect(log?.skipLog).toBe(true)
    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('does not offer undo when another request creates the link after prepare', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const handler = commandRegistry.get('customers.personCompanyLinks.create') as CommandHandler
    const input = inputFor(COMPANY_B_ID)
    const ctx = makeCtx(fixtures.em)

    // Request B prepares first, then request A creates the relationship before B executes.
    const staleBefore = await handler.prepare!(input, ctx)
    expect((staleBefore.before as { link: unknown }).link).toBeNull()
    await createAndLog(fixtures, COMPANY_B_ID)

    const result = await handler.execute(input, ctx) as {
      created: boolean
      undeleted: boolean
      changed: boolean
      createBefore: { link: { id: string; deletedAt: string | null } | null }
    }
    const after = await handler.captureAfter!(input, result, ctx)
    const log = await handler.buildLog!({ input, ctx, result, snapshots: { ...staleBefore, after } })

    expect(result).toMatchObject({ created: false, undeleted: false, changed: false })
    expect(result.createBefore.link).toMatchObject({ id: LINK_B_ID, deletedAt: null })
    expect(log?.skipLog).toBe(true)
    expect(log?.payload).toBeUndefined()
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('undoes a primary promotion without deleting the existing relationship', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
      { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
    ], COMPANY_A_ID)
    const { handler, input, ctx, log } = await createAndLog(fixtures, COMPANY_B_ID, true)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)

    await handler.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })

    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      fixtures.em,
      CustomerPersonCompanyLink,
      { id: LINK_B_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('keeps a real creation undoable after an unchanged duplicate request', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const original = await createAndLog(fixtures, COMPANY_B_ID)
    const duplicate = await createAndLog(fixtures, COMPANY_B_ID)
    expect(duplicate.log?.skipLog).toBe(true)
    expect(fixtures.linkRows.get(LINK_B_ID)?.deletedAt).toBeNull()

    await original.handler.undo!({
      input: original.input,
      ctx: original.ctx,
      logEntry: { commandPayload: original.log?.payload },
    })

    expect(fixtures.linkRows.get(LINK_B_ID)?.deletedAt).toBeInstanceOf(Date)
    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('restores the prior linked primary when undoing a genuinely new primary link', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const { handler, input, ctx, log } = await createAndLog(fixtures, COMPANY_B_ID, true)
    expect(fixtures.linkRows.get(LINK_A_ID)?.isPrimary).toBe(false)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)

    await handler.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })

    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_B_ID)?.deletedAt).toBeInstanceOf(Date)
    expect(fixtures.linkRows.get(LINK_B_ID)?.isPrimary).toBe(false)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it.each([false, true])('preserves a later primary selection when undoing a creation (primary=%s)', async (isPrimary) => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
      { id: LINK_C_ID, companyId: COMPANY_C_ID, isPrimary: false, deletedAt: null },
    ], COMPANY_A_ID)
    const created = await createAndLog(fixtures, COMPANY_B_ID, isPrimary)
    const promoted = await createAndLog(fixtures, COMPANY_C_ID, true)
    expect(created.log?.resourceId).toBe(LINK_B_ID)
    expect(promoted.log?.resourceId).toBe(LINK_C_ID)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_C_ID)

    await created.handler.undo!({
      input: created.input,
      ctx: created.ctx,
      logEntry: { commandPayload: created.log?.payload },
    })

    expect(fixtures.linkRows.get(LINK_B_ID)?.deletedAt).toBeInstanceOf(Date)
    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_C_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_C_ID)
  })

  it.each([false, true])('preserves a later cleared primary assignment when undoing a creation (primary=%s)', async (isPrimary) => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const created = await createAndLog(fixtures, COMPANY_B_ID, isPrimary)
    fixtures.profile.company = null
    for (const link of fixtures.links) link.isPrimary = false
    await fixtures.em.flush()

    await created.handler.undo!({
      input: created.input,
      ctx: created.ctx,
      logEntry: { commandPayload: created.log?.payload },
    })

    expect(fixtures.linkRows.get(LINK_B_ID)?.deletedAt).toBeInstanceOf(Date)
    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBeNull()
  })

  it('restores a null profile assignment and no primary after undoing promotion', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: false, deletedAt: null },
      { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
    ], null)
    const { handler, input, ctx, log } = await createAndLog(fixtures, COMPANY_B_ID, true)

    await handler.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })

    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBeNull()
  })

  it('undoes a newly created primary and restores a profile-only assignment', async () => {
    const fixtures = makeFixtures([], COMPANY_A_ID)
    const { handler, input, ctx, log } = await createAndLog(fixtures, COMPANY_B_ID)

    await handler.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })

    expect(fixtures.linkRows.get(LINK_B_ID)?.deletedAt).toBeInstanceOf(Date)
    expect(fixtures.linkRows.get(LINK_B_ID)?.isPrimary).toBe(false)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('restores the original deletion timestamp when undoing an undelete', async () => {
    const deletedAt = new Date('2026-09-01T12:34:56Z')
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
      { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt },
    ], COMPANY_A_ID)
    const { handler, input, ctx, log } = await createAndLog(fixtures, COMPANY_B_ID, true)
    expect(fixtures.linkRows.get(LINK_B_ID)?.deletedAt).toBeNull()

    await handler.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })

    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('preserves the existing relationship through promotion undo, redo, and undo again', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
      { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
    ], COMPANY_A_ID)
    const { handler, input, ctx, log } = await createAndLog(fixtures, COMPANY_B_ID, true)
    const sourceLog = { commandPayload: log?.payload, snapshotAfter: log?.snapshotAfter }
    await handler.undo!({ input, ctx, logEntry: sourceLog })

    const before = await handler.prepare!(input, ctx)
    const result = await handler.redo!({ input, ctx, logEntry: sourceLog })
    const after = await handler.captureAfter!(input, result, ctx)
    const replayLog = await handler.buildLog!({ input, ctx, result, snapshots: { ...before, after } })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)

    await handler.undo!({ input, ctx, logEntry: { commandPayload: replayLog?.payload } })

    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })
})

describe('customers.personCompanyLinks undo — encryption re-baseline regression (#2507)', () => {
  afterEach(() => jest.clearAllMocks())

  it('create undo soft-deletes the link even when re-selecting it re-baselines change tracking', async () => {
    const fixtures = makeFixtures(
      [{ id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null }],
      COMPANY_A_ID,
    )
    const handler = commandRegistry.get('customers.personCompanyLinks.create') as CommandHandler
    expect(handler?.undo).toBeDefined()

    await handler.undo!({
      logEntry: { payload: { undo: { after: makeLinkSnapshot(LINK_A_ID, COMPANY_A_ID, true) } } },
      ctx: makeCtx(fixtures.em),
    } as any)

    const row = fixtures.linkRows.get(LINK_A_ID)!
    expect(row.deletedAt).not.toBeNull()
    expect(row.isPrimary).toBe(false)
    expect(fixtures.profileRow.companyId).toBeNull()
  })

  it('create undo promotes the remaining link to primary and persists the soft delete', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )
    const handler = commandRegistry.get('customers.personCompanyLinks.create') as CommandHandler

    await handler.undo!({
      logEntry: { payload: { undo: { after: makeLinkSnapshot(LINK_A_ID, COMPANY_A_ID, true) } } },
      ctx: makeCtx(fixtures.em),
    } as any)

    const removedRow = fixtures.linkRows.get(LINK_A_ID)!
    expect(removedRow.deletedAt).not.toBeNull()
    expect(removedRow.isPrimary).toBe(false)
    expect(fixtures.linkRows.get(LINK_B_ID)!.isPrimary).toBe(true)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)
  })

  async function promoteAndLog(fixtures: Fixtures, linkId: string) {
    const handler = commandRegistry.get('customers.personCompanyLinks.update') as CommandHandler
    const input = { linkId, tenantId: TENANT_ID, organizationId: ORG_ID, isPrimary: true }
    const ctx = makeCtx(fixtures.em)
    const before = await handler.prepare!(input, ctx)
    const result = await handler.execute(input, ctx)
    const after = await handler.captureAfter!(input, result, ctx)
    const log = await handler.buildLog!({ input, ctx, result, snapshots: { ...before, after } })

    return () => handler.undo!({
      logEntry: log as Parameters<NonNullable<CommandHandler['undo']>>[0]['logEntry'],
      ctx,
    })
  }

  it('update undo restores the former primary company and keeps both links', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )

    const undo = await promoteAndLog(fixtures, LINK_B_ID)
    const lockQuery = fixtures.em.getKysely.mock.results[0].value
    expect(lockQuery.selectFrom).toHaveBeenCalledWith('customer_entities')
    expect(lockQuery.where.mock.calls).toEqual([
      ['id', '=', PERSON_ID],
      ['kind', '=', 'person'],
      ['tenant_id', '=', TENANT_ID],
      ['organization_id', '=', ORG_ID],
      ['deleted_at', 'is', null],
    ])
    const promotionProfileRead = mockFindOneWithDecryption.mock.calls.findIndex(
      ([, entity]) => entity === CustomerPersonProfile,
    )
    expect(lockQuery.forNoKeyUpdate).toHaveBeenCalledTimes(1)
    expect(lockQuery.executeTakeFirst.mock.invocationCallOrder[0])
      .toBeLessThan(mockFindOneWithDecryption.mock.invocationCallOrder[promotionProfileRead])
    expect(fixtures.linkRows.get(LINK_A_ID)?.isPrimary).toBe(false)
    expect(fixtures.linkRows.get(LINK_B_ID)?.isPrimary).toBe(true)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)

    mockFindOneWithDecryption.mockClear()
    await undo()
    expect(lockQuery.forNoKeyUpdate).toHaveBeenCalledTimes(2)
    expect(lockQuery.executeTakeFirst.mock.invocationCallOrder[1])
      .toBeLessThan(mockFindOneWithDecryption.mock.invocationCallOrder[0])
    expect(mockFindOneWithDecryption).toHaveBeenNthCalledWith(
      2,
      fixtures.em,
      CustomerPersonCompanyLink,
      { id: LINK_B_ID, person: PERSON_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: true, deletedAt: null })
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it.each([
    ['empty', null],
    ['profile-only', COMPANY_A_ID],
  ])('update undo restores the %s assignment when there was no primary link', async (_name, previousCompanyId) => {
    const fixtures = makeFixtures(
      [{ id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null }],
      previousCompanyId,
    )

    const undo = await promoteAndLog(fixtures, LINK_B_ID)
    await undo()

    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBe(previousCompanyId)
  })

  it('update undo preserves a newer primary selection', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
        { id: LINK_C_ID, companyId: COMPANY_C_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )

    const undo = await promoteAndLog(fixtures, LINK_B_ID)
    await promoteAndLog(fixtures, LINK_C_ID)
    await undo()

    expect(fixtures.linkRows.get(LINK_A_ID)?.isPrimary).toBe(false)
    expect(fixtures.linkRows.get(LINK_B_ID)?.isPrimary).toBe(false)
    expect(fixtures.linkRows.get(LINK_C_ID)?.isPrimary).toBe(true)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_C_ID)
  })

  it('update undo does not restore a removed company relationship', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )

    const undo = await promoteAndLog(fixtures, LINK_B_ID)
    const deletedAt = new Date('2026-06-02T00:00:00Z')
    const removedLink = fixtures.links.find((link) => link.id === LINK_A_ID)!
    removedLink.deletedAt = deletedAt
    await fixtures.em.flush()
    await undo()

    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ isPrimary: false, deletedAt })
    expect(fixtures.linkRows.get(LINK_B_ID)).toEqual({ isPrimary: false, deletedAt: null })
    expect(fixtures.profileRow.companyId).toBeNull()
  })

  it('update undo restores the primary flag and the legacy profile company', async () => {
    const fixtures = makeFixtures(
      [{ id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: false, deletedAt: null }],
      null,
    )
    const handler = commandRegistry.get('customers.personCompanyLinks.update') as CommandHandler
    expect(handler?.undo).toBeDefined()

    await handler.undo!({
      logEntry: { payload: { undo: { before: makeLinkSnapshot(LINK_A_ID, COMPANY_A_ID, true) } } },
      ctx: makeCtx(fixtures.em),
    } as any)

    const row = fixtures.linkRows.get(LINK_A_ID)!
    expect(row.isPrimary).toBe(true)
    expect(row.deletedAt).toBeNull()
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('delete undo restores the soft-deleted link and its primary flag', async () => {
    const deletedAt = new Date('2026-06-02T00:00:00Z')
    const fixtures = makeFixtures(
      [{ id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: false, deletedAt }],
      null,
    )
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler
    expect(handler?.undo).toBeDefined()

    await handler.undo!({
      logEntry: { payload: { undo: { before: makeLinkSnapshot(LINK_A_ID, COMPANY_A_ID, true) } } },
      ctx: makeCtx(fixtures.em),
    } as any)

    const row = fixtures.linkRows.get(LINK_A_ID)!
    expect(row.deletedAt).toBeNull()
    expect(row.isPrimary).toBe(true)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })
})

describe('customers.personCompanyLinks — one primary link per person under concurrent promotions', () => {
  afterEach(() => jest.clearAllMocks())

  function onPersonRowLock(fixtures: Fixtures, onLock: () => void): jest.Mock {
    const lockCalls = jest.fn()
    const lockQuery = fixtures.em.getKysely()
    const execute = lockQuery.executeTakeFirst.getMockImplementation()
    lockQuery.executeTakeFirst.mockImplementation(async () => {
      lockCalls(fixtures.em.nativeUpdate.mock.calls.length)
      onLock()
      return execute()
    })
    return lockCalls
  }

  function primaryLinkIds(fixtures: Fixtures): string[] {
    return [...fixtures.linkRows.entries()].filter(([, row]) => row.isPrimary).map(([id]) => id)
  }

  it('locks the person row before clearing other primary links on update', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )
    const lockCalls = onPersonRowLock(fixtures, () => {})
    const handler = commandRegistry.get('customers.personCompanyLinks.update') as CommandHandler

    await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, linkId: LINK_B_ID, isPrimary: true }, makeCtx(fixtures.em))

    expect(lockCalls).toHaveBeenCalledTimes(1)
    expect(lockCalls).toHaveBeenCalledWith(0)
    expect(primaryLinkIds(fixtures)).toEqual([LINK_B_ID])
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)
  })

  it('clears a primary link committed by a concurrent request while waiting for the person lock', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
        { id: LINK_C_ID, companyId: COMPANY_C_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )
    const lockCalls = onPersonRowLock(fixtures, () => {
      fixtures.linkRows.get(LINK_A_ID)!.isPrimary = false
      fixtures.linkRows.get(LINK_B_ID)!.isPrimary = true
    })
    const handler = commandRegistry.get('customers.personCompanyLinks.update') as CommandHandler

    await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, linkId: LINK_C_ID, isPrimary: true }, makeCtx(fixtures.em))

    expect(lockCalls).toHaveBeenCalledTimes(1)
    expect(primaryLinkIds(fixtures)).toEqual([LINK_C_ID])
  })

  it('refuses the promotion with 404 when the person is gone by the time it is locked', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )
    fixtures.em.getKysely().executeTakeFirst.mockResolvedValue(undefined)
    const handler = commandRegistry.get('customers.personCompanyLinks.update') as CommandHandler

    await expect(
      handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, linkId: LINK_B_ID, isPrimary: true }, makeCtx(fixtures.em)),
    ).rejects.toMatchObject({ status: 404 })
    expect(fixtures.em.nativeUpdate).not.toHaveBeenCalled()
    expect(primaryLinkIds(fixtures)).toEqual([LINK_A_ID])
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('keeps the target primary when its in-memory flag is stale after a concurrent promotion', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )
    onPersonRowLock(fixtures, () => {
      fixtures.linkRows.get(LINK_A_ID)!.isPrimary = false
      fixtures.linkRows.get(LINK_B_ID)!.isPrimary = true
    })
    const handler = commandRegistry.get('customers.personCompanyLinks.update') as CommandHandler

    await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, linkId: LINK_A_ID, isPrimary: true }, makeCtx(fixtures.em))

    expect(primaryLinkIds(fixtures)).toEqual([LINK_A_ID])
  })

  it('keeps the current primary link primary when it is promoted again', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )
    const handler = commandRegistry.get('customers.personCompanyLinks.update') as CommandHandler

    await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, linkId: LINK_A_ID, isPrimary: true }, makeCtx(fixtures.em))

    expect(primaryLinkIds(fixtures)).toEqual([LINK_A_ID])
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('locks the person row before restoring a primary link on delete undo', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: false, deletedAt: new Date('2026-06-02T00:00:00Z') },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_B_ID,
    )
    const lockCalls = onPersonRowLock(fixtures, () => {
      fixtures.linkRows.get(LINK_B_ID)!.isPrimary = true
    })
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler

    await handler.undo!({
      logEntry: { payload: { undo: { before: makeLinkSnapshot(LINK_A_ID, COMPANY_A_ID, true) } } },
      ctx: makeCtx(fixtures.em),
    } as unknown as Parameters<NonNullable<CommandHandler['undo']>>[0])

    expect(lockCalls).toHaveBeenCalledWith(0)
    expect(primaryLinkIds(fixtures)).toEqual([LINK_A_ID])
    expect(fixtures.linkRows.get(LINK_A_ID)!.deletedAt).toBeNull()
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('locks the person row before promoting an existing link on create', async () => {
    const fixtures = makeFixtures(
      [
        { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
        { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
        { id: LINK_C_ID, companyId: COMPANY_C_ID, isPrimary: false, deletedAt: null },
      ],
      COMPANY_A_ID,
    )
    const lockCalls = onPersonRowLock(fixtures, () => {
      fixtures.linkRows.get(LINK_A_ID)!.isPrimary = false
      fixtures.linkRows.get(LINK_C_ID)!.isPrimary = true
    })
    const handler = commandRegistry.get('customers.personCompanyLinks.create') as CommandHandler

    await handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, personEntityId: PERSON_ID, companyEntityId: COMPANY_B_ID, isPrimary: true },
      makeCtx(fixtures.em),
    )

    expect(lockCalls).toHaveBeenCalledWith(0)
    expect(primaryLinkIds(fixtures)).toEqual([LINK_B_ID])
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)
  })
})

// A legacy profile-only association sets `customer_person_profiles.company_id` with no
// backing link row (migrated CRM data). Detaching it must run through the same command as
// a link-backed detach so it earns the audit entry, the undo token and — via the
// `customers.personCompanyLink` resource kind on the log — the CRUD cache invalidation
// that keeps the company People badge in sync with the People list (#5114).
describe('customers.personCompanyLinks.delete — profile-only assignment (#5114)', () => {
  afterEach(() => jest.clearAllMocks())

  function profileOnlyInput(companyId: string) {
    return {
      personEntityId: PERSON_ID,
      companyEntityId: companyId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    }
  }

  it('clears the legacy company assignment and reindexes the person', async () => {
    const fixtures = makeFixtures([], COMPANY_A_ID)
    const eventBus = { emitEvent: jest.fn(async () => {}) }
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler

    const result = await handler.execute(profileOnlyInput(COMPANY_A_ID), makeCtx(fixtures.em, eventBus))

    expect(result).toEqual({ linkId: null, personEntityId: PERSON_ID, companyEntityId: COMPANY_A_ID })
    expect(fixtures.profileRow.companyId).toBeNull()
    // No link row exists to reindex, so the changed record is the person itself.
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'query_index.upsert_one',
      expect.objectContaining({ recordId: PERSON_ID, crudAction: 'updated' }),
      expect.anything(),
    )
  })

  // The link-backed branch broadcasts `customers.person_company_link.deleted` through
  // `emitCrudSideEffects`, which is the only event the company People tab and the person
  // Companies tab subscribe to. A profile-only detach has no link row to emit that for, so
  // without this sibling broadcast every OTHER open viewer keeps listing a detached person.
  it('broadcasts the profile-only detach so other viewers live-refresh', async () => {
    const fixtures = makeFixtures([], COMPANY_A_ID)
    const eventBus = { emitEvent: jest.fn(async () => {}) }
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler

    await handler.execute(profileOnlyInput(COMPANY_A_ID), makeCtx(fixtures.em, eventBus))

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'customers.person.company_assignment.detached',
      {
        linkId: null,
        personEntityId: PERSON_ID,
        companyEntityId: COMPANY_A_ID,
        // The event bus only forwards a broadcast event cross-process when the payload
        // itself carries a tenant scope, so these two keys are load-bearing, not decoration.
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('still completes the detach when the refresh broadcast fails', async () => {
    const fixtures = makeFixtures([], COMPANY_A_ID)
    const eventBus = {
      emitEvent: jest.fn(async (event: string) => {
        if (event === 'customers.person.company_assignment.detached') {
          throw new Error('bus unavailable')
        }
      }),
    }
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler

    const result = await handler.execute(profileOnlyInput(COMPANY_A_ID), makeCtx(fixtures.em, eventBus))

    expect(result).toEqual({ linkId: null, personEntityId: PERSON_ID, companyEntityId: COMPANY_A_ID })
    expect(fixtures.profileRow.companyId).toBeNull()
  })

  it('promotes a remaining primary link instead of leaving the person company-less', async () => {
    const fixtures = makeFixtures(
      [{ id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: true, deletedAt: null }],
      COMPANY_A_ID,
    )
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler

    await handler.execute(profileOnlyInput(COMPANY_A_ID), makeCtx(fixtures.em, { emitEvent: jest.fn(async () => {}) }))

    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)
    expect(fixtures.linkRows.get(LINK_B_ID)!.deletedAt).toBeNull()
  })

  it('rejects a detach for a company the profile is not assigned to', async () => {
    const fixtures = makeFixtures([], COMPANY_A_ID)
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler

    await expect(
      handler.execute(profileOnlyInput(COMPANY_B_ID), makeCtx(fixtures.em, { emitEvent: jest.fn(async () => {}) })),
    ).rejects.toMatchObject({
      status: 404,
    })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('logs the detach under the person-company-link resource kind so the cached badge is invalidated', async () => {
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler
    const before = {
      kind: 'profile-only' as const,
      personEntityId: PERSON_ID,
      companyEntityId: COMPANY_A_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    }

    const log = await handler.buildLog!({
      input: profileOnlyInput(COMPANY_A_ID),
      result: { linkId: null, personEntityId: PERSON_ID, companyEntityId: COMPANY_A_ID },
      snapshots: { before },
    } as any)

    expect(log.resourceKind).toBe('customers.personCompanyLink')
    expect(log.parentResourceKind).toBe('customers.person')
    expect(log.parentResourceId).toBe(PERSON_ID)
    expect((log.payload as any).undo.before).toEqual(before)
  })

  it('undo restores the legacy company assignment', async () => {
    const fixtures = makeFixtures([], null)
    const handler = commandRegistry.get('customers.personCompanyLinks.delete') as CommandHandler

    await handler.undo!({
      logEntry: {
        payload: {
          undo: {
            before: {
              kind: 'profile-only',
              personEntityId: PERSON_ID,
              companyEntityId: COMPANY_A_ID,
              tenantId: TENANT_ID,
              organizationId: ORG_ID,
            },
          },
        },
      },
      ctx: makeCtx(fixtures.em, { emitEvent: jest.fn(async () => {}) }),
    } as any)

    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })
})

describe('customers.personCompanyLinks.endEmployment', () => {
  const input = {
    personEntityId: PERSON_ID,
    companyEntityId: COMPANY_A_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    endedOn: '2024-02-29',
  }
  const end = commandRegistry.get('customers.personCompanyLinks.endEmployment') as CommandHandler
  const create = commandRegistry.get('customers.personCompanyLinks.create') as CommandHandler

  async function endAndLog(fixtures: Fixtures) {
    const ctx = makeCtx(fixtures.em)
    const result = await end.execute(input, ctx)
    const log = await end.buildLog!({ input, ctx, result, snapshots: {} })
    return { ctx, logEntry: log as unknown as CommandUndoLogEntry }
  }

  async function createAndLog(ctx: CommandRuntimeContext, createInput: typeof input & { isPrimary?: boolean }) {
    const result = await create.execute(createInput, ctx)
    const after = await create.captureAfter!(createInput, result, ctx)
    const log = await create.buildLog!({ input: createInput, ctx, result, snapshots: { after } })
    return log as unknown as CommandUndoLogEntry
  }

  it('keeps the link, promotes an active fallback, and restores both on undo', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
      { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null },
    ], COMPANY_A_ID)
    const { ctx, logEntry } = await endAndLog(fixtures)

    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({
      employmentStatus: 'ended', employmentEndedOn: input.endedOn, isPrimary: false, deletedAt: null,
    })
    expect(fixtures.linkRows.get(LINK_B_ID)?.isPrimary).toBe(true)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)

    await end.undo!({ input, ctx, logEntry })
    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({ employmentStatus: 'active', isPrimary: true, employmentEndedOn: null })
    expect(fixtures.linkRows.get(LINK_B_ID)?.isPrimary).toBe(false)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)
  })

  it('reuses a legacy assignment’s materialized link on redo', async () => {
    const fixtures = makeFixtures([], COMPANY_A_ID)
    const { ctx, logEntry } = await endAndLog(fixtures)
    const linkId = logEntry.resourceId!

    expect(fixtures.linkRows.get(linkId)?.employmentStatus).toBe('ended')
    expect(fixtures.profileRow.companyId).toBeNull()

    await end.undo!({ input, ctx, logEntry })
    expect(fixtures.linkRows.get(linkId)?.deletedAt).toBeInstanceOf(Date)
    expect(fixtures.profileRow.companyId).toBe(COMPANY_A_ID)

    await expect(end.redo!({ input, ctx, logEntry })).resolves.toMatchObject({ linkId })
    expect(fixtures.linkRows.size).toBe(1)
    expect(fixtures.linkRows.get(linkId)).toMatchObject({ deletedAt: null, employmentStatus: 'ended' })
  })

  it('reactivates the same row with its last date and rejects a stale end undo', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const { ctx, logEntry } = await endAndLog(fixtures)

    await expect(create.execute(input, ctx)).resolves.toMatchObject({ linkId: LINK_A_ID, created: false })
    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({
      employmentStatus: 'active', employmentEndedOn: input.endedOn, isPrimary: true,
    })
    await expect(end.undo!({ input, ctx, logEntry })).rejects.toMatchObject({ status: 409 })
  })

  it('rejects a stale link version without changing history', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const ctx = makeCtx(fixtures.em)
    ctx.request = new Request('http://localhost', { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: '2025-01-01T00:00:00Z' } })

    await expect(end.execute(input, ctx)).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    expect(fixtures.linkRows.get(LINK_A_ID)).toEqual({ deletedAt: null, isPrimary: true })
  })

  it('rejects undo of an older reactivation after a later departure and rejoin', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const { ctx } = await endAndLog(fixtures)
    const logEntry = await createAndLog(ctx, input)
    const nextDeparture = { ...input, endedOn: '2025-04-01' }
    await end.execute(nextDeparture, ctx)
    await create.execute(input, ctx)

    await expect(create.undo!({ input, ctx, logEntry })).rejects.toMatchObject({ status: 409 })
    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({ employmentStatus: 'active', employmentEndedOn: nextDeparture.endedOn })
  })

  it('does not restore a prior primary association that ended after reactivation', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
      { id: LINK_B_ID, companyId: COMPANY_B_ID, isPrimary: false, deletedAt: null, employmentStatus: 'ended', employmentEndedOn: '2024-01-15' },
    ], COMPANY_A_ID)
    const ctx = makeCtx(fixtures.em)
    const reactivate = { ...input, companyEntityId: COMPANY_B_ID, isPrimary: true }
    const logEntry = await createAndLog(ctx, reactivate)
    await end.execute(input, ctx)

    await expect(create.undo!({ input: reactivate, ctx, logEntry })).rejects.toMatchObject({ status: 409 })
    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({ employmentStatus: 'ended', isPrimary: false })
    expect(fixtures.profileRow.companyId).toBe(COMPANY_B_ID)
  })

  it('rejects old redo after the association gained a newer departure date', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const { ctx, logEntry } = await endAndLog(fixtures)
    await end.undo!({ input, ctx, logEntry })
    const nextDeparture = { ...input, endedOn: '2025-04-01' }
    await end.execute(nextDeparture, ctx)
    await create.execute(input, ctx)

    await expect(end.redo!({ input, ctx, logEntry })).rejects.toMatchObject({ status: 409 })
    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({ employmentStatus: 'active', employmentEndedOn: nextDeparture.endedOn })
  })

  it('rejects an old redo even when a later employment cycle used the same date', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null, employmentEndedOn: input.endedOn },
    ], COMPANY_A_ID)
    const { ctx, logEntry } = await endAndLog(fixtures)
    await end.undo!({ input, ctx, logEntry })
    const undoneLog = { ...logEntry, updatedAt: fixtures.links[0].updatedAt }
    await end.execute(input, ctx)
    await create.execute(input, ctx)

    await expect(end.redo!({ input, ctx, logEntry: undoneLog })).rejects.toMatchObject({ status: 409 })
    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({ employmentStatus: 'active', employmentEndedOn: input.endedOn })
  })

  it('preserves the departure when undoing a link from a legacy create log', async () => {
    const fixtures = makeFixtures([
      { id: LINK_A_ID, companyId: COMPANY_A_ID, isPrimary: true, deletedAt: null },
    ], COMPANY_A_ID)
    const { ctx } = await endAndLog(fixtures)
    const oldLog = { payload: { undo: { after: makeLinkSnapshot(LINK_A_ID, COMPANY_A_ID, true) } } } as CommandUndoLogEntry

    await expect(create.undo!({ input, ctx, logEntry: oldLog })).rejects.toMatchObject({ status: 409 })
    expect(fixtures.linkRows.get(LINK_A_ID)).toMatchObject({ deletedAt: null, employmentStatus: 'ended' })
  })
})
