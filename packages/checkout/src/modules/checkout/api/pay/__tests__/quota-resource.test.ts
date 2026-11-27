import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GET as view } from '../[slug]/route'
import { GET as status } from '../[slug]/status/[transactionId]/route'
import { POST as submit } from '../[slug]/submit/route'
import { POST as verifyPassword } from '../[slug]/verify-password/route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const link = {
  id: 'link-a',
  organizationId: 'org-a',
  tenantId: 'tenant-a',
  status: 'active',
  passwordHash: 'fixture-password-hash',
}

describe('public checkout quota resource', () => {
  const consume = jest.fn().mockResolvedValue({
    allowed: false,
    remainingPoints: 0,
    msBeforeNext: 30_000,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: string) => name === 'rateLimiterService' ? { trustProxyDepth: 0, consume } : {},
    } as Awaited<ReturnType<typeof createRequestContainer>>)
  })

  it.each([
    ['checkout-public-view', view],
    ['checkout-status', status],
    ['checkout-submit', submit],
    ['checkout-password', verifyPassword],
  ] as const)('selects the validated link bucket for %s', async (namespace, handler) => {
    jest.mocked(findOneWithDecryption).mockResolvedValueOnce(link).mockResolvedValueOnce(null)

    const handle = () => handler(new Request('https://merchant.example'), {
      params: { slug: 'fixture-slug', transactionId: 'fixture-transaction' },
    })

    expect((await handle()).status).toBe(429)
    expect(consume.mock.calls[0][0]).toMatch(new RegExp(`^${namespace}:link:[a-f0-9]{64}$`))
    expect((await handle()).status).toBe(429)
    expect(consume.mock.calls[1][0]).toBe(`${namespace}:global`)
    expect(findOneWithDecryption).toHaveBeenCalledTimes(2)
  })
})
