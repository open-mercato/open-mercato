import fs from 'node:fs'
import path from 'node:path'
import { computeAgentTokenUsageFromDir } from '../lib/tokens/computeAgentTokenUsage'
import { fileAgentDescriptors } from '../generated/file-agents.generated'

// The committed example file-agents live in the app module. Resolve from this
// test file so the path holds regardless of the jest working directory.
const EXAMPLES_ROOT = path.resolve(
  __dirname,
  '../../../../../../apps/mercato/src/modules/agent_examples/agents',
)

// dir name (what the walker keys on) → registered agent id (manifest descriptor).
const CASES: Array<{ dir: string; id: string }> = [
  { dir: 'company_researcher', id: 'deals.company_researcher' },
  { dir: 'deals_health_check', id: 'deals.health_check_file' },
  { dir: 'deal_web_researcher', id: 'deals.web_researcher' },
  { dir: 'support_resolution_advisor', id: 'support.resolution_advisor' },
]

const allDescriptors = fileAgentDescriptors.flatMap((descriptor) => [
  descriptor,
  ...(descriptor.subAgentDescriptors ?? []),
])

const examplesPresent = fs.existsSync(EXAMPLES_ROOT)
const describeIf = examplesPresent ? describe : describe.skip

describeIf('computeAgentTokenUsageFromDir', () => {
  it('produces a positive, self-consistent breakdown', () => {
    const usage = computeAgentTokenUsageFromDir(path.join(EXAMPLES_ROOT, 'company_researcher'))
    expect(usage.agent).toBeGreaterThan(0)
    expect(usage.outcome).toBeGreaterThan(0)

    const skillSum = usage.skills.reduce((sum, skill) => sum + skill.tokens, 0)
    const toolSum = usage.tools.reduce((sum, tool) => sum + tool.tokens, 0)
    const subSum = usage.subAgents.reduce((sum, sub) => sum + sub.tokens, 0)
    expect(usage.self).toBe(usage.agent + usage.outcome + skillSum + toolSum)
    expect(usage.total).toBe(usage.self + subSum)

    for (const skill of usage.skills) {
      expect(skill.tokens).toBe(skill.files.reduce((sum, file) => sum + file.tokens, 0))
    }
  })

  // Guards that the generator's baked walker stays in sync with the runtime one.
  it.each(CASES)('baked manifest tokenUsage matches the live walker for $id', ({ dir, id }) => {
    const descriptor = allDescriptors.find((entry) => entry.id === id)
    expect(descriptor).toBeDefined()
    expect(descriptor?.tokenUsage).toEqual(computeAgentTokenUsageFromDir(path.join(EXAMPLES_ROOT, dir)))
  })
})
