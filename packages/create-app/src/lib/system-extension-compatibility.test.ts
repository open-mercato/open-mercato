import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const skillUrl = new URL('../../agentic/shared/ai/skills/om-system-extension/SKILL.md', import.meta.url)

test('component overrides read compatibility even while preserving public IDs and props', () => {
  const skill = fs.readFileSync(skillUrl, 'utf8')
  const routing = skill.split('\n').find((line) => line.startsWith('Route before reading:'))
  assert.ok(routing)
  assert.match(routing, /Component replacement\/wrapper\/propsTransform MUST read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md` for public IDs\/props/)
  assert.doesNotMatch(routing, /Preserving a host contract through a documented extension does not by itself require the backward-compatibility guide/)
  assert.match(skill, /Keep injected\/override IDs stable and prefer additive\/wrapper behavior over full replacement/)
})

test('ordinary preserving extensions keep their bounded compatibility and routing gates', () => {
  const skill = fs.readFileSync(skillUrl, 'utf8')
  const routing = skill.split('\n').find((line) => line.startsWith('Route before reading:'))
  assert.ok(routing)
  assert.match(routing, /others need it only for host-contract changes/)
  assert.match(routing, /A supported page\/module override stays `umes` unless the request also needs custom UI or an unresolved ownership decision/)
  assert.match(skill, /An extension cannot weaken host auth, scope, mutation guards, commands, or locking/)
  assert.match(skill, /host status-command guard changes a public contract: read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md`/)
})
