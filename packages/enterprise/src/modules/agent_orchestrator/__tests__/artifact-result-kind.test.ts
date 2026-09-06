/** @jest-environment node */
import { agentResultSchema, agentArtifactResultSchema } from '../data/validators'
import { compileOutcome } from '../lib/sdk/outcomeSchema'
import { shapeResult } from '../lib/runtime/persistence'

/**
 * The third result kind
 * (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md` §7).
 *
 * `research` enriches the context, `proposal` states an intent someone disposes,
 * and `artifact` PRODUCES a file. The third kind exists because the other two
 * describe a produced document badly: folding it into `data` loses the file
 * plane, and folding it into a proposal invents a decision nobody was asked to
 * make. It is terminal and non-mutating, which is why it shares the `researcher`
 * governance handle rather than adding a sixth one.
 */

const ARTIFACT = {
  fileName: 'supplier-risk.pdf',
  mimeType: 'application/pdf',
  caption: 'Q3 supplier risk report',
}

describe('the artifact envelope', () => {
  it('carries references, never bytes — the file plane already stored them encrypted', () => {
    const parsed = agentArtifactResultSchema.parse({ artifacts: [ARTIFACT], summary: 'Two suppliers flagged.' })
    expect(parsed.artifacts).toHaveLength(1)
    expect(parsed.artifacts[0]).toMatchObject({ fileName: 'supplier-risk.pdf' })
    expect('content' in parsed.artifacts[0]).toBe(false)
  })

  it('requires at least one file — "I produced nothing" is a research result, not an artifact one', () => {
    expect(agentArtifactResultSchema.safeParse({ artifacts: [] }).success).toBe(false)
  })

  it('is a member of the AgentResult union', () => {
    const result = agentResultSchema().parse({ kind: 'artifact', artifacts: [ARTIFACT] })
    expect(result).toMatchObject({ kind: 'artifact' })
  })
})

describe('compiling an artifact OUTCOME', () => {
  it('uses the FIXED envelope and ignores any declared schema', () => {
    // There is nothing per-agent to type: the same shape describes a drafted
    // email and a risk report, so accepting a schema and then honouring it would
    // let two agents disagree about what "an artifact" is.
    const { resultSchema } = compileOutcome({ kind: 'artifact' })
    expect(resultSchema.safeParse({ kind: 'artifact', artifacts: [ARTIFACT] }).success).toBe(true)
    expect(resultSchema.safeParse({ kind: 'artifact', artifacts: [] }).success).toBe(false)
  })

  it('still refuses a schema-less researcher or proposal OUTCOME', () => {
    expect(() => compileOutcome({ kind: 'researcher' })).toThrow()
    expect(() => compileOutcome({ kind: 'proposal' })).toThrow()
  })
})

describe('shaping what the runtime returns', () => {
  it('re-keys a submitted artifact envelope', () => {
    expect(shapeResult('artifact', { artifacts: [ARTIFACT], summary: 'done' })).toEqual({
      kind: 'artifact',
      artifacts: [ARTIFACT],
      summary: 'done',
    })
  })

  it('degrades a malformed envelope to an empty list rather than throwing', () => {
    // The run produced files either way; the schema validation that runs next is
    // the place to refuse them, not the shaping step.
    expect(shapeResult('artifact', { artifacts: 'nonsense' })).toEqual({ kind: 'artifact', artifacts: [] })
  })

  it('leaves the other two kinds byte-for-byte unchanged', () => {
    expect(shapeResult('researcher', { data: { findings: 3 } })).toEqual({
      kind: 'researcher',
      data: { findings: 3 },
    })
    const proposal = shapeResult('proposal', {
      proposal: { options: [{ id: 'a', label: 'A', actions: [{ type: 'x', payload: {} }] }] },
    })
    expect(proposal.kind).toBe('proposal')
  })
})
