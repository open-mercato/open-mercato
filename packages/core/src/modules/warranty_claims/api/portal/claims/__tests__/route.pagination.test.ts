import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveLinkedCustomerAuth } from '../../../../lib/portalAuthGuard'
import { WarrantyClaim, WarrantyClaimLine } from '../../../../data/entities'
import { GET } from '../route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))
jest.mock('../../../../lib/portalAuthGuard', () => ({ resolveLinkedCustomerAuth: jest.fn() }))
jest.mock('../../../../commands/shared', () => ({ WARRANTY_CLAIM_RESOURCE_KIND: 'warranty_claims.claim' }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const customerId = '33333333-3333-4333-8333-333333333333'

function claim(id: string, createdAt = new Date('2026-11-01T12:00:00Z')): WarrantyClaim {
  return Object.assign(new WarrantyClaim(), { id, createdAt, updatedAt: createdAt, claimNumber: id, claimType: 'warranty', status: 'submitted' })
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(resolveLinkedCustomerAuth).mockResolvedValue({
    sub: 'portal-user', sid: 'portal-session', type: 'customer', email: 'portal@example.test',
    displayName: 'Portal customer', resolvedFeatures: [], tenantId, orgId: organizationId, customerEntityId: customerId,
  })
})

it('keeps tied claims on exactly one page even when the database changes their input order', async () => {
  const claims = [claim('claim-a'), claim('claim-b'), claim('claim-c'), claim('claim-newest', new Date('2026-11-02T12:00:00Z'))]
  const count = jest.fn().mockResolvedValue(claims.length)
  const em = { count }
  jest.mocked(createRequestContainer).mockResolvedValue({ resolve: () => em } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  let claimReads = 0
  jest.mocked(findWithDecryption).mockImplementation(async (_em, entity, _where, options) => {
    if (entity === WarrantyClaimLine) return []
    const candidates = claimReads++ % 2 === 0 ? [...claims] : [...claims].reverse()
    const ordering = options?.orderBy as Record<string, 'ASC' | 'DESC'>
    candidates.sort((left, right) => {
      for (const [field, direction] of Object.entries(ordering)) {
        const comparison = field === 'createdAt'
          ? left.createdAt.getTime() - right.createdAt.getTime()
          : field === 'id' ? left.id.localeCompare(right.id) : 0
        if (comparison) return direction === 'DESC' ? -comparison : comparison
      }
      return 0
    })
    return candidates.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? candidates.length))
  })

  const pages: string[][] = []
  for (const page of [1, 2, 1, 2]) {
    const response = await GET(new Request(`http://localhost/api/warranty_claims/portal/claims?page=${page}&pageSize=2&status=submitted&search=RMA`))
    expect(response.status).toBe(200)
    const body = await response.json() as { items: { id: string }[]; total: number; page: number; pageSize: number; totalPages: number }
    expect(body).toMatchObject({ total: 4, page, pageSize: 2, totalPages: 2 })
    pages.push(body.items.map((item) => item.id))
  }

  expect(pages[0][0]).toBe('claim-newest')
  expect(new Set([...pages[0], ...pages[1]]).size).toBe(4)
  expect(pages.slice(2)).toEqual(pages.slice(0, 2))
  expect(count).toHaveBeenCalledWith(WarrantyClaim, {
    tenantId, organizationId, customerId, claimType: { $ne: 'vendor_recovery' }, deletedAt: null,
    status: 'submitted', $or: [{ claimNumber: { $ilike: '%RMA%' } }, { orderNumber: { $ilike: '%RMA%' } }],
  })
  expect(findWithDecryption).toHaveBeenCalledWith(
    em, WarrantyClaim, count.mock.calls[0][1],
    expect.objectContaining({ limit: 2, offset: 2 }), { tenantId, organizationId },
  )
})
