import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateWritableAstOracle } from '../../agentic/shared/ai/harness/writable-ast-oracles.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript-standalone') as typeof import('typescript-standalone')
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const targetTypeScript = path.dirname(require.resolve('typescript-standalone/package.json'))
const routePath = 'src/modules/library/api/books/checkout/route.ts'

function route(alias = 'runRouteMutationGuards') {
  return `import { runRouteMutationGuards${alias === 'runRouteMutationGuards' ? '' : ` as ${alias}`} } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.orgId) return Response.json({ error: 'Organization required' }, { status: 400 })
  const container = await createRequestContainer()
  const guard = await ${alias}({ container, req, auth: { userId: auth.sub, tenantId: auth.tenantId, organizationId: auth.orgId }, input: { resourceKind: 'library:book', operation: 'custom', mutationPayload: {} } })
  if (!guard.ok) return guard.response
  await guard.runAfterSuccess()
  return Response.json({ ok: true })
}
`
}

function fixture(source: string, run: (root: string) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-command-guard-')))
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.symlinkSync(targetTypeScript, path.join(root, 'node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"command-guard-contract","private":true,"type":"module"}')
  fs.mkdirSync(path.dirname(path.join(root, routePath)), { recursive: true })
  fs.writeFileSync(path.join(root, routePath), source)
  fs.mkdirSync(path.join(root, 'src/modules/library/commands'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/modules/library/commands/checkout.ts'), 'export const commandFixture = true\n')
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function check(root: string, id = 'command.guards') {
  const result = evaluateWritableAstOracle({ root, caseId: 'OMH-012', phase: 'before' }) as { checks: Array<{ id: string; passed: boolean }> }
  const found = result.checks.find(entry => entry.id === id)
  assert.ok(found, `the real oracle must emit ${id}`)
  return found.passed
}

function fixtureDiagnostics(root: string) {
  const config = ts.readConfigFile(path.join(repository, 'tsconfig.base.json'), ts.sys.readFile)
  assert.equal(config.error, undefined)
  const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, repository).options
  const program = ts.createProgram([path.join(root, routePath)], {
    ...options, noEmit: true, incremental: false, composite: false, skipLibCheck: true,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  const modules = path.join(root, 'src/modules')
  return ts.getPreEmitDiagnostics(program).filter(entry => {
    if (!entry.file) return false
    const relative = path.relative(modules, entry.file.fileName)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  })
}

for (const alias of ['runRouteMutationGuards', 'guardRouteMutation']) {
  test(`the real typed modern registry wrapper is recognized from checkout POST: ${alias}`, () => fixture(route(alias), root => {
    assert.equal(check(root), true)
    assert.equal(check(root, 'command.atomic'), false, 'this isolated guard fixture cannot satisfy the unchanged atomic check')
  }))
}

for (const [label, source] of [
  ['unused import', route().replace(/const guard = await runRouteMutationGuards\([^\n]+\)\n  if \(!guard.ok\) return guard.response\n  await guard.runAfterSuccess\(\)/, 'const untouched = true')],
  ['comment only', `// ${route().replaceAll('\n', '\n// ')}\nexport async function POST() { return Response.json({ ok: true }) }`],
  ['dead helper', route().replace('export async function POST(req: Request)', 'async function unused(req: Request)') + '\nexport async function POST() { return Response.json({ ok: true }) }'],
  ['wrong module homonym', route().replace('@open-mercato/shared/lib/crud/route-mutation-guard', './local-guard')],
  ['wrong imported symbol', route('guardRouteMutation').replace('runRouteMutationGuards as guardRouteMutation', 'toRegistryMutationOperation as guardRouteMutation')],
  ['type-only import', route().replace('import { runRouteMutationGuards }', 'import type { runRouteMutationGuards }')],
  ['shadowed import', route().replace('POST(req: Request)', 'POST(req: Request, runRouteMutationGuards: (value: unknown) => Promise<never>)')],
  ['let shadowing guard import', route().replace('const guard =', 'let runRouteMutationGuards = async (_value: unknown) => ({ ok: true, runAfterSuccess: async () => {} })\n  const guard =')],
  ['var shadowing auth import', route().replace('const auth =', 'var getAuthFromRequest = async (_request: Request) => ({ sub: "user", tenantId: "tenant", orgId: "org" })\n  const auth =')],
  ['function shadowing container import', route().replace('const container =', 'async function createRequestContainer() { return {} }\n  const container =')],
  ['destructured guard parameter', route().replace('POST(req: Request)', 'POST(req: Request, { nested: { runRouteMutationGuards } }: { nested: { runRouteMutationGuards: (value: unknown) => Promise<never> } })')],
  ['destructured auth parameter', route().replace('POST(req: Request)', 'POST(req: Request, [getAuthFromRequest]: [(request: Request) => Promise<never>])')],
  ['discarded rejection', route().replace('if (!guard.ok) return guard.response', 'if (!guard.ok) return Response.json({ ok: true })')],
  ['unchecked rejection', route().replace('if (!guard.ok) return guard.response', '')],
  ['wrong tenant scope', route().replace('tenantId: auth.tenantId', "tenantId: 'foreign-tenant'")],
  ['wrong organization scope', route().replace('organizationId: auth.orgId', "organizationId: 'foreign-organization'")],
  ['wrong user scope', route().replace('userId: auth.sub', "userId: 'another-user'")],
  ['rewritten authenticated scope', route().replace('const container =', "auth.tenantId = 'foreign-tenant'\n  const container =")],
  ['body-derived scope', route().replace('tenantId: auth.tenantId', "tenantId: new URL(req.url).searchParams.get('tenant')!")],
  ['spread overriding trusted scope', route().replace("organizationId: auth.orgId }", "organizationId: auth.orgId, ...{ tenantId: 'foreign-tenant' } }")],
  ['different request', route().replace('{ container, req, auth:', "{ container, req: new Request('https://example.invalid'), auth:")],
  ['different operation', route().replace("operation: 'custom'", "operation: 'create'")],
  ['wrong resource module', route().replace("resourceKind: 'library:book'", "resourceKind: 'customers:person'")],
  ['unawaited guard', route().replace('const guard = await runRouteMutationGuards', 'const guard = runRouteMutationGuards')],
  ['unreachable guard', route().replace('const guard =', 'return Response.json({ ok: true })\n  const guard =')],
  ['guard after command dispatch', route().replace('const guard =', "await container.resolve<{ execute(): Promise<void> }>('commandBus').execute()\n  const guard =")],
] as const) {
  test(`modern guard recognition rejects ${label}`, () => fixture(source, root => assert.equal(check(root), false)))
}

test('an unconnected correct wrapper in another route or command cannot satisfy checkout protection', () => fixture('export async function POST() { return Response.json({ ok: true }) }', root => {
  fs.writeFileSync(path.join(root, 'src/modules/library/commands/orphan.ts'), route())
  assert.equal(check(root), false)
}))

test('the existing low-level guard recognition and atomic predicate remain unchanged', () => fixture("export async function POST() { await runMutationGuards(); return Response.json({}) }", root => {
  assert.equal(check(root), true)
  assert.equal(check(root, 'command.atomic'), false)
}))

test('real wrapper types accept valid aliases and reject invalid scope and nonexistent imports', () => {
  for (const alias of ['runRouteMutationGuards', 'guardRouteMutation']) {
    fixture(route(alias), root => assert.deepEqual(fixtureDiagnostics(root).map(entry => ts.flattenDiagnosticMessageText(entry.messageText, '\n')), []))
  }
  for (const source of [route().replace('tenantId: auth.tenantId', 'tenantId: 42'), route().replace('runRouteMutationGuards }', 'missingGuardExport as runRouteMutationGuards }')]) {
    fixture(source, root => assert.ok(fixtureDiagnostics(root).length > 0))
  }
})

test('typed guard controls include diagnostics from imported fixture-owned modules', () => fixture("import { marker } from '../../../fixture-invalid'\n" + route(), root => {
  fs.writeFileSync(path.join(root, 'src/modules/library/fixture-invalid.ts'), 'export const marker: string = 42\n')
  assert.ok(fixtureDiagnostics(root).some(entry => entry.file?.fileName.endsWith('fixture-invalid.ts')))
}))
