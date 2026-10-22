import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (relative: string): string => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')

test('standalone module tooling has one routed owner for creation, publication and continued app development', () => {
  const guidePath = new URL('../../agentic/guides/module-tool.md', import.meta.url)
  const section = fs.existsSync(guidePath) ? fs.readFileSync(guidePath, 'utf8') : ''
  const commands = [...section.matchAll(/^npx create-mercato-module (.+)$/gm)].map(match => match[1])
  assert.ok(commands.some(command => command === 'init visits'), 'missing supported module starter command')
  assert.ok(commands.some(command => /^publish visits .*--dry-run/.test(command)), 'missing local archive preview')
  assert.ok(commands.some(command => command === 'publish visits'), 'missing explicit publication command')
  assert.ok(commands.some(command => command === 'link visits'), 'missing continued repository development command')
  assert.match(section, /existing module.*skip `init`/i)
  assert.match(section, /publication.*(?:copies|copy).*source.*(?:remains|stays)/is)
  assert.match(section, /--allow-third-party/)
  assert.match(section, /module add @your-scope\/mercato-visits@file:\/absolute\/path\/to\/package\.tgz --allow-third-party/)
  assert.doesNotMatch(section, /module add \/absolute\/path\/to\/package\.tgz/)
  assert.match(section, /(?:NPM_TOKEN|NODE_AUTH_TOKEN)/)
  assert.match(section, /trusted.*(?:configure|configuration).*npm/is)
  assert.match(section, /link.*local.*fresh clone/is)
  assert.match(section, /generated.*(?:never edit|do not edit)/is)
  for (const root of ['agentic/shared/AGENTS.md.template', 'template/AGENTS.md']) {
    assert.match(read(root), /Scaffold module starter; publish\/link an app module.*module-tool\.md/)
  }
  assert.match(read('agentic/guides/architecture.md'), /\.ai\/guides\/module-tool\.md/)
  const scaffold = read('agentic/shared/ai/skills/om-module-scaffold/SKILL.md')
  assert.match(scaffold.split('## Workflow')[0], /npx create-mercato-module init <module_id>/)
  assert.match(scaffold, /existing modules skip `init`/)
  assert.match(scaffold, /With process access/)
  assert.match(scaffold, /Without it, report gap; never claim initialization or bypass the tool/)
  assert.match(scaffold, /module-tool\.md/)
})


test('receiving a published module preserves runtime identity, source provenance and local ownership', () => {
  const guide = read('agentic/guides/module-tool.md')
  assert.match(guide, /alias.{0,100}(?:binding|dependency)/i)
  assert.match(guide, /same runtime (?:module )?ID/i)
  assert.match(guide, /repository.{0,100}(?:does not|never).{0,100}GitHub/i)
  assert.match(guide, /disable.{0,100}(?:consum|entr)/i)
  assert.match(guide, /manual(?:ly authored)? imports/i)
  assert.match(guide, /single.{0,80}overlay/i)
  assert.match(guide, /eject.{0,100}(?:retain|preserv).{0,100}provenance/i)
  const replacementSteps = [...guide.matchAll(/^\d+\. (.+)$/gm)].map(match => match[1])
  const disabledIndex = replacementSteps.findIndex(step => /disable.*consum/i.test(step))
  const dependantsIndex = replacementSteps.findIndex(step => /origin-qualified.*dependants.*manual.*imports/i.test(step))
  const beforeReplacementIndex = replacementSteps.findIndex(step => /generate.*build.*before.*(?:binding|dependency)/i.test(step))
  const replacementIndex = replacementSteps.findIndex(step => /replace.*dependency.*enable/i.test(step))
  const finalVerificationIndex = replacementSteps.findIndex(step => /generate.*build.*again/i.test(step))
  assert.ok(disabledIndex >= 0, 'disable every binding consumer before replacement')
  assert.ok(dependantsIndex > disabledIndex, 'resolve old-origin dependants and manual imports while the provider remains installed')
  assert.ok(beforeReplacementIndex > dependantsIndex, 'require successful generation and build before replacing the binding')
  assert.ok(replacementIndex > beforeReplacementIndex, 'replace the binding only after intermediate verification')
  assert.ok(finalVerificationIndex > replacementIndex, 'verify generation and build again after enabling the replacement')
  for (const source of ['module-install.ts', 'module-identity.ts', 'eject.ts']) {
    assert.ok(guide.includes(`](../../node_modules/@open-mercato/cli/src/lib/${source})`), `missing exact installed ${source} source`)
  }
  const cases = JSON.parse(read('agentic/shared/ai/harness/cases.json')) as Array<{ id: string; requiredDecisions: string[] }>
  const receivingCase = cases.find(({ id }) => id === 'OMH-239')
  assert.ok(receivingCase)
  for (const decision of [
    'module-binding-is-not-runtime-id',
    'npm-github-origins-distinct',
    'one-enabled-provider-per-runtime-id',
    'explicit-provider-replacement',
    'eject-retains-source-provenance',
  ]) assert.ok(receivingCase.requiredDecisions.includes(decision), `missing receiving-module decision ${decision}`)
})

test('local artifact inspection preserves unknown provenance and protects active bindings', () => {
  const guide = read('agentic/guides/module-tool.md')
  assert.match(guide, /local file artifact establishes neither an npm nor a GitHub origin/i)
  assert.match(guide, /omit an unknown `locator`/i)
  assert.match(guide, /active binding replacement must fail before Yarn when its origin cannot be preserved/i)
})

test('receiving-app explanations inspect installed contracts before giving alias replacement or ejection advice', () => {
  const guide = read('agentic/guides/module-tool.md')
  const receiving = guide.slice(guide.indexOf('## Receiving app:'))
  assert.match(receiving, /Before explaining or planning receiving-app installation, aliases, provider replacement, or ejection, read the exact installed CLI contracts/)
  for (const source of ['module-install.ts', 'module-identity.ts', 'eject.ts']) {
    assert.ok(receiving.includes(`../../node_modules/@open-mercato/cli/src/lib/${source}`))
  }
  assert.match(receiving, /These files are read-only evidence/)
  assert.match(receiving, /report that limitation instead of guessing its behavior/)
})
