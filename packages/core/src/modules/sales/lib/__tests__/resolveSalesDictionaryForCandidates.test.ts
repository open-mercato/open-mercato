/** @jest-environment node */
import { resolveSalesDictionaryForCandidates } from '../makeStatusDictionaryRoute'

const ensureSalesDictionaryMock = jest.fn()

jest.mock('../dictionaries', () => {
  const actual = jest.requireActual('../dictionaries')
  return {
    ...actual,
    ensureSalesDictionary: (...args: unknown[]) => ensureSalesDictionaryMock(...args),
  }
})

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: 'Dictionary',
  DictionaryEntry: 'DictionaryEntry',
}))

describe('resolveSalesDictionaryForCandidates (issue #1404)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null without touching the database when there are no candidates', async () => {
    const em = { find: jest.fn(), findOne: jest.fn() }
    const result = await resolveSalesDictionaryForCandidates({
      em: em as unknown as any,
      tenantId: 'tenant-1',
      kind: 'order-status',
      dictionaryKey: 'sales.order_status',
      candidateOrgIds: [],
    })

    expect(result).toBeNull()
    expect(em.find).not.toHaveBeenCalled()
    expect(ensureSalesDictionaryMock).not.toHaveBeenCalled()
  })

  it('prefetches all candidate dictionaries in a single query', async () => {
    const em = {
      find: jest.fn().mockResolvedValue([
        { id: 'dict-b', organizationId: 'org-b' },
        { id: 'dict-c', organizationId: 'org-c' },
      ]),
      findOne: jest.fn(),
    }

    const result = await resolveSalesDictionaryForCandidates({
      em: em as unknown as any,
      tenantId: 'tenant-1',
      kind: 'order-status',
      dictionaryKey: 'sales.order_status',
      candidateOrgIds: ['org-a', 'org-b', 'org-c'],
    })

    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.find).toHaveBeenCalledWith(
      'Dictionary',
      expect.objectContaining({
        tenantId: 'tenant-1',
        key: 'sales.order_status',
        organizationId: { $in: ['org-a', 'org-b', 'org-c'] },
        deletedAt: null,
      }),
    )
    // Priority order picks 'org-b' over 'org-c' because 'org-b' comes first in the candidate list.
    expect(result).toEqual({ dictionaryId: 'dict-b', organizationId: 'org-b' })
    expect(ensureSalesDictionaryMock).not.toHaveBeenCalled()
  })

  it('respects candidate priority order even when the prefetched rows arrive unordered', async () => {
    const em = {
      find: jest.fn().mockResolvedValue([
        { id: 'dict-c', organizationId: 'org-c' },
        { id: 'dict-a', organizationId: 'org-a' },
      ]),
      findOne: jest.fn(),
    }

    const result = await resolveSalesDictionaryForCandidates({
      em: em as unknown as any,
      tenantId: 'tenant-1',
      kind: 'order-status',
      dictionaryKey: 'sales.order_status',
      candidateOrgIds: ['org-a', 'org-b', 'org-c'],
    })

    expect(result).toEqual({ dictionaryId: 'dict-a', organizationId: 'org-a' })
  })

  it('only seeds a dictionary when no candidate org owns one yet', async () => {
    const em = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    }
    ensureSalesDictionaryMock.mockResolvedValue({ id: 'created-dict' })

    const result = await resolveSalesDictionaryForCandidates({
      em: em as unknown as any,
      tenantId: 'tenant-1',
      kind: 'order-status',
      dictionaryKey: 'sales.order_status',
      candidateOrgIds: ['org-a', 'org-b'],
    })

    expect(ensureSalesDictionaryMock).toHaveBeenCalledTimes(1)
    expect(ensureSalesDictionaryMock).toHaveBeenCalledWith({
      em,
      tenantId: 'tenant-1',
      organizationId: 'org-a',
      kind: 'order-status',
    })
    expect(result).toEqual({ dictionaryId: 'created-dict', organizationId: 'org-a' })
  })

  it('does not create per-candidate dictionaries on the read path (no sequential em.flush per org)', async () => {
    const em = {
      find: jest.fn().mockResolvedValue([{ id: 'dict-b', organizationId: 'org-b' }]),
      findOne: jest.fn(),
    }

    await resolveSalesDictionaryForCandidates({
      em: em as unknown as any,
      tenantId: 'tenant-1',
      kind: 'order-status',
      dictionaryKey: 'sales.order_status',
      candidateOrgIds: ['org-a', 'org-b', 'org-c'],
    })

    // The old implementation called ensureSalesDictionary (which triggers em.flush)
    // per candidate on the read path. The optimized path must not do that when
    // any candidate already owns the dictionary.
    expect(ensureSalesDictionaryMock).not.toHaveBeenCalled()
  })
})
