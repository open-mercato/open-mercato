import { mapEvalCase, readEvidenceMismatches, residualEvidence } from '../components/evalRunTypes'

describe('eval run evidence view models', () => {
  it('reads the expected/actual diff a json_match result carries', () => {
    const { rows, omitted } = readEvidenceMismatches({
      mismatches: ['data.legalForm'],
      diff: [{ path: 'data.legalForm', expected: 'sp. z o.o.', actual: 'GmbH' }],
    })
    expect(omitted).toBe(0)
    expect(rows).toEqual([{ path: 'data.legalForm', expected: 'sp. z o.o.', actual: 'GmbH' }])
  })

  it('still lists paths for results written before the diff existed', () => {
    const { rows } = readEvidenceMismatches({ mismatches: ['data.sources', 'data.amlStatus'] })
    expect(rows.map((row) => row.path)).toEqual(['data.sources', 'data.amlStatus'])
    // `undefined`, not null: the old evidence made no claim about either side, and
    // rendering that as "null" would assert the agent returned null.
    expect(rows[0].expected).toBeUndefined()
    expect(rows[0].actual).toBeUndefined()
  })

  it('surfaces how many mismatches the stored diff dropped', () => {
    const { omitted } = readEvidenceMismatches({ mismatches: [], diff: [], diffOmitted: 7 })
    expect(omitted).toBe(7)
  })

  it('keeps a null expected distinct from a missing one', () => {
    const { rows } = readEvidenceMismatches({ diff: [{ path: 'a', expected: null, actual: 'x' }] })
    expect(rows[0].expected).toBeNull()
  })

  it('tolerates evidence that is not a mismatch payload', () => {
    expect(readEvidenceMismatches(null).rows).toEqual([])
    expect(readEvidenceMismatches({ reason: 'no_expected' }).rows).toEqual([])
    expect(readEvidenceMismatches(['a']).rows).toEqual([])
  })

  it('leaves only the evidence keys the mismatch table did not render', () => {
    expect(residualEvidence({ mismatches: ['a'], diff: [], diffOmitted: 1 })).toBeNull()
    expect(residualEvidence({ mismatches: ['a'], reason: 'values differ' })).toEqual({ reason: 'values differ' })
    expect(residualEvidence({ reason: 'no_expected' })).toEqual({ reason: 'no_expected' })
  })

  it('maps a golden case payload', () => {
    const view = mapEvalCase({
      id: 'case-1',
      status: 'approved',
      source_type: 'correction',
      process_type: 'klient',
      input: { dealId: 'd1' },
      expected: { legalForm: 'sp. z o.o.' },
      updated_at: '2026-07-22T09:41:00.000Z',
    })
    expect(view).toEqual({
      id: 'case-1',
      status: 'approved',
      sourceType: 'correction',
      processType: 'klient',
      input: { dealId: 'd1' },
      expected: { legalForm: 'sp. z o.o.' },
      updatedAt: '2026-07-22T09:41:00.000Z',
    })
  })

  it('returns null for a payload with no id', () => {
    expect(mapEvalCase({ status: 'approved' })).toBeNull()
  })
})
