import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'

const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

import { buildPortalOwnedClaimWhere, loadPortalOwnedClaim } from '../lib/portalClaimAccess'
import { resolvePortalAttachmentUploadService } from '../lib/portalAttachmentUpload'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
}

describe('portal warranty claim ownership boundary', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockResolvedValue(null)
  })

  it('always excludes vendor recovery claims within tenant, organization, and customer scope', async () => {
    expect(buildPortalOwnedClaimWhere(scope, { id: 'claim-1' })).toEqual({
      id: 'claim-1',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerId: scope.customerId,
      claimType: { $ne: 'vendor_recovery' },
      deletedAt: null,
    })

    await loadPortalOwnedClaim({} as EntityManager, scope, 'claim-1')
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: 'claim-1',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        customerId: scope.customerId,
        claimType: { $ne: 'vendor_recovery' },
      }),
      {},
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  })

  it.each([
    'api/portal/events/route.ts',
    'api/portal/attachments/route.ts',
    'api/portal/claims/route.ts',
    'api/portal/claims/[id]/route.ts',
    'api/portal/claims/[id]/shared.ts',
    'api/portal/claims/[id]/submit/route.ts',
    'api/portal/claims/[id]/withdraw/route.ts',
  ])('%s routes ownership through the centralized predicate', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
    expect(source).toMatch(/loadPortalOwnedClaim|buildPortalOwnedClaimWhere|loadOwnedClaim/)
  })

  it('fails closed when the attachments module upload service is not registered', () => {
    expect(resolvePortalAttachmentUploadService({
      resolve: () => {
        throw new Error('attachment module disabled')
      },
    })).toBeNull()
  })
})
