jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (em: { find: (entity: unknown, where: unknown) => Promise<unknown> }, entity: unknown, where: unknown) => em.find(entity, where)),
  findOneWithDecryption: jest.fn(async (...args: unknown[]) => {
    const [em, entity, where, options] = args as [
      { findOne: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown> },
      unknown,
      unknown,
      unknown,
    ]
    return em.findOne(entity, where, options)
  }),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerEntity, CustomerPersonCompanyLink, CustomerPersonProfile } from '../../data/entities'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '44444444-4444-4444-8444-444444444444'
const FIRST_COMPANY_ID = '55555555-5555-4555-8555-555555555555'
const SECOND_COMPANY_ID = '66666666-6666-4666-8666-666666666666'
const LOADED_VERSION = new Date('2026-01-01T10:00:00.000Z')

function makePerson(): CustomerEntity {
  return {
    id: PERSON_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: 'Jane Doe',
    isActive: true,
    createdAt: LOADED_VERSION,
    updatedAt: LOADED_VERSION,
    deletedAt: null,
  } as unknown as CustomerEntity
}

function makeProfile(): CustomerPersonProfile {
  return {
    id: 'profile-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    firstName: 'Jane',
    lastName: 'Doe',
    preferredName: null,
    jobTitle: null,
    department: null,
    seniority: null,
    timezone: null,
    linkedInUrl: null,
    twitterUrl: null,
  } as unknown as CustomerPersonProfile
}

function makeEm(person: CustomerEntity, profile: CustomerPersonProfile) {
  const em: Record<string, unknown> = {
    fork: jest.fn(() => em),
    findOne: jest.fn(async (ctor: unknown) => {
      if (ctor === CustomerEntity) return person
      if (ctor === CustomerPersonProfile) return profile
      return null
    }),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (fn: (inner: unknown) => unknown) => fn(em)),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
  }
  return em
}

