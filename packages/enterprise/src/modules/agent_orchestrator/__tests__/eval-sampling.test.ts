import { resolveJudgeSampleRate, shouldSampleForJudge } from '../lib/eval/sampling'

describe('llm_judge sampling', () => {
  describe('resolveJudgeSampleRate', () => {
    it('defaults to 0.1 when unset/blank/invalid', () => {
      expect(resolveJudgeSampleRate({} as NodeJS.ProcessEnv)).toBe(0.1)
      expect(resolveJudgeSampleRate({ OM_AGENT_LLM_JUDGE_SAMPLE_RATE: '' } as NodeJS.ProcessEnv)).toBe(0.1)
      expect(resolveJudgeSampleRate({ OM_AGENT_LLM_JUDGE_SAMPLE_RATE: 'abc' } as NodeJS.ProcessEnv)).toBe(0.1)
    })
    it('parses and clamps to [0,1]', () => {
      expect(resolveJudgeSampleRate({ OM_AGENT_LLM_JUDGE_SAMPLE_RATE: '0.25' } as NodeJS.ProcessEnv)).toBe(0.25)
      expect(resolveJudgeSampleRate({ OM_AGENT_LLM_JUDGE_SAMPLE_RATE: '5' } as NodeJS.ProcessEnv)).toBe(1)
      expect(resolveJudgeSampleRate({ OM_AGENT_LLM_JUDGE_SAMPLE_RATE: '-2' } as NodeJS.ProcessEnv)).toBe(0)
    })
  })

  describe('shouldSampleForJudge', () => {
    it('never samples at rate 0, always at rate 1', () => {
      expect(shouldSampleForJudge('run-x', 0)).toBe(false)
      expect(shouldSampleForJudge('run-x', 1)).toBe(true)
    })
    it('is deterministic for the same run id', () => {
      const a = shouldSampleForJudge('run-abc', 0.5)
      const b = shouldSampleForJudge('run-abc', 0.5)
      expect(a).toBe(b)
    })
    it('approximately honors the rate across many ids', () => {
      const ids = Array.from({ length: 2000 }, (_, i) => `run-${i}`)
      const sampled = ids.filter((id) => shouldSampleForJudge(id, 0.25)).length
      const fraction = sampled / ids.length
      expect(fraction).toBeGreaterThan(0.18)
      expect(fraction).toBeLessThan(0.32)
    })
  })
})
