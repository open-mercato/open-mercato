/** @jest-environment node */

import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const registeredHandlers = new Map<string, CommandHandler<any, any>>()
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: jest.fn((handler: CommandHandler<any, any>) => {
    registeredHandlers.set(handler.id, handler)
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

import '../entries'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgAId = '22222222-2222-4222-8222-222222222222'
const orgBId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'
const entryId = '55555555-5555-4555-8555-555555555555'

function buildEm() {
  const em = {
    fork: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function buildCtx(em: ReturnType<typeof buildEm>, overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        return null
      }),
    } as unknown as CommandRuntimeContext['container'],
    auth: {
      sub: 'admin-1',
      tenantId,
      orgId: orgAId,
      isSuperAdmin: true,
    } as CommandRuntimeContext['auth'],
    organizationScope: {
      tenantId,
      selectedId: orgBId,
      filterIds: [orgBId],
      allowedIds: null,
    },
    selectedOrganizationId: orgBId,
    organizationIds: [orgBId],
    ...overrides,
  }
}

describe('dictionaries.entries commands selected-organization enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scopes dictionaries.entries.create lookup to selectedOrganizationId and returns 404 for another org dictionary even for superadmin', async () => {
    const createHandler = registeredHandlers.get('dictionaries.entries.create')
    expect(createHandler).toBeDefined()

    const em = buildEm()
    em.findOne.mockResolvedValueOnce(null)
    const ctx = buildCtx(em)

    await expect(
      createHandler!.execute({ dictionaryId, value: 'red', label: 'Red' }, ctx),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<CrudHttpError>)

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: dictionaryId,
        deletedAt: null,
        tenantId,
        organizationId: orgBId,
      },
    )
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects dictionaries.entries.create with 403 when organizationScope.selectionRejected is true', async () => {
    const createHandler = registeredHandlers.get('dictionaries.entries.create')
    const em = buildEm()
    const ctx = buildCtx(em, {
      organizationScope: {
        tenantId,
        selectedId: orgAId,
        filterIds: [orgAId],
        allowedIds: [orgAId],
        selectionRejected: true,
      },
    })

    await expect(
      createHandler!.execute({ dictionaryId, value: 'red', label: 'Red' }, ctx),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<CrudHttpError>)
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('rejects dictionaries.entries.update with 404 when entry belongs to Org A while Org B is selected', async () => {
    const updateHandler = registeredHandlers.get('dictionaries.entries.update')
    expect(updateHandler).toBeDefined()

    const em = buildEm()
    findOneWithDecryptionMock.mockResolvedValueOnce({
      id: entryId,
      tenantId,
      organizationId: orgAId,
      dictionary: { id: dictionaryId, key: 'colors', deletedAt: null },
      value: 'red',
      label: 'Red',
    })
    const ctx = buildCtx(em)

    await expect(
      updateHandler!.execute({ id: entryId, label: 'Hacked' }, ctx),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<CrudHttpError>)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects dictionaries.entries.delete with 404 when entry belongs to Org A while Org B is selected', async () => {
    const deleteHandler = registeredHandlers.get('dictionaries.entries.delete')
    expect(deleteHandler).toBeDefined()

    const em = buildEm()
    findOneWithDecryptionMock.mockResolvedValueOnce({
      id: entryId,
      tenantId,
      organizationId: orgAId,
      dictionary: { id: dictionaryId, key: 'colors', deletedAt: new Date('2026-05-01T00:00:00.000Z') },
      value: 'red',
      label: 'Red',
    })
    const ctx = buildCtx(em)

    await expect(
      deleteHandler!.execute({ body: { id: entryId } }, ctx),
    ).rejects.toMatchObject({
      status: 404,
      body: { error: 'Dictionary entry not found' },
    } satisfies Partial<CrudHttpError>)
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