function makeCtx(em: Record<string, unknown>): CommandRuntimeContext {
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    container: {
      resolve: (token: string): unknown => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
        throw new Error(`Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as unknown as CommandRuntimeContext
}

async function runUpdate(input: Record<string, unknown>) {
  const person = makePerson()
  const profile = makeProfile()
  const ctx = makeCtx(makeEm(person, profile))
  const handler = commandRegistry.get('customers.people.update') as CommandHandler
  const result = (await handler.execute({ id: PERSON_ID, ...input }, ctx)) as { updatedAt: Date }
  return { person, profile, result }
}

describe('customers.people.update — optimistic-lock version (#8643)', () => {
  it('advances updatedAt when only profile fields change', async () => {
    const { person, profile } = await runUpdate({ department: 'Engineering' })

    expect(profile.department).toBe('Engineering')
    expect(person.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('advances updatedAt when only custom fields change', async () => {
    const { person } = await runUpdate({ cf_priority: 'high' })

    expect(person.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('advances updatedAt when only tags change', async () => {
    const { person } = await runUpdate({ tags: [] })

    expect(person.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('leaves updatedAt alone when no profile, custom field, or tag is submitted', async () => {
    const { person } = await runUpdate({})

    expect(person.updatedAt).toBe(LOADED_VERSION)
  })

  it('advances updatedAt when undo restores only profile fields (#7042)', async () => {
    const person = makePerson()
    const profile = { ...makeProfile(), company: null, jobTitle: 'Team Lead' }
    const ctx = makeCtx(makeEm(person, profile))
    const handler = commandRegistry.get('customers.people.update') as CommandHandler
    const before = {
      entity: { ...person },
      profile: { ...profile, jobTitle: 'Engineer' },
      tagIds: [],
      custom: {},
    }

    await handler.undo!({ logEntry: { commandPayload: { undo: { before, after: null } } }, ctx } as never)

    expect(profile.jobTitle).toBe('Engineer')
    expect(person.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })
})

describe('customers.people.update — employment link replay', () => {
  function makeEmploymentFixture(employmentStatus: CustomerPersonCompanyLink['employmentStatus'] = 'ended') {
    const person = makePerson()
    const firstCompany = Object.assign(new CustomerEntity(), { id: FIRST_COMPANY_ID, kind: 'company', tenantId: TENANT_ID, organizationId: ORG_ID })
    const secondCompany = Object.assign(new CustomerEntity(), { id: SECOND_COMPANY_ID, kind: 'company', tenantId: TENANT_ID, organizationId: ORG_ID })
    const profile = Object.assign(makeProfile(), { company: null, department: 'After edit' })
    const link = Object.assign(new CustomerPersonCompanyLink(), {
      id: 'first-company-link', person, company: firstCompany, employmentStatus,
      employmentEndedOn: employmentStatus === 'ended' ? '2026-11-15' : null,
    })
    const em = makeEm(person, profile)
    em.findOne = jest.fn(async (entity: unknown, where: { id?: string; employmentStatus?: string }) => {
      if (entity === CustomerPersonProfile) return profile
      if (entity === CustomerPersonCompanyLink && (!where.employmentStatus || where.employmentStatus === link.employmentStatus)) return link
      if (entity !== CustomerEntity) return null
      if (where.id === FIRST_COMPANY_ID) return firstCompany
      if (where.id === SECOND_COMPANY_ID) return secondCompany
      return person
    })
    em.find = jest.fn(async (entity: unknown, where: { employmentStatus?: string }) =>
      entity === CustomerPersonCompanyLink && where.employmentStatus === link.employmentStatus ? [link] : [],
    )
    em.nativeUpdate = jest.fn(async () => 0)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.update') as CommandHandler
    const snapshot = (companyEntityId: string | null, department: string) => ({
      entity: { ...person }, profile: { ...profile, companyEntityId, department }, tagIds: [], custom: {},
    })
    return { ctx, em, handler, link, firstCompany, profile, snapshot }
  }

  it.each([undefined, FIRST_COMPANY_ID])('undoes an unrelated person edit with company input %s without reactivating an ended company', async (companyEntityId) => {
    const { ctx, handler, link, profile, snapshot } = makeEmploymentFixture()
    const commandPayload = {
      __redoInput: { id: PERSON_ID, department: 'After edit', ...(companyEntityId ? { companyEntityId } : {}) },
      undo: { before: snapshot(FIRST_COMPANY_ID, 'Before edit'), after: snapshot(null, 'After edit') },
    }

    await handler.undo!({ input: commandPayload, logEntry: { commandPayload }, ctx })

    expect(profile.department).toBe('Before edit')
    expect(profile.company).toBeNull()
    expect(link.employmentStatus).toBe('ended')
  })

  it('preserves active company undo for a legacy payload without an after snapshot', async () => {
    const { ctx, handler, link, firstCompany, profile, snapshot } = makeEmploymentFixture('active')
    const commandPayload = {
      __redoInput: { id: PERSON_ID, companyEntityId: SECOND_COMPANY_ID },
      undo: { before: snapshot(FIRST_COMPANY_ID, 'Before edit') },
    }

    await handler.undo!({ input: commandPayload, logEntry: { commandPayload }, ctx })

    expect(profile.company).toBe(firstCompany)
    expect(link.isPrimary).toBe(true)
  })

  it('rejects undo of a real company edit after an affected employment ended', async () => {
    const { ctx, em, handler, profile, snapshot } = makeEmploymentFixture()
    const commandPayload = {
      undo: { before: snapshot(FIRST_COMPANY_ID, 'Before edit'), after: snapshot(SECOND_COMPANY_ID, 'After edit') },
    }

    await expect(handler.undo!({ input: commandPayload, logEntry: { commandPayload }, ctx })).rejects.toMatchObject({
      status: 409, body: { error: 'customers.errors.person_company_employment_changed' },
    })
    expect(profile.department).toBe('After edit')
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('redoes an edit with an unchanged company field without reactivating the old link', async () => {
    const { ctx, handler, link, profile, snapshot } = makeEmploymentFixture()
    const commandPayload = {
      undo: { before: snapshot(FIRST_COMPANY_ID, 'Before edit'), after: snapshot(FIRST_COMPANY_ID, 'Other department') },
    }

    await handler.redo!({ input: { id: PERSON_ID, companyEntityId: FIRST_COMPANY_ID, department: 'Other department' }, logEntry: { commandPayload }, ctx })

    expect(profile.department).toBe('Other department')
    expect(profile.company).toBeNull()
    expect(link.employmentStatus).toBe('ended')
  })

  it('rejects redo of a company edit when the company was ended by a later command', async () => {
    const { ctx, handler, profile, snapshot } = makeEmploymentFixture()
    const commandPayload = {
      undo: { before: snapshot(SECOND_COMPANY_ID, 'Before edit'), after: snapshot(FIRST_COMPANY_ID, 'Other department') },
    }

    await expect(handler.redo!({ input: { id: PERSON_ID, companyEntityId: FIRST_COMPANY_ID, department: 'Other department' }, logEntry: { commandPayload }, ctx })).rejects.toMatchObject({ status: 409 })
    expect(profile.department).toBe('After edit')
  })

  it('redoes a recorded reactivation after its undo restores the original ended link', async () => {
    const { ctx, handler, link, firstCompany, profile, snapshot } = makeEmploymentFixture()
    link.updatedAt = new Date('2026-11-16T12:00:00.000Z')
    const recordedLink = {
      id: link.id,
      companyId: FIRST_COMPANY_ID,
      employmentEndedOn: link.employmentEndedOn,
    }
    const commandPayload = {
      undo: {
        before: { ...snapshot(null, 'Before edit'), companyEmploymentLinks: [{ ...recordedLink, employmentStatus: 'ended' }] },
        after: { ...snapshot(FIRST_COMPANY_ID, 'After edit'), companyEmploymentLinks: [{ ...recordedLink, employmentStatus: 'active' }] },
      },
    }

    await handler.redo!({
      input: { id: PERSON_ID, companyEntityId: FIRST_COMPANY_ID },
      logEntry: { commandPayload, updatedAt: new Date('2026-11-16T12:00:01.000Z') },
      ctx,
    })

    expect(profile.company).toBe(firstCompany)
    expect(link).toMatchObject({ employmentStatus: 'active', employmentEndedOn: '2026-11-15' })
  })
})
