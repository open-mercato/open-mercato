import {
  resolveDealLocations,
  type DealMapAddress,
  type DealMapLink,
} from '../dealsMapLocation'

const dealId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const companyEntityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const personEntityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function companyLink(overrides: Partial<DealMapLink> = {}): DealMapLink {
  return { dealId, entityId: companyEntityId, ...overrides }
}

function personLink(overrides: Partial<DealMapLink> = {}): DealMapLink {
  return { dealId, entityId: personEntityId, ...overrides }
}

function address(overrides: Partial<DealMapAddress> = {}): DealMapAddress {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    entityId: companyEntityId,
    isPrimary: false,
    latitude: 52.19,
    longitude: 21.0,
    city: 'Warszawa',
    region: 'Mazowieckie',
    country: 'PL',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('resolveDealLocations', () => {
  it('prefers the primary company address over a non-primary one', () => {
    const primary = address({
      id: '22222222-2222-4222-8222-222222222222',
      isPrimary: true,
      latitude: 50.06,
      longitude: 19.94,
      city: 'Kraków',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    })
    const secondary = address({ createdAt: new Date('2026-01-01T00:00:00Z') })

    const result = resolveDealLocations(
      [dealId],
      [companyLink()],
      [],
      [secondary, primary],
    )

    expect(result.get(dealId)).toEqual({
      latitude: 50.06,
      longitude: 19.94,
      city: 'Kraków',
      region: 'Mazowieckie',
      country: 'PL',
      source: 'company',
      entityId: companyEntityId,
      addressId: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('prefers a company address over a person address', () => {
    const companyAddress = address()
    const personAddress = address({
      id: '33333333-3333-4333-8333-333333333333',
      entityId: personEntityId,
      isPrimary: true,
      latitude: 54.35,
      longitude: 18.65,
      city: 'Gdańsk',
    })

    const result = resolveDealLocations(
      [dealId],
      [companyLink()],
      [personLink()],
      [companyAddress, personAddress],
    )

    expect(result.get(dealId)?.source).toBe('company')
    expect(result.get(dealId)?.addressId).toBe(companyAddress.id)
  })

  it('falls back to a person address when no company address has coordinates', () => {
    const coordlessCompanyAddress = address({ latitude: null, longitude: null })
    const personAddress = address({
      id: '33333333-3333-4333-8333-333333333333',
      entityId: personEntityId,
      latitude: 54.35,
      longitude: 18.65,
      city: 'Gdańsk',
    })

    const result = resolveDealLocations(
      [dealId],
      [companyLink()],
      [personLink()],
      [coordlessCompanyAddress, personAddress],
    )

    expect(result.get(dealId)).toMatchObject({
      source: 'person',
      entityId: personEntityId,
      addressId: personAddress.id,
      latitude: 54.35,
      longitude: 18.65,
      city: 'Gdańsk',
    })
  })

  it('skips addresses that are missing either coordinate', () => {
    const missingLongitude = address({ longitude: null })
    const missingLatitude = address({
      id: '44444444-4444-4444-8444-444444444444',
      latitude: undefined,
    })

    const result = resolveDealLocations(
      [dealId],
      [companyLink()],
      [],
      [missingLongitude, missingLatitude],
    )

    expect(result.get(dealId)).toBeNull()
  })

  it('skips addresses with non-finite coordinates', () => {
    const nanLatitude = address({ latitude: Number.NaN })
    const infiniteLongitude = address({
      id: '44444444-4444-4444-8444-444444444444',
      longitude: Number.POSITIVE_INFINITY,
    })

    const result = resolveDealLocations(
      [dealId],
      [companyLink()],
      [],
      [nanLatitude, infiniteLongitude],
    )

    expect(result.get(dealId)).toBeNull()
  })

  it('returns null when the deal has no linked entities', () => {
    const result = resolveDealLocations([dealId], [], [], [address()])

    expect(result.size).toBe(1)
    expect(result.get(dealId)).toBeNull()
  })

  it('breaks ties between same-priority addresses by createdAt ascending', () => {
    const older = address({
      id: '99999999-9999-4999-8999-999999999999',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      city: 'Poznań',
      latitude: 52.41,
      longitude: 16.93,
    })
    const newer = address({ createdAt: new Date('2026-03-01T00:00:00Z') })

    const result = resolveDealLocations(
      [dealId],
      [companyLink()],
      [],
      [newer, older],
    )

    expect(result.get(dealId)?.addressId).toBe(older.id)
    expect(result.get(dealId)?.city).toBe('Poznań')
  })

  it('resolves deterministically across multiple linked entities of the same kind', () => {
    const otherCompanyEntityId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const firstCompanyAddress = address({ createdAt: new Date('2026-02-01T00:00:00Z') })
    const otherCompanyPrimary = address({
      id: '55555555-5555-4555-8555-555555555555',
      entityId: otherCompanyEntityId,
      isPrimary: true,
      city: 'Wrocław',
      latitude: 51.11,
      longitude: 17.04,
    })

    const result = resolveDealLocations(
      [dealId],
      [companyLink(), companyLink({ entityId: otherCompanyEntityId })],
      [],
      [firstCompanyAddress, otherCompanyPrimary],
    )

    expect(result.get(dealId)?.addressId).toBe(otherCompanyPrimary.id)
    expect(result.get(dealId)?.entityId).toBe(otherCompanyEntityId)
  })
})
