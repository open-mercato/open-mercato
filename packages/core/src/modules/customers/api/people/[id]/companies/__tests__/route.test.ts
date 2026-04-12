const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const personId = '44444444-4444-4444-8444-444444444444'
const companyId = '55555555-5555-4555-8555-555555555555'
const linkId = '66666666-6666-4666-8666-666666666666'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  flush: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const addPersonCompanyLinkMock = jest.fn()
const updatePersonCompanyLinkMock = jest.fn()
const removePersonCompanyLinkMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

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

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: async (req: Request, fallback: unknown) => {
    try { return await req.json() } catch { return fallback }
  },
}))

jest.mock('@open-mercato/core/modules/customers/lib/personCompanies', () => ({
  addPersonCompanyLink: (...args: unknown[]) => addPersonCompanyLinkMock(...args),
  loadPersonCompanyLinks: jest.fn(),
  summarizePersonCompanies: jest.fn(),
  updatePersonCompanyLink: (...args: unknown[]) => updatePersonCompanyLinkMock(...args),
  removePersonCompanyLink: (...args: unknown[]) => removePersonCompanyLinkMock(...args),
}))

import { POST as createLink, metadata as createMetadata } from '../route'
import {
  PATCH as updateLink,
  DELETE as deleteLink,
  metadata as updateMetadata,
} from '../[linkId]/route'

describe('customer person company link routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.findOne
      .mockResolvedValueOnce({ id: personId, tenantId, organizationId, kind: 'person' })
      .mockResolvedValueOnce({ entity: personId, company: null })
    em.flush.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('requires manage access for all write methods', () => {
    expect(createMetadata.POST.requireFeatures).toEqual(['customers.people.manage'])
    expect(updateMetadata.PATCH.requireFeatures).toEqual(['customers.people.manage'])
    expect(updateMetadata.DELETE.requireFeatures).toEqual(['customers.people.manage'])
  })

  it('runs the mutation guard when linking a company to a person', async () => {
    addPersonCompanyLinkMock.mockResolvedValue({
      id: linkId,
      company: { id: companyId, displayName: 'Acme Corp' },
      isPrimary: true,
    })

    const response = await createLink(
      new Request(`http://localhost/api/customers/people/${personId}/companies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId, isPrimary: true }),
      }),
      { params: { id: personId } },
    )

    expect(response.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.person',
        resourceId: personId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.person',
        resourceId: personId,
        operation: 'custom',
      }),
    )
  })

  it('runs the mutation guard for PATCH and DELETE link mutations', async () => {
    em.findOne
      .mockResolvedValueOnce({ id: personId, tenantId, organizationId, kind: 'person' })
      .mockResolvedValueOnce({ entity: personId, company: null })
      .mockResolvedValueOnce({ id: personId, tenantId, organizationId, kind: 'person' })
      .mockResolvedValueOnce({ entity: personId, company: null })
    updatePersonCompanyLinkMock.mockResolvedValue({
      id: linkId,
      company: { id: companyId, displayName: 'Acme Corp' },
      isPrimary: false,
    })
    removePersonCompanyLinkMock.mockResolvedValue(undefined)

    const patchResponse = await updateLink(
      new Request(`http://localhost/api/customers/people/${personId}/companies/${linkId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPrimary: false }),
      }),
      { params: { id: personId, linkId } },
    )
    const deleteResponse = await deleteLink(
      new Request(`http://localhost/api/customers/people/${personId}/companies/${linkId}`, {
        method: 'DELETE',
      }),
      { params: { id: personId, linkId } },
    )

    expect(patchResponse.status).toBe(200)
    expect(deleteResponse.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenNthCalledWith(
      1,
      container,
      expect.objectContaining({
        resourceKind: 'customers.person',
        resourceId: personId,
        operation: 'custom',
      }),
    )
    expect(validateCrudMutationGuardMock).toHaveBeenNthCalledWith(
      2,
      container,
      expect.objectContaining({
        resourceKind: 'customers.person',
        resourceId: personId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledTimes(2)
  })
})
