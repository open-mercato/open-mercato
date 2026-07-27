import { scorers } from '../lib/eval/scorers'

describe('deterministic scorers', () => {
  describe('output_present', () => {
    it('fails on null/empty output, passes on a non-empty object', () => {
      expect(scorers.output_present({ output: null, run: {}, config: {} }).passed).toBe(false)
      expect(scorers.output_present({ output: {}, run: {}, config: {} }).passed).toBe(false)
      expect(scorers.output_present({ output: { kind: 'informative' }, run: {}, config: {} }).passed).toBe(true)
    })
  })

  describe('required_keys', () => {
    it('passes only when every required key is present', () => {
      const config = { requiredKeys: ['stage', 'rationale'] }
      expect(scorers.required_keys({ output: { stage: 'won', rationale: 'x' }, run: {}, config }).passed).toBe(true)
      const missing = scorers.required_keys({ output: { stage: 'won' }, run: {}, config })
      expect(missing.passed).toBe(false)
      expect(missing.evidence).toEqual({ missing: ['rationale'] })
    })
  })

  describe('min_confidence', () => {
    it('passes at/above threshold, fails below or when absent', () => {
      expect(scorers.min_confidence({ output: {}, run: { confidence: 0.9 }, config: { threshold: 0.8 } }).passed).toBe(true)
      expect(scorers.min_confidence({ output: {}, run: { confidence: 0.5 }, config: { threshold: 0.8 } }).passed).toBe(false)
      expect(scorers.min_confidence({ output: {}, run: { confidence: null }, config: {} }).passed).toBe(false)
    })
  })

  describe('no_pii', () => {
    it('detects an email and passes clean output', () => {
      const dirty = scorers.no_pii({ output: { note: 'reach me at a@b.com' }, run: {}, config: {} })
      expect(dirty.passed).toBe(false)
      expect(dirty.evidence).toEqual({ detected: ['email'] })
      expect(scorers.no_pii({ output: { note: 'all clear' }, run: {}, config: {} }).passed).toBe(true)
    })
  })
})
