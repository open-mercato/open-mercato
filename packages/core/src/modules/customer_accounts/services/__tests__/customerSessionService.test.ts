/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerSessionService,
  CUSTOMER_JWT_AUDIENCE,
} from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'

describe('CustomerSessionService.signCustomerJwt', () => {
  const em = {} as EntityManager
  const service = new CustomerSessionService(em)
  const user = {
    id: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    email: 'customer@example.test',
    displayName: 'Customer',
    customerEntityId: null,
    personEntityId: null,
  } as Parameters<CustomerSessionService['signCustomerJwt']>[0]

  it('binds the sid claim to the token so it can be revoked later', () => {
    const sessionId = 'session-1'
    const token = service.signCustomerJwt(user, ['customer_portal.view'], sessionId)
    const payload = verifyAudienceJwt(CUSTOMER_JWT_AUDIENCE, token)

    expect(payload).toMatchObject({
      sub: 'user-1',
      sid: sessionId,
      type: 'customer',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      resolvedFeatures: ['customer_portal.view'],
      aud: 'customer',
      iss: 'open-mercato',
    })
  })

  it('produces tokens that fail verification under the staff audience', () => {
    const token = service.signCustomerJwt(user, [], 'session-2')
    expect(verifyAudienceJwt('staff', token)).toBeNull()
  })
})

describe('CustomerSessionService session lookup and revocation', () => {
  const sessionId = 'abcabcab-cabc-4abc-8abc-abcabcabcabc'

  function buildEm(
    session: { id: string; deletedAt: Date | null; expiresAt: Date } | null,
  ): EntityManager {
    return {
      findOne: jest.fn(async (entity: unknown, filter: Record<string, unknown>) => {
        if (entity !== CustomerUserSession) return null
        if (filter.id !== sessionId) return null
        if (session === null) return null
        if (session.deletedAt !== null) return null
        return session
      }),
      nativeUpdate: jest.fn(async () => 1),
    } as unknown as EntityManager
  }

  it('findActiveSessionById returns the session when active', async () => {
    const session = {
      id: sessionId,
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }
    const service = new CustomerSessionService(buildEm(session))

    await expect(service.findActiveSessionById(sessionId)).resolves.toMatchObject({
      id: sessionId,
    })
  })

  it('findActiveSessionById returns null when the session has been soft-deleted', async () => {
    const service = new CustomerSessionService(buildEm(null))

    await expect(service.findActiveSessionById(sessionId)).resolves.toBeNull()
  })

  it('findActiveSessionById returns null when the session has expired', async () => {
    const session = {
      id: sessionId,
      deletedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    }
    const service = new CustomerSessionService(buildEm(session))

    await expect(service.findActiveSessionById(sessionId)).resolves.toBeNull()
  })
})
