import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts: typeof import('typescript') = require('typescript-standalone')
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const seeds = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/fixtures/seeds.json', import.meta.url), 'utf8')) as { fixtures: Record<string, Record<string, string>> }
const interceptorPath = 'src/modules/app_customizations/api/interceptors.ts'

test('the interceptor regression seed implements the installed API while retaining unsafe query behavior', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-coding-fixture-contract-'))
  try {
    const source = seeds.fixtures['umes-api-interceptor'][interceptorPath]
    const seedFile = path.join(directory, 'interceptors.ts')
    const contractFile = path.join(directory, 'contract.ts')
    const actualContract = path.join(repository, 'packages/shared/src/lib/crud/api-interceptor')
    fs.writeFileSync(seedFile, source)
    fs.writeFileSync(contractFile, `import type { ApiInterceptor } from ${JSON.stringify(actualContract)}\nimport { interceptors } from './interceptors'\nexport const installedContract: ApiInterceptor[] = interceptors\n`)
    const options = {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
      paths: { '@open-mercato/shared/*': [path.join(repository, 'packages/shared/src/*')] },
    }
    const program = ts.createProgram([contractFile, seedFile], options)
    const contract = program.getSourceFile(contractFile)
    const seed = program.getSourceFile(seedFile)
    assert.ok(contract)
    assert.ok(seed)
    const errors = [...program.getSemanticDiagnostics(contract), ...program.getSemanticDiagnostics(seed)]
    assert.deepEqual(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')), [])

    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const exports: { interceptors?: { targetRoute: string; methods: string[]; before: (request: { query: Record<string, unknown> }) => Promise<{ ok: boolean; query: Record<string, unknown> }> }[] } = {}
    vm.runInNewContext(compiled, { exports }, { timeout: 1000 })
    const interceptor = exports.interceptors?.[0]
    assert.ok(interceptor)
    assert.equal(interceptor.targetRoute, 'customers/people')
    assert.ok(interceptor.methods.includes('GET'))
    const outcome = await interceptor.before({ query: { tenant_id: 'untrusted-tenant', organization_id: 'untrusted-organization' } })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.query.tenant_id, 'untrusted-tenant')
    assert.equal(outcome.query.organization_id, 'untrusted-organization')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
