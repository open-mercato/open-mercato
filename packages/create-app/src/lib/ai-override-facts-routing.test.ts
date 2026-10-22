import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('installed AI replacement resolves runtime and target facts without expanding attachment context', () => {
  const reference = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-create-ai-agent/references/attachments-and-overrides.md', import.meta.url), 'utf8')
  assert.match(reference, /For installed agent\/tool replacement or disable, first read `\.ai\/guides\/modules\/ai_assistant\/index\.md` and the target module's fact sheet before choosing the override/)
  assert.match(reference, /keep map key equal to definition ID\/name\. Use `null` to disable/)
  assert.match(reference, /Extensions apply to an existing enabled agent and cannot resurrect a disabled one/)
  assert.match(reference, /discovered `ai-agents\.ts`\/`ai-tools\.ts` or supported `src\/modules\.ts` override domains; run generation/)
  const skill = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-create-ai-agent/SKILL.md', import.meta.url), 'utf8')
  assert.match(skill, /An authorized AI file upload stays on the attachment branch/)
  assert.match(skill, /Do not probe `ai_assistant` facts unless the task is MCP\/OpenCode\/Code Mode work/)
})
