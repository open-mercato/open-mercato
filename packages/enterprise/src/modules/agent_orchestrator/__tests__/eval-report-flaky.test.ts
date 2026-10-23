import { detectFlaky, flakyAssertionKeysForCase, isFlakyCase } from '../lib/eval/report/flaky'

const trial = (status: string, verdicts: Record<string, boolean | null> = {}) => ({
  status,
  results: Object.entries(verdicts).map(([assertionKey, passed]) => ({ assertionKey, passed })),
})

describe('eval report flaky detection', () => {
  it('flags a case whose non-errored trials both pass and fail', () => {
    expect(isFlakyCase([trial('passed'), trial('failed')])).toBe(true)
    expect(isFlakyCase([trial('passed'), trial('passed')])).toBe(false)
    expect(isFlakyCase([trial('failed'), trial('failed')])).toBe(false)
  })

  it('excludes errored and skipped trials from case flakiness', () => {
    expect(isFlakyCase([trial('passed'), trial('error')])).toBe(false)
    expect(isFlakyCase([trial('failed'), trial('error'), trial('skipped')])).toBe(false)
  })

  it('flags an assertion whose verdict differs across trials of the same case', () => {
    const keys = flakyAssertionKeysForCase([
      trial('passed', { exact: true, tone: true }),
      trial('failed', { exact: false, tone: true }),
    ])
    expect(Array.from(keys)).toEqual(['exact'])
  })

  it('ignores skipped verdicts and errored trials for assertion flakiness', () => {
    const keys = flakyAssertionKeysForCase([
      trial('passed', { exact: true, tone: null }),
      trial('passed', { exact: true, tone: false }),
      trial('error', { exact: false }),
    ])
    expect(keys.size).toBe(0)
  })

  it('flags nothing when the suite ran each case once', () => {
    const detection = detectFlaky(1, [
      { caseId: 'case-1', trials: [trial('passed', { exact: true }), trial('failed', { exact: false })] },
    ])
    expect(detection.flakyCaseIds.size).toBe(0)
    expect(detection.flakyAssertionKeys.size).toBe(0)
  })

  it('aggregates flaky cases and assertions across a repeated suite', () => {
    const detection = detectFlaky(3, [
      {
        caseId: 'case-1',
        trials: [trial('passed', { exact: true }), trial('failed', { exact: false }), trial('passed', { exact: true })],
      },
      { caseId: 'case-2', trials: [trial('passed', { tone: true }), trial('passed', { tone: true })] },
      { caseId: 'case-3', trials: [trial('error'), trial('failed', { tone: false })] },
    ])
    expect(Array.from(detection.flakyCaseIds)).toEqual(['case-1'])
    expect(Array.from(detection.flakyAssertionKeys)).toEqual(['exact'])
    expect(Array.from(detection.flakyAssertionKeysByCase.get('case-1') ?? [])).toEqual(['exact'])
  })
})
