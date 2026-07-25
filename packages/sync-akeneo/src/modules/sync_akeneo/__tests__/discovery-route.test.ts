/** @jest-environment node */

// P3 audit coverage for #3386: confirms that both findWithDecryption calls in
// the discovery route sort on non-encrypted columns (SalesChannel.name,
// CatalogPriceKind.title), so the #3278 two-phase encrypted-sort path is not
// needed here.

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

type FindWithDecryptionArgs = [unknown, unknown, unknown, Record<string, unknown>, unknown]
const findWithDecryptionMock = jest.fn<Promise<unknown[]>, FindWithDecryptionArgs>(async () => [])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ tenantId, orgId, sub: null }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'em') return {}
      if (token === 'integrationCredentialsService') {
        return {
          resolve: async () => null,
        }
      }
      return undefined
    },
  }),
}))

import { GET } from '../api/discovery/route'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'

beforeEach(() => {
  findWithDecryptionMock.mockClear()
  findWithDecryptionMock.mockResolvedValue([])
})

describe('discovery route — encrypted-sort audit (#3386 P3)', () => {
  it('fetches SalesChannel with orderBy name, which is not an encrypted field', async () => {
    const res = await GET(new Request('http://localhost/api/data-sync/akeneo/discovery'))
    expect(res.status).toBe(200)

    const salesChannelCall = findWithDecryptionMock.mock.calls.find(
      ([, entity]) => entity === SalesChannel,
    )
    expect(salesChannelCall).toBeDefined()
    // arg[3] is the ORM find options (fields + orderBy); arg[2] is the where clause
    expect(salesChannelCall![3]).toMatchObject({ orderBy: { name: 'asc' } })
  })

  it('fetches CatalogPriceKind with orderBy title, which is not an encrypted field', async () => {
    const res = await GET(new Request('http://localhost/api/data-sync/akeneo/discovery'))
    expect(res.status).toBe(200)

    const priceKindCall = findWithDecryptionMock.mock.calls.find(
      ([, entity]) => entity === CatalogPriceKind,
    )
    expect(priceKindCall).toBeDefined()
    // arg[3] is the ORM find options (fields + orderBy); arg[2] is the where clause
    expect(priceKindCall![3]).toMatchObject({ orderBy: { title: 'asc' } })
  })

  it('returns ok:false with empty discovery data when credentials are absent', async () => {
    const res = await GET(new Request('http://localhost/api/data-sync/akeneo/discovery'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.locales).toEqual([])
    expect(body.channels).toEqual([])
  })
})
