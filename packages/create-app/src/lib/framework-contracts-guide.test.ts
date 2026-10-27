import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const guidePath = fileURLToPath(new URL('../../agentic/guides/framework-contracts.md', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

test('framework contract digest stays bounded and covers every named contract', () => {
  const guide = fs.readFileSync(guidePath, 'utf8')
  const bytes = Buffer.byteLength(guide)
  assert.ok(bytes >= 6 * 1024, `framework contract digest is too shallow: ${bytes} bytes`)
  assert.ok(bytes <= 8 * 1024, `framework contract digest exceeds its context budget: ${bytes} bytes`)

  for (const required of [
    'CommandHandler',
    '`prepare(input, ctx)`',
    '`execute(input, ctx)`',
    '`buildLog({ input, result, ctx, snapshots })`',
    '`registerCommand`',
    '`runCrudCommandWrite`',
    '`makeCrudRoute`',
    '`hooks.beforeList(validatedQuery, ctx)`',
    '`list.transformItem(item)`',
    '`hooks.afterList(payload, { ...ctx, query })`',
    '`actions.create`',
    '`actions.update`',
    '`actions.delete`',
    'does not double-emit',
    '`createModuleEvents`',
    '`eventsConfig.emit(eventId, payload, options)`',
    '`assertOptimisticLock`',
    '`expected_updated_at`',
    '`readJsonSafe`',
    '`createOrmEntity`',
    '`updateOrmEntity`',
    '`deleteOrmEntity`',
  ]) assert.ok(guide.includes(required), `framework contract digest is missing ${required}`)
})

test('every installed framework source link resolves to a published workspace source', () => {
  const guide = fs.readFileSync(guidePath, 'utf8')
  const links = [...guide.matchAll(/\(\.\.\/\.\.\/node_modules\/@open-mercato\/([^/)]+)\/([^)]*)\)/g)]
  assert.ok(links.length >= 8)
  for (const [, packageName, packageRelativePath] of links) {
    const workspaceSource = path.join(repoRoot, 'packages', packageName, packageRelativePath)
    assert.ok(fs.statSync(workspaceSource).isFile(), `missing installed-source target ${workspaceSource}`)
  }
})
