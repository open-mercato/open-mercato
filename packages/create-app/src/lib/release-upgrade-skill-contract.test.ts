import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const changelogOverride = fs.readFileSync(
  new URL('../../../../.ai/skills/om-auto-update-changelog/SKILL.md', import.meta.url),
  'utf8',
)

test('the changelog override owns deterministic upgrade-window reconciliation', () => {
  assert.match(changelogOverride, /whose `<from>` equals the changelog release immediately below/)
  assert.match(changelogOverride, /semantic-version equality, not substring matching/)
  assert.match(changelogOverride, /More than one candidate, or a second section already targeting/)
  assert.match(changelogOverride, /Stop before edits and report the conflicting headings/)
  assert.match(changelogOverride, /An already aligned heading is an idempotent no-op/)
})

test('the changelog override requires a dual-surface migration companion', () => {
  assert.match(changelogOverride, /\.ai\/skills\/<skill>\/SKILL\.md/)
  assert.match(
    changelogOverride,
    /packages\/create-app\/agentic\/shared\/ai\/skills\/<skill>\/SKILL\.md.*byte-identical/,
  )
  assert.match(changelogOverride, /\.ai\/skills\/tiers\.json.*under `migration`/)
  assert.match(
    changelogOverride,
    /packages\/create-app\/agentic\/shared\/ai\/skills\/tiers\.json.*under `migration`/,
  )
  assert.match(changelogOverride, /Automatic.*Detect and report.*No code action/s)
})

test('the changelog override preserves dry-run and validation safety', () => {
  assert.match(changelogOverride, /With `--dry-run`/)
  assert.match(changelogOverride, /without editing any file or invoking `om-auto-create-pr`/)
  assert.match(changelogOverride, /bash scripts\/validate-skills-tiers\.sh/)
  assert.match(changelogOverride, /yarn workspace create-mercato-app test/)
})
