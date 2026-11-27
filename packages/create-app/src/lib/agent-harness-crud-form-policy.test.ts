import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const sharedRoot = path.join(packageRoot, 'agentic/shared')
const harness = path.join(sharedRoot, 'ai/harness')
const exampleRoot = 'src/modules/example'
const owner = '.ai/skills/om-system-extension/references/extension-branches.md'
const mainReference = 'om-system-extension/extension-branches:form-sections.ts'
const c3Source = 'references/crud-form-extensions/required-coverage.md'
const c10Source = 'references/module-overrides.reference.ts'
const source = (relative: string) => `${exampleRoot}/${relative}`
const selectedSources = [
  ['todo-showcase-update.client.ts'],
  ['todo-showcase-create.client.ts'],
  [c3Source],
  ['todo-showcase-status.client.ts'],
  ['todo-showcase-sections.client.ts'],
  ['todo-showcase-sections.client.ts'],
  ['data/entities.ts', 'components/TodoShowcaseForm.tsx'],
  ['components/TodoShowcaseForm.tsx'],
  ['lib/exampleExternalErp.ts', 'components/TodoShowcaseSync.tsx'],
  [c10Source],
  ['api/todos/route.ts', 'lib/todoShowcaseClient.ts'],
  ['components/TodoForm.tsx', 'backend/todos/create/page.tsx', 'backend/todos/[id]/edit/page.tsx'],
] as const

type ExamplePolicy = {
  context: {
    required: string[]
    sourceReferenceIds: string[]
    exampleRoots: Array<{
      root: string
      entrypoints: string[]
      allowedCapabilityIds: string[]
      maxFiles: number
      maxBytes: number
    }>
    installedVersionFallback?: unknown
  }
  allowedWrites?: string[]
}
type CatalogRecord = ExamplePolicy & { id: string; mode: string; evaluationKind: string }
type ProjectedReference = { referenceId: string; href?: string }
type Evaluator = {
  validateExampleReadPolicyDeclaration: (record: ExamplePolicy, root: string) => string[]
  evaluateExampleReadPolicy: (input: { caseRecord: ExamplePolicy; appRoot: string; reads: Array<{ path: string }> }) => {
    firstViolation: string | null
    roots: Array<{ capabilities: string[] }>
    references: { followed: ProjectedReference[] }
    fallback: { reason: string | null }
  }
  caseReadAllowlist: (record: ExamplePolicy, writable: boolean, root: string) => string[]
  immutableExampleRoots: (record: ExamplePolicy) => string[]
  resolveSourceReference: (input: {
    referenceId: string
    inventory: { byId: Map<string, ProjectedReference> }
    appRoot: string
    routedOwners: Set<string>
  }) => { violation?: string; resolvedPath?: string; originAsset?: string }
}

function stagePolicyApp(root: string): void {
  const copy = (origin: string, relative: string) => {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(origin, target)
  }
  fs.cpSync(path.join(packageRoot, 'template', exampleRoot), path.join(root, exampleRoot), { recursive: true })
  copy(path.join(sharedRoot, 'ai/skills/tiers.json'), '.ai/skills/tiers.json')
  copy(path.join(harness, 'source-link-inventory.json'), '.ai/harness/source-link-inventory.json')
  copy(path.join(sharedRoot, owner.slice(1)), owner)
}

