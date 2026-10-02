import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sharedRootTemplate = fileURLToPath(new URL('../../agentic/shared/AGENTS.md.template', import.meta.url))
const fallbackRoot = fileURLToPath(new URL('../../template/AGENTS.md', import.meta.url))

// template/AGENTS.md is the --agents none fallback root and is maintained by hand next to the
// agentic template; only the H1 title may differ, so every rule edit must land in both files.
test('the fallback root and the agentic root template differ only in their H1 title', () => {
  const [sharedLines, fallbackLines] = [sharedRootTemplate, fallbackRoot]
    .map((file) => fs.readFileSync(file, 'utf8').split('\n'))
  assert.match(sharedLines[0], /^# /)
  assert.match(fallbackLines[0], /^# /)
  assert.equal(fallbackLines.slice(1).join('\n'), sharedLines.slice(1).join('\n'))
})
