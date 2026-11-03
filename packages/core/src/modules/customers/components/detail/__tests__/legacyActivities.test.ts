jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

import { loadLegacyActivitiesInRange, LEGACY_ACTIVITIES_PAGE_SIZE } from '../legacyActivities'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockedRead = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>

const IN_RANGE_DATE = '2026-08-03T12:00:00.000Z'
const OUT_OF_RANGE_DATE = '2026-07-01T12:00:00.000Z'
const RANGE_START = new Date('2026-08-01T00:00:00.000Z')

const makeActivities = (count: number, offset = 0, occurredAt = IN_RANGE_DATE) =>
  Array.from({ length: count }, (_, index) => ({
    id: `activity-${offset + index}`,
    activityType: 'note',
    occurredAt,
    createdAt: occurredAt,
  }))

const loadOptions = {
  entityId: 'entity-1',
  rangeStart: RANGE_START,
  isWithinRange: () => true,
}

describe('customers detail - loadLegacyActivitiesInRange', () => {
  beforeEach(() => {
    mockedRead.mockReset()
  })

  it('enumerates every page even when totalPages under-reports the result set', async () => {
    mockedRead
      .mockResolvedValueOnce({ items: makeActivities(LEGACY_ACTIVITIES_PAGE_SIZE), totalPages: 1 })
      .mockResolvedValueOnce({
        items: makeActivities(4, LEGACY_ACTIVITIES_PAGE_SIZE),
        totalPages: 1,
      })

    const items = await loadLegacyActivitiesInRange(loadOptions)

    expect(items).toHaveLength(LEGACY_ACTIVITIES_PAGE_SIZE + 4)
    expect(mockedRead).toHaveBeenCalledTimes(2)
  })

  it('terminates on a short final page instead of trusting an inflated totalPages', async () => {
    mockedRead.mockResolvedValueOnce({ items: makeActivities(2), totalPages: 500 })

    const items = await loadLegacyActivitiesInRange(loadOptions)

    expect(items).toHaveLength(2)
    expect(mockedRead).toHaveBeenCalledTimes(1)
  })

  it('stops once a full page scans past the requested range start', async () => {
    mockedRead.mockResolvedValueOnce({
      items: makeActivities(LEGACY_ACTIVITIES_PAGE_SIZE, 0, OUT_OF_RANGE_DATE),
      totalPages: 500,
    })

    await loadLegacyActivitiesInRange(loadOptions)

    expect(mockedRead).toHaveBeenCalledTimes(1)
  })

  it('throws at the page ceiling rather than returning a partial set', async () => {
    let offset = 0
    mockedRead.mockImplementation(async () => {
      const items = makeActivities(LEGACY_ACTIVITIES_PAGE_SIZE, offset)
      offset += LEGACY_ACTIVITIES_PAGE_SIZE
      return { items, totalPages: 10_000 }
    })

    await expect(loadLegacyActivitiesInRange(loadOptions)).rejects.toThrow(
      /refusing to render a partial set/,
    )
    expect(mockedRead).toHaveBeenCalledTimes(1000)
  })
})
