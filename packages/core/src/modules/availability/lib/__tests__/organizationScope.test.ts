const resolveScopeMock = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveScopeMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => `t:${key}` }),
}))

import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ScopedContext } from '@open-mercato/shared/lib/api/scoped'
import {
  resolveAvailabilityListOrganizationIds,
  resolveAvailabilityOrganizationId,
  scopeAvailabilityPolicyWriteInput,
} from '../organizationScope'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const HOME_ORG = '22222222-2222-4222-8222-222222222222'
const SELECTED_ORG = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'

const container = {} as AwilixContainer
const request = new Request('http://localhost/api/availability/policies')
const auth = { sub: 'user-1', tenantId: TENANT_ID, orgId: HOME_ORG, isSuperAdmin: false } as AuthContext

describe('resolveAvailabilityOrganizationId', () => {
  beforeEach(() => resolveScopeMock.mockReset())

  it('reads the organization selected in the header for a non-superadmin, like the policy writes', async () => {
    resolveScopeMock.mockResolvedValue({
      selectedId: SELECTED_ORG,
      filterIds: [SELECTED_ORG],
      allowedIds: [HOME_ORG, SELECTED_ORG],
      tenantId: TENANT_ID,
    })

    await expect(resolveAvailabilityOrganizationId(container, auth, request)).resolves.toBe(SELECTED_ORG)
    expect(resolveScopeMock).toHaveBeenCalledWith({ container, auth, request })
  })

  it('falls back to the home organization when nothing is selected', async () => {
    resolveScopeMock.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })

    await expect(resolveAvailabilityOrganizationId(container, auth, request)).resolves.toBe(HOME_ORG)
  })

  it('falls back to the home organization when the scope cannot be resolved', async () => {
    resolveScopeMock.mockRejectedValue(new Error('rbac unavailable'))

    await expect(resolveAvailabilityOrganizationId(container, auth, request)).resolves.toBe(HOME_ORG)
  })
})

describe('resolveAvailabilityListOrganizationIds', () => {
  beforeEach(() => resolveScopeMock.mockReset())

  it('lists only the organization selected in the header', async () => {
    resolveScopeMock.mockResolvedValue({
      selectedId: SELECTED_ORG,
      filterIds: [SELECTED_ORG],
      allowedIds: [HOME_ORG, SELECTED_ORG],
      tenantId: TENANT_ID,
    })

    await expect(resolveAvailabilityListOrganizationIds(container, auth, request)).resolves.toEqual([SELECTED_ORG])
  })

  it('lists every accessible organization under "All organizations", not just the home one (#7080)', async () => {
    resolveScopeMock.mockResolvedValue({
      selectedId: null,
      filterIds: [HOME_ORG, OTHER_ORG],
      allowedIds: [HOME_ORG, OTHER_ORG],
      tenantId: TENANT_ID,
    })

    await expect(resolveAvailabilityListOrganizationIds(container, auth, request)).resolves.toEqual([HOME_ORG, OTHER_ORG])
  })

  it('lists the whole tenant under "All organizations" for an unrestricted caller (#7080)', async () => {
    resolveScopeMock.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })

    await expect(
      resolveAvailabilityListOrganizationIds(container, { ...auth, isSuperAdmin: true } as AuthContext, request),
    ).resolves.toBeNull()
  })

  it('keeps an empty access scope empty', async () => {
    resolveScopeMock.mockResolvedValue({ selectedId: null, filterIds: [], allowedIds: [], tenantId: TENANT_ID })

    await expect(resolveAvailabilityListOrganizationIds(container, auth, request)).resolves.toEqual([])
  })

  it('falls back to the home organization when the scope cannot be resolved', async () => {
    resolveScopeMock.mockRejectedValue(new Error('rbac unavailable'))

    await expect(resolveAvailabilityListOrganizationIds(container, auth, request)).resolves.toEqual([HOME_ORG])
  })

  it('leaves nothing in scope for a non-superadmin without an organization when the scope cannot be resolved', async () => {
    resolveScopeMock.mockRejectedValue(new Error('rbac unavailable'))

    await expect(
      resolveAvailabilityListOrganizationIds(container, { ...auth, orgId: null } as AuthContext, request),
    ).resolves.toEqual([])
  })
})

describe('scopeAvailabilityPolicyWriteInput', () => {
  const ctxFor = (selectedOrganizationId: string | null, orgId: string | null) =>
    ({ auth: { tenantId: TENANT_ID, orgId }, selectedOrganizationId }) as unknown as ScopedContext

  it('fills a null organization from the organization selected in the header', async () => {
    await expect(
      scopeAvailabilityPolicyWriteInput({ organizationId: null, tenantId: null, productId: 'p' }, ctxFor(SELECTED_ORG, SELECTED_ORG)),
    ).resolves.toMatchObject({ organizationId: SELECTED_ORG, tenantId: TENANT_ID, productId: 'p' })
  })

  it('keeps an explicit organization for the command to check against the scope', async () => {
    await expect(
      scopeAvailabilityPolicyWriteInput({ organizationId: OTHER_ORG, tenantId: TENANT_ID }, ctxFor(SELECTED_ORG, SELECTED_ORG)),
    ).resolves.toMatchObject({ organizationId: OTHER_ORG })
  })

  it('rejects "All organizations" with a message instead of an organizationId field error (#7080)', async () => {
    const result = scopeAvailabilityPolicyWriteInput({ organizationId: null, tenantId: TENANT_ID }, ctxFor(null, null))

    await expect(result).rejects.toBeInstanceOf(CrudHttpError)
    await expect(result).rejects.toMatchObject({
      status: 400,
      body: { error: 't:availability.policies.errors.organizationRequired' },
    })
  })
})
