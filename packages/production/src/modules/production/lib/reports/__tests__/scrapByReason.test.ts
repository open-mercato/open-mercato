import { aggregateScrapByReason, UNSPECIFIED_SCRAP_REASON, type ScrapReportRow } from '../scrapByReason.js'

describe('aggregateScrapByReason', () => {
  it('groups scrap quantity by scrapReasonEntryId', () => {
    const rows: ScrapReportRow[] = [
      { scrapReasonEntryId: 'reason-a', qtyScrap: '3' },
      { scrapReasonEntryId: 'reason-a', qtyScrap: '2' },
      { scrapReasonEntryId: 'reason-b', qtyScrap: '5' },
    ]
    const result = aggregateScrapByReason(rows)
    const reasonA = result.find((r) => r.scrapReasonEntryId === 'reason-a')
    const reasonB = result.find((r) => r.scrapReasonEntryId === 'reason-b')
    expect(reasonA?.qtyScrap).toBe(5)
    expect(reasonA?.reportCount).toBe(2)
    expect(reasonB?.qtyScrap).toBe(5)
    expect(reasonB?.reportCount).toBe(1)
  })

  it('buckets null scrapReasonEntryId under the unspecified sentinel', () => {
    const rows: ScrapReportRow[] = [
      { scrapReasonEntryId: null, qtyScrap: '4' },
      { scrapReasonEntryId: null, qtyScrap: '1' },
    ]
    const result = aggregateScrapByReason(rows)
    expect(result).toHaveLength(1)
    expect(result[0].scrapReasonEntryId).toBe(UNSPECIFIED_SCRAP_REASON)
    expect(result[0].qtyScrap).toBe(5)
    expect(result[0].reportCount).toBe(2)
  })

  it('excludes zero/negative qtyScrap rows (no scrap actually reported)', () => {
    const rows: ScrapReportRow[] = [
      { scrapReasonEntryId: 'reason-a', qtyScrap: '0' },
      { scrapReasonEntryId: 'reason-b', qtyScrap: '3' },
    ]
    const result = aggregateScrapByReason(rows)
    expect(result).toHaveLength(1)
    expect(result[0].scrapReasonEntryId).toBe('reason-b')
  })

  it('sorts buckets by qtyScrap descending using an explicit comparator', () => {
    const rows: ScrapReportRow[] = [
      { scrapReasonEntryId: 'reason-small', qtyScrap: '1' },
      { scrapReasonEntryId: 'reason-big', qtyScrap: '9' },
      { scrapReasonEntryId: 'reason-mid', qtyScrap: '5' },
    ]
    const result = aggregateScrapByReason(rows)
    expect(result.map((r) => r.scrapReasonEntryId)).toEqual(['reason-big', 'reason-mid', 'reason-small'])
  })

  it('returns an empty array for no rows', () => {
    expect(aggregateScrapByReason([])).toEqual([])
  })
})
