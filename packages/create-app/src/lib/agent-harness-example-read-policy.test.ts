import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const helperPath = fileURLToPath(new URL('../../agentic/shared/scripts/example-read-policy.mjs', import.meta.url))
const schemaPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/cases.schema.json', import.meta.url))
const casesPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url))
const testTempRoot = fileURLToPath(new URL('../../../../.ai/tmp/', import.meta.url))

type PolicyModule = {
  EXAMPLE_READ_POLICY_LIMITS: {
    rootMaxFiles: number
    rootMaxBytes: number
    fallbackMaxFiles: number
    fallbackMaxBytes: number
  }
  normalizeExampleReadPath: (value: string) => string
  resolveExistingExamplePath: (root: string, relative: string) => { relativePath: string; realPath: string }
  validateCumulativeExampleBudget: (
    usage: { fileCount: number; totalBytes: number },
    budget: { maxFiles: number; maxBytes: number },
  ) => string[]
  validateExampleReadPolicy: (
    context: unknown,
    inventory: Record<string, string[]>,
    options?: { caseRoot?: string },
  ) => { ok: boolean; errors: string[]; policy: { exampleRoots: unknown[]; installedVersionFallback: unknown } }
}

function write(root: string, relative: string, content: string) {
  const destination = path.join(root, relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, content)
}

function stageExampleRoot() {
  fs.mkdirSync(testTempRoot, { recursive: true })
  const caseRoot = fs.realpathSync(fs.mkdtempSync(path.join(testTempRoot, 'om-example-policy-')))
  const root = 'src/modules/reference_module'
  for (const [relative, content] of [
    [`${root}/README.md`, '# Reference\n'],
    [`${root}/references/surface-map.md`, '# Surface map\n'],
    [`${root}/api/route.ts`, 'export const route = true\n'],
    [`${root}/backend/page.tsx`, 'export default function Page() { return null }\n'],
  ]) write(caseRoot, relative, content)
  return {
    caseRoot,
    root,
    inventory: {
      'api.crud-factory': [`${root}/api/route.ts`],
      'ui.crud-form': [`${root}/backend/page.tsx`],
    },
    context: {
      exampleRoots: [{
        root,
        entrypoints: ['README.md', 'references/surface-map.md'],
        allowedCapabilityIds: ['api.crud-factory', 'ui.crud-form'],
        maxFiles: 12,
        maxBytes: 131_072,
      }],
      installedVersionFallback: {
        allowed: true,
        reasonCodes: ['LOCAL_EXAMPLE_MISSING_VERSIONED_CONTRACT'],
        maxFiles: 4,
        maxBytes: 65_536,
      },
    },
  }
}

test('case schema adds optional finite example roots and installed-version fallback without catalog drift', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
    minItems: number
    maxItems: number
    items: {
      properties: { context: { required: string[]; properties: Record<string, unknown> } }
    }
    $defs: Record<string, { properties?: Record<string, { maximum?: number }> }>
  }
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8')) as Array<{ id: string; context: Record<string, unknown> }>
  assert.equal(cases.length, 202)
  assert.equal(schema.minItems, 202)
  assert.equal(schema.maxItems, 202)
  assert.deepEqual(schema.items.properties.context.required, ['required', 'forbidden'])
  assert.ok(schema.items.properties.context.properties.exampleRoots)
  assert.ok(schema.items.properties.context.properties.installedVersionFallback)
  assert.equal(schema.$defs.exampleRoot.properties?.maxFiles.maximum, 16)
  assert.equal(schema.$defs.installedVersionFallback.properties?.maxFiles.maximum, 4)
  assert.ok(cases.every((entry, index) => entry.id === `OMH-${String(index + 1).padStart(3, '0')}`))
  assert.ok(cases.every((entry) => entry.context.exampleRoots === undefined && entry.context.installedVersionFallback === undefined))
})

test('valid capability-scoped roots normalize and resolve exact entrypoints', async () => {
  const policy = await import(pathToFileURL(helperPath).href) as PolicyModule
  const fixture = stageExampleRoot()
  try {
    const result = policy.validateExampleReadPolicy(fixture.context, fixture.inventory, { caseRoot: fixture.caseRoot })
    assert.equal(result.ok, true, result.errors.join('; '))
    assert.deepEqual(result.errors, [])
    assert.equal(policy.normalizeExampleReadPath('src\\modules\\reference_module\\README.md'), 'src/modules/reference_module/README.md')
    const resolved = policy.resolveExistingExamplePath(fixture.caseRoot, `${fixture.root}/README.md`)
    assert.equal(resolved.relativePath, `${fixture.root}/README.md`)
    assert.equal(fs.statSync(resolved.realPath).isFile(), true)
  } finally {
    fs.rmSync(fixture.caseRoot, { recursive: true, force: true })
  }
})

