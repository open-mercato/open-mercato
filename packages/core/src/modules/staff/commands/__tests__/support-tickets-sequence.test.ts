/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(async () => []),
}))

import { readHighestSupportSequence } from '../support-tickets'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('readHighestSupportSequence', () => {
  const em = {} as EntityManager

  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  it('reads the single highest row, soft-deleted included, instead of the whole organization', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'ticket-9', supportSequenceNumber: 41 })

    await expect(readHighestSupportSequence(em, SCOPE.tenantId, SCOPE.organizationId)).resolves.toBe(41)

    const [, , where, options, scope] = mockFindOneWithDecryption.mock.calls[0]
    expect(where).toEqual(SCOPE)
    expect(options).toEqual(expect.objectContaining({ orderBy: { supportSequenceNumber: 'desc' } }))
    expect(scope).toEqual(SCOPE)
  })

  it('starts at zero for an organization without tickets', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    await expect(readHighestSupportSequence(em, SCOPE.tenantId, SCOPE.organizationId)).resolves.toBe(0)
  })
})
