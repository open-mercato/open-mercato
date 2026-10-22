import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('returns and RMA reuse the shipped claims aggregate after resolving its facts', () => {
  const blueprints = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md', import.meta.url), 'utf8')
  const returns = blueprints.split('\n').find(line => line.startsWith('| “Create a returns and RMA management module.”'))
  assert.ok(returns)
  assert.match(returns, /When shipped, first read `\.ai\/guides\/modules\/warranty_claims\/index\.md`/)
  assert.match(returns, /reuse its claim aggregate, lifecycle, and portal/)
  assert.match(returns, /app-owned distinct data \+ UMES order\/customer links/)
  assert.match(returns, /quantities never exceed fulfillment; scalar snapshots; idempotent state transitions; refund requires explicit guarded action/)
})
