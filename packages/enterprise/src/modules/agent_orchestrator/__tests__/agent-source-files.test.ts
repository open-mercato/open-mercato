import fs from 'node:fs'
import path from 'node:path'
import { countTokens } from '@open-mercato/shared/lib/ai/token-count'
import { fileAgentDescriptors } from '../generated/file-agents.generated'

// The committed example file-agents live in the app module. Resolve from this
// test file so the path holds regardless of the jest working directory.
const EXAMPLES_ROOT = path.resolve(
  __dirname,
  '../../../../../../apps/mercato/src/modules/agent_examples/agents',
)

const allDescriptors = fileAgentDescriptors.flatMap((descriptor) => [
  descriptor,
  ...(descriptor.subAgentDescriptors ?? []),
])

describe('baked file-agent sourceFiles', () => {
  it('every file-defined descriptor bakes a non-empty sourceFiles array', () => {
    expect(allDescriptors.length).toBeGreaterThan(0)
    for (const descriptor of allDescriptors) {
      expect(Array.isArray(descriptor.sourceFiles)).toBe(true)
      expect((descriptor.sourceFiles ?? []).length).toBeGreaterThan(0)
    }
  })

  it('the in-context token sum equals the baked tokenUsage.total (consistent with the estimate)', () => {
    for (const descriptor of allDescriptors) {
      const files = descriptor.sourceFiles ?? []
      const inContextSum = files.filter((file) => file.inContext).reduce((sum, file) => sum + file.tokens, 0)
      expect(inContextSum).toBe(descriptor.tokenUsage?.total ?? 0)
    }
  })

  it("each file's baked token count matches countTokens(content)", () => {
    for (const descriptor of allDescriptors) {
      for (const file of descriptor.sourceFiles ?? []) {
        expect(file.tokens).toBe(countTokens(file.content))
      }
    }
  })

  it('marks auxiliary files (SAMPLE.json / FACTS.json) as out-of-context and construction files as in-context', () => {
    for (const descriptor of allDescriptors) {
      for (const file of descriptor.sourceFiles ?? []) {
        const leaf = file.path.split('/').pop() as string
        if (leaf === 'SAMPLE.json' || leaf === 'FACTS.json') expect(file.inContext).toBe(false)
        if (leaf === 'AGENT.md' || leaf === 'OUTCOME.md') expect(file.inContext).toBe(true)
      }
    }
  })

  const examplesPresent = fs.existsSync(EXAMPLES_ROOT)
  const itIf = examplesPresent ? it : it.skip

  itIf('company_researcher bakes the expected tree, byte-for-byte with the source files', () => {
    const descriptor = fileAgentDescriptors.find((d) => d.id === 'deals.company_researcher')
    expect(descriptor).toBeDefined()
    const files = descriptor?.sourceFiles ?? []
    const paths = files.map((file) => file.path)
    for (const expected of [
      'AGENT.md',
      'OUTCOME.md',
      'SAMPLE.json',
      'skills/deal_qualification/SKILL.md',
      'skills/deal_qualification/scripts/score.ts',
      'sub-agents/revenue_estimator/AGENT.md',
    ]) {
      expect(paths).toContain(expected)
    }

    const agentDir = path.join(EXAMPLES_ROOT, 'company_researcher')
    for (const file of files) {
      const onDisk = fs.readFileSync(path.join(agentDir, file.path), 'utf8')
      expect(file.content).toBe(onDisk)
    }
  })
})
