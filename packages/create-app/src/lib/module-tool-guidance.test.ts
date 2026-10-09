import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (relative: string): string => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')

test('standalone module tooling has one routed owner for creation, publication and continued app development', () => {
  const guide = read('agentic/guides/architecture.md')
  const section = guide.split('## Create and Publish App Modules')[1]?.split('\n## ')[0] ?? ''
  const commands = [...section.matchAll(/^npx create-mercato-module (.+)$/gm)].map(match => match[1])
  assert.ok(commands.some(command => command === 'init visits'), 'missing supported module starter command')
  assert.ok(commands.some(command => /^publish visits .*--dry-run/.test(command)), 'missing local archive preview')
  assert.ok(commands.some(command => command === 'publish visits'), 'missing explicit publication command')
  assert.ok(commands.some(command => command === 'link visits'), 'missing continued repository development command')
  assert.match(section, /existing module.*skip `init`/i)
  assert.match(section, /publication.*(?:copies|copy).*source.*(?:remains|stays)/is)
  assert.match(section, /--allow-third-party/)
  assert.match(section, /(?:NPM_TOKEN|NODE_AUTH_TOKEN)/)
  assert.match(section, /trusted.*(?:configure|configuration).*npm/is)
  assert.match(section, /link.*local.*fresh clone/is)
  assert.match(section, /generated.*(?:never edit|do not edit)/is)
  for (const root of ['agentic/shared/AGENTS.md.template', 'template/AGENTS.md']) {
    assert.match(read(root), /Create, publish, or link an app module.*architecture\.md#.*app-modules/)
  }
  assert.match(read('agentic/shared/ai/skills/om-module-scaffold/SKILL.md'), /architecture\.md#create-and-publish-app-modules/)
})
