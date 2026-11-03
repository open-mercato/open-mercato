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
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
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
const LINK_A_ID = '66666666-6666-4666-8666-666666666666'
const LINK_B_ID = '77777777-7777-4777-8777-777777777777'

type LinkRow = { isPrimary: boolean; deletedAt: Date | null }
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
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  } as unknown as CustomerPersonCompanyLink
}

function makeFixtures(linkStates: Array<{ id: string; companyId: string } & LinkRow>, profileCompanyId: string | null): Fixtures {
  const person = makeCustomerEntity(PERSON_ID, 'person', 'Jane Doe')
  const companyA = makeCustomerEntity(COMPANY_A_ID, 'company', 'Acme A')
  const companyB = makeCustomerEntity(COMPANY_B_ID, 'company', 'Acme B')
  const companies = new Map([[COMPANY_A_ID, companyA], [COMPANY_B_ID, companyB]])

  const linkRows = new Map<string, LinkRow>()
  const links = linkStates.map((state) => {
    linkRows.set(state.id, { isPrimary: state.isPrimary, deletedAt: state.deletedAt })
    return makeLink(state.id, person, companies.get(state.companyId)!, state)
  })

  const profileRow: ProfileRow = { companyId: profileCompanyId }
  const profile = {
    id: 'profile-pcl-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity: person,
    company: profileCompanyId ? companies.get(profileCompanyId) ?? null : null,
  } as unknown as CustomerPersonProfile

  const linkSnapshots = new Map<string, LinkRow>()
  let profileSnapshot: ProfileRow = { companyId: profileCompanyId }

  const snapshotLink = (link: CustomerPersonCompanyLink) => {
    linkSnapshots.set(link.id, {
      isPrimary: Boolean(link.isPrimary),
      deletedAt: link.deletedAt ?? null,
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
      const found = links.find((link) => link.id === rawWhere.id) ?? null
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
    const [, ctor] = args as [unknown, unknown]
    if (ctor !== CustomerPersonCompanyLink) return []
    const active = links.filter((link) => linkRows.get(link.id)?.deletedAt == null)
    active.sort((left, right) => Number(linkRows.get(right.id)?.isPrimary) - Number(linkRows.get(left.id)?.isPrimary))
    active.forEach(rebaseline)
    return active
  })

  const em: any = {
    fork: jest.fn(),
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
        if ('isPrimary' in where && row.isPrimary !== where.isPrimary) continue
        if ('isPrimary' in data) {
          row.isPrimary = Boolean(data.isPrimary)
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
        if (Boolean(link.isPrimary) !== snapshot.isPrimary) row.isPrimary = Boolean(link.isPrimary)
        if (currentDeletedAt !== snapshot.deletedAt) row.deletedAt = currentDeletedAt
        snapshotLink(link)
      }
      const company = profile.company
      const currentCompanyId = company && typeof company !== 'string' ? company.id : null
      if (currentCompanyId !== profileSnapshot.companyId) profileRow.companyId = currentCompanyId
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
