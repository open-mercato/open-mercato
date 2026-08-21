/**
 * Claude Code hook parity between the two generators that install them.
 *
 * A scaffold's `.claude/settings.json` registers hooks by path, and two independent
 * generators write that file: the create-app wizard (`src/setup/tools/claude-code.ts`) and
 * `mercato agentic:init` (`packages/cli/src/lib/agentic-setup.ts`). When only one of them
 * learned about a newly added hook, the other shipped a settings file pointing at a
 * non-existent script — which fails on every tool call it is registered for, not once.
 *
 * These assertions are about the two install paths agreeing with each other and with the
 * registrations, not about any single hook.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const hooksDir = new URL('../../agentic/claude-code/hooks/', import.meta.url)
const settingsPath = new URL('../../agentic/claude-code/settings.json', import.meta.url)
const wizardSource = fs.readFileSync(new URL('../setup/tools/claude-code.ts', import.meta.url), 'utf8')
const cliSetupSource = fs.readFileSync(
  new URL('../../../cli/src/lib/agentic-setup.ts', import.meta.url),
  'utf8',
)

function shippedHookFiles(): string[] {
  return fs.readdirSync(hooksDir).filter((entry) => entry.endsWith('.ts') || entry.endsWith('.mjs')).sort()
}

test('every shipped Claude hook is installed by the create-app wizard', () => {
  const hooks = shippedHookFiles()
  assert.ok(hooks.length > 0, 'expected at least one hook in agentic/claude-code/hooks/')
  for (const hook of hooks) {
    assert.ok(
      wizardSource.includes(`hooks/${hook}`),
      `packages/create-app/src/setup/tools/claude-code.ts does not copy hooks/${hook}`,
    )
  }
})

function claudeGeneratorBody(): string {
  const start = cliSetupSource.indexOf('function generateClaudeCode(')
  assert.ok(start !== -1, 'expected agentic-setup.ts to define generateClaudeCode')
  const end = cliSetupSource.indexOf('\nfunction ', start + 1)
  return cliSetupSource.slice(start, end === -1 ? undefined : end)
}

test('mercato agentic:init installs Claude hooks from disk rather than a hand-kept list', () => {
  // Deriving the set from the source tree is what makes the two paths stay in step; an
  // enumerated list is exactly how gate-evidence.ts came to be registered but never copied.
  const body = claudeGeneratorBody()
  assert.ok(
    body.includes('claudeHookFiles(config.experimentalHooksValidator)'),
    'generateClaudeCode should install hooks via the policy-filtered disk-derived helper',
  )
  assert.ok(
    !/copyFile\(srcDir, `?'?hooks\/[A-Za-z]/.test(body),
    'generateClaudeCode should not copy individual hook files by name',
  )
})

test('mercato agentic:init claims every installed hook in its ownership manifest', () => {
  // Paths missing from the manifest are never refreshed by --update-harness, so an app set
  // up before a hook existed would never receive it.
  const ownershipBlock = cliSetupSource.slice(
    cliSetupSource.indexOf("paths.add(join(targetDir, 'CLAUDE.md'))"),
  )
  assert.ok(
    ownershipBlock.includes('for (const hook of claudeHookFiles(config.experimentalHooksValidator))'),
    'agentic-setup.ts ownership manifest should claim every disk-derived Claude hook',
  )
})

test('every hook registered in settings.json exists on disk', () => {
  const settings = fs.readFileSync(settingsPath, 'utf8')
  const registered = [...settings.matchAll(/\.claude\/hooks\/([A-Za-z0-9._-]+)/g)].map((match) => match[1])
  assert.ok(registered.length > 0, 'expected settings.json to register at least one hook')
  for (const hook of new Set(registered)) {
    assert.ok(
      fs.existsSync(path.join(hooksDir.pathname, hook)),
      `settings.json registers .claude/hooks/${hook}, which does not exist in the source tree`,
    )
  }
})