test('Todo showcase routes all twelve examples through exact emitted links and bounded immutable reads', async (context) => {
  const evaluator = await import(pathToFileURL(path.join(sharedRoot, 'scripts/evaluate-agent-harness.mjs')).href) as Evaluator
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-crud-policy-'))
  try {
    stagePolicyApp(appRoot)
    const emittedOwner = fs.readFileSync(path.join(appRoot, owner), 'utf8')
    const actualCatalog = JSON.parse(fs.readFileSync(path.join(harness, 'cases.json'), 'utf8')) as CatalogRecord[]
    const { records } = JSON.parse(fs.readFileSync(path.join(appRoot, '.ai/harness/source-link-inventory.json'), 'utf8')) as {
      records: ProjectedReference[]
    }
    const byId = new Map(records.map((record) => [record.referenceId, record]))
    const allRequiredReadPaths = new Set(selectedSources.flat().map(source))
    for (const [index, additional] of selectedSources.entries()) {
      const id = `OMH-${244 + index}`
      const capabilityId = `example.crud-form-extensions.c${index + 1}`
      await context.test(id, () => {
        const extraReference = index === 2 ? c3Source : index === 9 ? c10Source : null
        const referenceIds = [mainReference, ...(extraReference ? [`om-system-extension/extension-branches:${extraReference}`] : [])]
        const requiredReadPaths = [source('form-sections.ts'), ...additional.map(source)]

        // Run intended case permissions against emitted metadata even when the old catalog does
        // not know this case. The base must fail through the existing semantic read-policy validator.
        const contract = {
          context: {
            required: [owner, ...requiredReadPaths],
            sourceReferenceIds: referenceIds,
            exampleRoots: [{
              root: exampleRoot, entrypoints: ['form-sections.ts'], allowedCapabilityIds: [capabilityId],
              maxFiles: requiredReadPaths.length + 2, maxBytes: 262_144,
            }],
          },
        }
        assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(contract, appRoot), [])

        const record = actualCatalog.find((entry) => entry.id === id)
        assert.ok(record)
        assert.equal(record.mode, 'analysis')
        assert.equal(record.evaluationKind, 'routing')
        assert.deepEqual(record.allowedWrites ?? [], [])
        assert.equal(record.context.installedVersionFallback, undefined)
        assert.deepEqual(evaluator.immutableExampleRoots(record), [exampleRoot])
        assert.deepEqual(record.context.sourceReferenceIds, referenceIds)
        assert.equal(record.context.exampleRoots.length, 1)
        assert.deepEqual(record.context.exampleRoots[0].entrypoints, ['form-sections.ts'])
        assert.deepEqual(record.context.exampleRoots[0].allowedCapabilityIds, [capabilityId])
        assert.ok(requiredReadPaths.every((relative) => record.context.required.includes(relative)))
        assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(record, appRoot), [])
        const allowed = evaluator.caseReadAllowlist(record, false, appRoot)

        for (const referenceId of referenceIds) {
          const projected = byId.get(referenceId)
          assert.ok(projected?.href && emittedOwner.includes(`](${projected.href})`), 'the routed owner must visibly link the exact projected source')
          const resolved = evaluator.resolveSourceReference({
            referenceId, inventory: { byId }, appRoot, routedOwners: new Set(record.context.required),
          })
          assert.equal(resolved.violation, undefined)
          assert.equal(resolved.originAsset, owner)
          assert.ok(resolved.resolvedPath && requiredReadPaths.includes(resolved.resolvedPath))
        }
        const trace = (paths: string[]) => evaluator.evaluateExampleReadPolicy({
          caseRecord: record, appRoot, reads: paths.map((relative) => ({ path: relative })),
        })
        assert.match(trace([requiredReadPaths[0]]).firstViolation ?? '', /before its origin owner/)
        const followed = trace([owner, ...requiredReadPaths, source('references/surface-inventory.json')])
        assert.equal(followed.firstViolation, null)
        assert.deepEqual(followed.references.followed.map(({ referenceId }) => referenceId), referenceIds)
        assert.deepEqual(followed.roots[0].capabilities, [capabilityId])
        assert.equal(followed.fallback.reason, null)
        assert.ok(requiredReadPaths.every((relative) => allowed.includes(relative)))
        const crossCase = [...allRequiredReadPaths].find((relative) => !allowed.includes(relative))
        assert.ok(crossCase)
        assert.match(trace([owner, requiredReadPaths[0], crossCase]).firstViolation ?? '', /did not declare/)
        assert.ok(allowed.filter((relative) => relative.startsWith(`${exampleRoot}/`))
          .every((relative) => !/\/__(?:tests|integration)__\//.test(relative)))
        if (index === 2) {
          assert.match(fs.readFileSync(path.join(appRoot, source(c3Source)), 'utf8'), /(?:required|coverage)/i)
          const qaPath = source('__integration__/TC-EXAMPLE-FORM-003-uncovered.spec.ts')
          assert.ok(!allowed.includes(qaPath))
          assert.ok(trace([owner, requiredReadPaths[0], qaPath]).firstViolation)
        }
        if (index === 9) {
          assert.match(fs.readFileSync(path.join(appRoot, source(c10Source)), 'utf8'), /['"]example\.todo\/showcase\/update\/observer['"]:\s*null/)
        }
      })
    }
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true })
  }
})