test('path policy rejects traversal, platform absolutes, globs, generated output, credentials, and local ops', async () => {
  const policy = await import(pathToFileURL(helperPath).href) as PolicyModule
  const unsafePaths = [
    '/absolute/example',
    '../escape',
    'C:\\private\\example',
    'C:private\\example',
    '\\\\server\\share',
    '%2e%2e/escape',
    'safe\nescape',
    'src/**',
    'src/.next/cache',
    'src/generated/output.ts',
    '.env.local',
    '.ai/tmp/controller',
    'dist/output.js',
    'secrets.json',
    'keys/private.pem',
  ]
  for (const candidate of unsafePaths) {
    assert.throws(() => policy.normalizeExampleReadPath(candidate), undefined, candidate)
  }

  const fixture = stageExampleRoot()
  const outside = fs.mkdtempSync(path.join(testTempRoot, 'om-example-outside-'))
  try {
    write(outside, 'private.ts', 'secret\n')
    fs.symlinkSync(path.join(outside, 'private.ts'), path.join(fixture.caseRoot, fixture.root, 'escape.ts'))
    assert.throws(
      () => policy.resolveExistingExamplePath(fixture.caseRoot, `${fixture.root}/escape.ts`),
      /symlink outside the case root/,
    )
  } finally {
    fs.rmSync(fixture.caseRoot, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('runtime policy rejects malformed entrypoints, capabilities, and finite budget violations', async () => {
  const policy = await import(pathToFileURL(helperPath).href) as PolicyModule
  const fixture = stageExampleRoot()
  try {
    const variants = [
      [{ ...fixture.context, exampleRoots: [{ ...fixture.context.exampleRoots[0], entrypoints: [] }] }, /entrypoints/],
      [{ ...fixture.context, exampleRoots: [{ ...fixture.context.exampleRoots[0], entrypoints: ['README.md', 'README.md'] }] }, /entrypoints/],
      [{ ...fixture.context, exampleRoots: [{ ...fixture.context.exampleRoots[0], allowedCapabilityIds: ['unknown.capability'] }] }, /unknown capability ID/],
      [{ ...fixture.context, exampleRoots: [{ ...fixture.context.exampleRoots[0], maxFiles: 0 }] }, /maxFiles/],
      [{ ...fixture.context, exampleRoots: [{ ...fixture.context.exampleRoots[0], maxBytes: -1 }] }, /maxBytes/],
      [{ ...fixture.context, exampleRoots: [{ ...fixture.context.exampleRoots[0], maxFiles: policy.EXAMPLE_READ_POLICY_LIMITS.rootMaxFiles + 1 }] }, /maxFiles/],
      [{ ...fixture.context, exampleRoots: [{ ...fixture.context.exampleRoots[0], maxBytes: policy.EXAMPLE_READ_POLICY_LIMITS.rootMaxBytes + 1 }] }, /maxBytes/],
      [{ ...fixture.context, installedVersionFallback: { ...fixture.context.installedVersionFallback, maxFiles: policy.EXAMPLE_READ_POLICY_LIMITS.fallbackMaxFiles + 1 } }, /maxFiles/],
      [{ ...fixture.context, installedVersionFallback: { ...fixture.context.installedVersionFallback, maxBytes: policy.EXAMPLE_READ_POLICY_LIMITS.fallbackMaxBytes + 1 } }, /maxBytes/],
      [{ ...fixture.context, installedVersionFallback: { ...fixture.context.installedVersionFallback, reasonCodes: ['UNKNOWN_REASON'] } }, /unknown installed-version fallback reason/],
    ] as const
    for (const [context, expected] of variants) {
      const result = policy.validateExampleReadPolicy(context, fixture.inventory)
      assert.equal(result.ok, false)
      assert.match(result.errors.join('; '), expected)
    }
    const missingEntrypoint = policy.validateExampleReadPolicy({
      ...fixture.context,
      exampleRoots: [{ ...fixture.context.exampleRoots[0], entrypoints: ['missing.md'] }],
    }, fixture.inventory, { caseRoot: fixture.caseRoot })
    assert.equal(missingEntrypoint.ok, false)
    assert.match(missingEntrypoint.errors.join('; '), /missing\.md.*no such file/i)
  } finally {
    fs.rmSync(fixture.caseRoot, { recursive: true, force: true })
  }
})

test('cumulative budget inputs fail closed while absent optional fields preserve compatibility', async () => {
  const policy = await import(pathToFileURL(helperPath).href) as PolicyModule
  assert.deepEqual(policy.validateCumulativeExampleBudget(
    { fileCount: 12, totalBytes: 131_072 },
    { maxFiles: 12, maxBytes: 131_072 },
  ), [])
  assert.match(policy.validateCumulativeExampleBudget(
    { fileCount: 13, totalBytes: 131_073 },
    { maxFiles: 12, maxBytes: 131_072 },
  ).join('; '), /file budget exceeded.*byte budget exceeded/)
  assert.match(policy.validateCumulativeExampleBudget(
    { fileCount: -1, totalBytes: -1 },
    { maxFiles: 0, maxBytes: 0 },
  ).join('; '), /non-negative.*positive/s)

  const context = { required: ['AGENTS.md'], forbidden: ['.env*'] }
  const compatible = policy.validateExampleReadPolicy(context, {})
  assert.equal(compatible.ok, true)
  assert.deepEqual(compatible.policy, { exampleRoots: [], installedVersionFallback: null })
  assert.deepEqual(context, { required: ['AGENTS.md'], forbidden: ['.env*'] })
})
