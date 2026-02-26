import { resolveCanonicalUnitCode, resolveUnitDictionary } from '../unitResolution'

jest.mock('@open-mercato/shared/lib/crud/errors', () => {
  class CrudHttpError extends Error {
    status: number
    body: Record<string, unknown>
    constructor(status: number, body: Record<string, unknown>) {
      super(String(body.error ?? 'CrudHttpError'))
      this.status = status
      this.body = body
    }
  }
  return { CrudHttpError }
})

function createMockEm() {
  const em = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'

describe('resolveUnitDictionary', () => {
  it('queries with the expected dictionary keys', async () => {
    const em = createMockEm()
    await resolveUnitDictionary(em as never, ORG_ID, TENANT_ID)

    expect(em.findOne).toHaveBeenCalledTimes(1)
    const filterArg = em.findOne.mock.calls[0][1] as Record<string, unknown>
    expect(filterArg.organizationId).toBe(ORG_ID)
    expect(filterArg.tenantId).toBe(TENANT_ID)
    expect(filterArg.key).toEqual({ $in: ['unit', 'units', 'measurement_units'] })
    expect(filterArg.deletedAt).toBeNull()
    expect(filterArg.isActive).toBe(true)
  })

  it('returns null when no dictionary exists', async () => {
    const em = createMockEm()
    const result = await resolveUnitDictionary(em as never, ORG_ID, TENANT_ID)
    expect(result).toBeNull()
  })

  it('returns the dictionary when found', async () => {
    const em = createMockEm()
    const dictionary = { id: 'dict-1', key: 'unit', organizationId: ORG_ID, tenantId: TENANT_ID }
    em.findOne.mockResolvedValueOnce(dictionary)
    const result = await resolveUnitDictionary(em as never, ORG_ID, TENANT_ID)
    expect(result).toBe(dictionary)
  })
})

describe('resolveCanonicalUnitCode', () => {
  it('returns the dictionary entry value when found', async () => {
    const em = createMockEm()
    const dictionary = { id: 'dict-1', key: 'unit', organizationId: ORG_ID, tenantId: TENANT_ID }
    const entry = { value: 'kilogram' }

    em.findOne
      .mockResolvedValueOnce(dictionary)
      .mockResolvedValueOnce(entry)

    const result = await resolveCanonicalUnitCode(em as never, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      unitCode: 'kg',
    })
    expect(result).toBe('kilogram')
  })

  it('falls back to canonicalizeUnitCode when no dictionary exists', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null)

    const result = await resolveCanonicalUnitCode(em as never, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      unitCode: 'qty',
    })
    expect(result).toBe('pc')
  })

  it('falls back to raw unitCode when no dictionary and no alias match', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null)

    const result = await resolveCanonicalUnitCode(em as never, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      unitCode: 'm2',
    })
    expect(result).toBe('m2')
  })

  it('throws 400 when dictionary exists but entry is not found', async () => {
    const em = createMockEm()
    const dictionary = { id: 'dict-1', key: 'unit', organizationId: ORG_ID, tenantId: TENANT_ID }
    em.findOne
      .mockResolvedValueOnce(dictionary)
      .mockResolvedValueOnce(null)

    await expect(
      resolveCanonicalUnitCode(em as never, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        unitCode: 'unknown_unit',
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'uom.unit_not_found' },
    })
  })

  it('throws 400 when dictionary exists but unitCode canonicalizes to null', async () => {
    const em = createMockEm()
    const dictionary = { id: 'dict-1', key: 'unit', organizationId: ORG_ID, tenantId: TENANT_ID }
    em.findOne.mockResolvedValueOnce(dictionary)

    await expect(
      resolveCanonicalUnitCode(em as never, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        unitCode: '',
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'uom.unit_not_found' },
    })
  })

  it('returns unitCode as-is when no dictionary and canonicalize returns null', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null)

    const result = await resolveCanonicalUnitCode(em as never, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      unitCode: '',
    })
    expect(result).toBe('')
  })

  it('returns the trimmed entry value when entry.value has whitespace', async () => {
    const em = createMockEm()
    const dictionary = { id: 'dict-1', key: 'unit', organizationId: ORG_ID, tenantId: TENANT_ID }
    const entry = { value: '  meter  ' }

    em.findOne
      .mockResolvedValueOnce(dictionary)
      .mockResolvedValueOnce(entry)

    const result = await resolveCanonicalUnitCode(em as never, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      unitCode: 'meter',
    })
    expect(result).toBe('meter')
  })

  it('falls back to unitCode when entry.value is empty after trimming', async () => {
    const em = createMockEm()
    const dictionary = { id: 'dict-1', key: 'unit', organizationId: ORG_ID, tenantId: TENANT_ID }
    const entry = { value: '   ' }

    em.findOne
      .mockResolvedValueOnce(dictionary)
      .mockResolvedValueOnce(entry)

    const result = await resolveCanonicalUnitCode(em as never, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      unitCode: 'kg',
    })
    expect(result).toBe('kg')
  })
})
