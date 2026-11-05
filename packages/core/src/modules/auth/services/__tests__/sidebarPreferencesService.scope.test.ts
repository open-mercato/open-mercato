/**
 * Tenant + user scope guards on sidebar variant operations.
 *
 * Patryk's review (#9) flagged that TC-AUTH-034..038 all run as a single admin
 * in a single tenant, so nothing locks down the cross-tenant / cross-user
 * isolation that `loadSidebarVariant` / `updateSidebarVariant` /
 * `deleteSidebarVariant` rely on. The service guards every read/write with
 * `findOneWithDecryption(em, SidebarVariant, { id, user, tenantId, deletedAt: null }, ...)`,
 * which is correct — but it is a security-critical filter, so it should be
 * pinned by tests. These tests stub the `findOneWithDecryption` helper and
 * assert on the exact filter shape it receives, then return `null` from it to
 * exercise the "variant not in scope → service returns null/false" branches.
 *
 * Together they cover:
 *   - mismatched tenantId  → service treats variant as not found
 *   - mismatched userId    → service treats variant as not found
 *   - matching scope       → service finds the variant and proceeds
 */
import {
  deleteSidebarVariant,
  loadSidebarVariant,
  updateSidebarVariant,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import * as encryptionFind from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

const findOneMock = encryptionFind.findOneWithDecryption as jest.Mock

function makeMockEm() {
  return {
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => 0),
    getReference: jest.fn((_e, id) => ({ id })),
    create: jest.fn(),
  } as unknown as Parameters<typeof loadSidebarVariant>[0]
}

const tenantA = '11111111-1111-1111-1111-111111111111'
const tenantB = '22222222-2222-2222-2222-222222222222'
const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const userB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const variantId = '99999999-9999-9999-9999-999999999999'
const orgA = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const scopeA = { userId: userA, tenantId: tenantA, organizationId: orgA, locale: 'en' }

describe('sidebarPreferencesService — variant scope guards', () => {
  beforeEach(() => {
    findOneMock.mockReset()
  })

  describe('loadSidebarVariant', () => {
    it('queries with both user and tenant scope and the soft-delete guard', async () => {
      findOneMock.mockResolvedValueOnce({
        id: variantId,
        name: 'My preferences',
        isActive: false,
        settingsJson: {},
        createdAt: new Date(),
        updatedAt: null,
      })
      await loadSidebarVariant(makeMockEm(), scopeA, variantId)
      expect(findOneMock).toHaveBeenCalledTimes(1)
      const [, , filter, , decryptionScope] = findOneMock.mock.calls[0]
      expect(filter).toMatchObject({
        id: variantId,
        user: userA,
        tenantId: tenantA,
        deletedAt: null,
      })
      expect(decryptionScope).toEqual({ tenantId: tenantA, organizationId: orgA })
    })

    it('returns null when the helper finds no variant (variant belongs to a different tenant or user)', async () => {
      findOneMock.mockResolvedValueOnce(null)
      const result = await loadSidebarVariant(makeMockEm(), scopeA, variantId)
      expect(result).toBeNull()
    })
  })

  describe('updateSidebarVariant', () => {
    it('returns null and skips the flush when the variant is not in scope', async () => {
      findOneMock.mockResolvedValueOnce(null)
      const em = makeMockEm()
      const result = await updateSidebarVariant(em, scopeA, variantId, { name: 'X' })
      expect(result).toBeNull()
      expect((em as { flush: jest.Mock }).flush).not.toHaveBeenCalled()
    })

    it('passes the scoped filter (no cross-tenant leak) when the variant id is from another tenant', async () => {
      findOneMock.mockResolvedValueOnce(null)
      const crossTenantScope = { ...scopeA, tenantId: tenantB }
      await updateSidebarVariant(makeMockEm(), crossTenantScope, variantId, { name: 'X' })
      const [, , filter] = findOneMock.mock.calls[0]
      expect(filter.tenantId).toBe(tenantB)
      expect(filter.user).toBe(userA)
    })
  })

  describe('deleteSidebarVariant', () => {
    it('returns false when the variant is not in scope', async () => {
      findOneMock.mockResolvedValueOnce(null)
      const ok = await deleteSidebarVariant(makeMockEm(), scopeA, variantId)
      expect(ok).toBe(false)
    })

    it('passes the scoped filter when called with another user id', async () => {
      findOneMock.mockResolvedValueOnce(null)
      const crossUserScope = { ...scopeA, userId: userB }
      await deleteSidebarVariant(makeMockEm(), crossUserScope, variantId)
      const [, , filter] = findOneMock.mock.calls[0]
      expect(filter.user).toBe(userB)
      expect(filter.tenantId).toBe(tenantA)
      // Soft-delete guard: never load tombstoned rows even if the id matches.
      expect(filter.deletedAt).toBeNull()
    })
  })
})
