/** @jest-environment node */

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

import { ensureInboxSettings } from '../ensure-settings'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-12345678' }

function createMockEm() {
  return {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'settings-new', ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(),
  }
}

describe('ensureInboxSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.INBOX_OPS_DOMAIN
  })

  it('returns the existing row untouched when found', async () => {
    const existing = { id: 'settings-1', inboxAddress: 'ops-abc@inbox.mercato.local', isActive: true }
    mockFindOneWithDecryption.mockResolvedValue(existing)
    const em = createMockEm()

    const result = await ensureInboxSettings(em as never, SCOPE)

    expect(result.settings).toBe(existing)
    expect(result.em).toBe(em)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('creates and flushes a new row with defaults when none exists (issue #6232)', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const em = createMockEm()

    const result = await ensureInboxSettings(em as never, SCOPE)

    expect(em.create).toHaveBeenCalledTimes(1)
    const [, data] = em.create.mock.calls[0]
    expect(data).toMatchObject({
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      isActive: true,
      inboxAddress: `ops-${SCOPE.organizationId.slice(0, 8)}@inbox.mercato.local`,
    })
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(result.settings.id).toBe('settings-new')
    expect(result.em).toBe(em)
  })

  it('uses INBOX_OPS_DOMAIN for the generated address when set', async () => {
    process.env.INBOX_OPS_DOMAIN = 'ops.example.com'
    mockFindOneWithDecryption.mockResolvedValue(null)
    const em = createMockEm()

    await ensureInboxSettings(em as never, SCOPE)

    const [, data] = em.create.mock.calls[0]
    expect(data.inboxAddress).toBe(`ops-${SCOPE.organizationId.slice(0, 8)}@ops.example.com`)
  })

  it('refetches the winner on a clean fork instead of throwing when two bootstraps race (issue #6232)', async () => {
    const winner = { id: 'settings-winner', inboxAddress: 'ops-abc@inbox.mercato.local', isActive: true }
    mockFindOneWithDecryption
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    const em = createMockEm()
    // Every flush on the original manager keeps rejecting — it still owns the
    // half-persisted row scheduled for the losing insert. If the recovery
    // path (or a caller flushing afterwards) ever touched this manager again,
    // this proves it by rejecting instead of the one-shot mock masking it.
    const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    em.flush.mockRejectedValue(conflict)
    const forkedEm = createMockEm()
    em.fork.mockReturnValue(forkedEm)

    const result = await ensureInboxSettings(em as never, SCOPE)

    expect(result.settings).toBe(winner)
    expect(result.em).toBe(forkedEm)
    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(2)
    expect(em.flush).toHaveBeenCalledTimes(1)

    // A caller flushing further mutations through the returned manager (the
    // fix's whole point) must not retry the original manager's failed insert.
    await expect(result.em.flush()).resolves.toBeUndefined()
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(forkedEm.flush).toHaveBeenCalledTimes(1)
  })

  it('rethrows a flush error that is not a unique-constraint violation', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const em = createMockEm()
    const boom = new Error('connection reset')
    em.flush.mockRejectedValueOnce(boom)

    await expect(ensureInboxSettings(em as never, SCOPE)).rejects.toThrow('connection reset')
  })
})
