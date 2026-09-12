import {
  allocateReportReference,
  formatReportReference,
  highestReportSequenceNumber,
  isReportReferenceConflict,
  nextReportSequenceNumber,
  parseReportSequenceNumber,
  reportReferencePrefix,
  reportReferenceYear,
  withReportReferenceRetry,
} from '../reportReference'

describe('report reference formatting', () => {
  it('prints the sheet header format', () => {
    expect(formatReportReference(2026, 42)).toBe('RAP-2026-0042')
    expect(formatReportReference(2026, 1)).toBe('RAP-2026-0001')
    expect(reportReferencePrefix(2026)).toBe('RAP-2026-')
  })

  it('does not truncate once the run outgrows the padding', () => {
    expect(formatReportReference(2026, 12345)).toBe('RAP-2026-12345')
  })

  it('takes the year from the issue date, not from the caller clock, when one is given', () => {
    expect(reportReferenceYear(new Date(2027, 0, 4))).toBe(2027)
    expect(reportReferenceYear(new Date('nonsense'))).toBe(new Date().getFullYear())
    expect(reportReferenceYear(null)).toBe(new Date().getFullYear())
  })
})

describe('parseReportSequenceNumber', () => {
  it('reads the run number back out', () => {
    expect(parseReportSequenceNumber('RAP-2026-0042', 2026)).toBe(42)
    expect(parseReportSequenceNumber('RAP-2026-12345', 2026)).toBe(12345)
  })

  it('ignores another year series, so January never continues December run', () => {
    expect(parseReportSequenceNumber('RAP-2025-0042', 2026)).toBeNull()
  })

  it('ignores anything that is not this series, so a hand-edited reference cannot inflate the run', () => {
    expect(parseReportSequenceNumber('INV-2026-0042', 2026)).toBeNull()
    expect(parseReportSequenceNumber('RAP-2026-00a2', 2026)).toBeNull()
    expect(parseReportSequenceNumber('RAP-2026-', 2026)).toBeNull()
    expect(parseReportSequenceNumber(null, 2026)).toBeNull()
    expect(parseReportSequenceNumber(42, 2026)).toBeNull()
  })
})

describe('sequence allocation', () => {
  it('starts at one for an organization that has never reported', () => {
    expect(highestReportSequenceNumber([], 2026)).toBe(0)
    expect(nextReportSequenceNumber(0)).toBe(1)
    expect(allocateReportReference(2026, 0)).toEqual({ sequenceNumber: 1, reference: 'RAP-2026-0001' })
  })

  it('continues past the highest number ever handed out, deleted rows included', () => {
    // The caller passes references from live AND soft-deleted reports on purpose:
    // reissuing a number a client already holds on a PDF is the failure mode.
    const highest = highestReportSequenceNumber(
      ['RAP-2026-0001', 'RAP-2026-0009', 'RAP-2025-0099', 'RAP-2026-0004'],
      2026,
    )
    expect(highest).toBe(9)
    expect(allocateReportReference(2026, highest).reference).toBe('RAP-2026-0010')
  })

  it('never returns a number below the first one', () => {
    expect(nextReportSequenceNumber(-5)).toBe(1)
    expect(nextReportSequenceNumber(null)).toBe(1)
    expect(nextReportSequenceNumber(Number.NaN)).toBe(1)
  })
})

describe('withReportReferenceRetry', () => {
  const conflict = () => {
    const err = new Error('duplicate key value violates unique constraint') as Error & { code?: string }
    err.code = '23505'
    return err
  }

  it('recognises a unique violation as a lost race', () => {
    expect(isReportReferenceConflict(conflict())).toBe(true)
    expect(isReportReferenceConflict(new Error('boom'))).toBe(false)
  })

  it('retries a lost race and returns the winning attempt result', async () => {
    let attempts = 0
    const result = await withReportReferenceRetry(async () => {
      attempts += 1
      if (attempts < 3) throw conflict()
      return `RAP-2026-000${attempts}`
    })
    expect(attempts).toBe(3)
    expect(result).toBe('RAP-2026-0003')
  })

  it('rethrows anything that is not a lost race immediately', async () => {
    let attempts = 0
    await expect(
      withReportReferenceRetry(async () => {
        attempts += 1
        throw new Error('project not found')
      }),
    ).rejects.toThrow('project not found')
    expect(attempts).toBe(1)
  })

  it('surfaces the conflict once the budget runs out rather than looping forever', async () => {
    let attempts = 0
    await expect(
      withReportReferenceRetry(
        async () => {
          attempts += 1
          throw conflict()
        },
        { maxAttempts: 3 },
      ),
    ).rejects.toThrow(/unique constraint/)
    expect(attempts).toBe(3)
  })
})
