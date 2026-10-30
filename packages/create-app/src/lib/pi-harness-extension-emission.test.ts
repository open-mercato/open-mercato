import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateShared } from '../setup/tools/shared.js'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const source = new URL('../../agentic/shared/scripts/pi-harness-extension.mjs', import.meta.url)
const relative = 'scripts/pi-harness-extension.mjs'

type Result = { content?: Array<{ type: string; text: string }> }
type Handler = (event: Record<string, unknown>) => Result | undefined

async function assertEmittedDelivery(file: string) {
  let handler: Handler = () => undefined
  if (fs.existsSync(file)) {
    const extension = await import(pathToFileURL(file).href)
    extension.default({ on(name: string, value: Handler) { assert.equal(name, 'tool_result'); handler = value } })
  }
  const text = `start:${'a'.repeat(25000)}EMITTED_MIDDLE${'z'.repeat(25000)}:end`
  const clipped = 'start:…truncated…:end'
  const result = handler({
    type: 'tool_result', toolName: 'mcp__harness__read', isError: false,
    input: { path: '.ai/guides/contracts.md' }, details: { server: 'harness', tool: 'read' },
    content: [{ type: 'text', text: clipped }], structuredContent: { content: [{ type: 'text', text }] },
  })
  assert.equal(result?.content?.[0].text ?? clipped, text, 'the emitted extension must deliver the complete approved read')
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(source))
}

async function application(run: (directory: string) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-pi-extension-emission-'))
  fs.mkdirSync(path.join(directory, 'src'))
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'pi-delivery-fixture', private: true, type: 'module' }))
  fs.writeFileSync(path.join(directory, 'src/modules.ts'), 'export const enabledModules = []\n')
  try { await run(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

test('the actual wizard source generator emits a usable complete-read Pi extension', () => application(async directory => {
  generateShared({ projectName: 'pi-delivery-fixture', targetDir: directory })
  await assertEmittedDelivery(path.join(directory, relative))
}))

test('the actual CLI source generator emits a usable complete-read Pi extension', () => application(async directory => {
  const generator = pathToFileURL(path.join(repository, 'packages/cli/src/lib/agentic-setup.ts')).href
  const invocation = `import { runAgenticSetup } from ${JSON.stringify(generator)}; await runAgenticSetup(${JSON.stringify(directory)}, async () => { throw new Error('unexpected interactive prompt') }, { tool: 'codex' });`
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', invocation], {
    cwd: repository,
    env: { ...process.env, OM_SKIP_EXTERNAL_SKILLS: '1', CI: '1', NO_COLOR: '1' },
    encoding: 'utf8', timeout: 30000,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  await assertEmittedDelivery(path.join(directory, relative))
}))

test('both built package delivery owners ship the usable authoritative Pi extension', async () => {
  for (const owner of ['packages/create-app', 'packages/cli']) {
    await assertEmittedDelivery(path.join(repository, owner, 'dist/agentic/shared', relative))
  }
})
