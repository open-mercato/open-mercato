import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveUserDataSubject } from '../userDataSubject'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

const userId = '33333333-3333-4333-8333-333333333333'
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const em = {} as EntityManager
const findUser = jest.mocked(findOneWithDecryption)
const auth: NonNullable<AuthContext> = {
  sub: 'api_key:44444444-4444-4444-8444-444444444444',
  isApiKey: true,
  userId,
  tenantId,
  orgId: organizationId,
}

beforeEach(() => jest.resetAllMocks())

it('preserves the interactive subject without resolving a second identity', async () => {
  expect(await resolveUserDataSubject(em, { ...auth, isApiKey: false, sub: userId })).toBe(userId)
  expect(findUser).not.toHaveBeenCalled()
})

it('resolves the bound user inside the exact tenant and organization without mutating the actor', async () => {
  findUser.mockResolvedValue({ id: userId })
  expect(await resolveUserDataSubject(em, auth)).toBe(userId)
  expect(findUser).toHaveBeenCalledWith(em, expect.anything(), {
    id: userId, tenantId, organizationId, deletedAt: null,
  }, undefined, { tenantId, organizationId })
  expect(auth.sub).toMatch(/^api_key:/)
})

it('allows a tenant-wide key to use its bound user without widening the tenant', async () => {
  findUser.mockResolvedValue({ id: userId })
  expect(await resolveUserDataSubject(em, { ...auth, orgId: null })).toBe(userId)
  expect(findUser).toHaveBeenCalledWith(em, expect.anything(), {
    id: userId, tenantId, deletedAt: null,
  }, undefined, { tenantId, organizationId: null })
})

it.each([
  { userId: undefined }, { userId: '' }, { userId: 'api_key:invalid' },
  { tenantId: null }, { tenantId: 'invalid' }, { orgId: 'invalid' },
])('rejects an unusable binding before any UUID query: %j', async (override) => {
  expect(await resolveUserDataSubject(em, { ...auth, ...override })).toBeNull()
  expect(findUser).not.toHaveBeenCalled()
})

it.each(['deleted', 'foreign-tenant', 'foreign-organization'])('rejects a %s user missing from the scoped query', async () => {
  findUser.mockResolvedValue(null)
  expect(await resolveUserDataSubject(em, auth)).toBeNull()
})
