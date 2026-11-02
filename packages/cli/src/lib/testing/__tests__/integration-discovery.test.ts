import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { discoverIntegrationSpecFiles } from '../integration-discovery'

async function writeTestFile(projectRoot: string, relativePath: string, content = 'export {}\n'): Promise<void> {
  const absolutePath = path.join(projectRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
}

describe('integration discovery', () => {
  let tempRoot = ''
  const previousEnterpriseFlag = process.env.OM_ENABLE_ENTERPRISE_MODULES
  const testEnvKeys = [
    'OM_TEST_DISCOVERY_AI_KEY',
    'OM_TEST_DISCOVERY_FALLBACK_AI_KEY',
    'OM_TEST_DISCOVERY_REQUIRED_KEY',
    'OM_TEST_APP_ROOT',
  ] as const
  const previousTestEnvValues = new Map<string, string | undefined>()

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-integration-discovery-'))
    delete process.env.OM_ENABLE_ENTERPRISE_MODULES
    for (const key of testEnvKeys) {
      previousTestEnvValues.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
    }
    if (previousEnterpriseFlag === undefined) {
      delete process.env.OM_ENABLE_ENTERPRISE_MODULES
    } else {
      process.env.OM_ENABLE_ENTERPRISE_MODULES = previousEnterpriseFlag
    }
    for (const key of testEnvKeys) {
      const previousValue = previousTestEnvValues.get(key)
      if (previousValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previousValue
      }
    }
    previousTestEnvValues.clear()
  })

  it('applies folder and per-test metadata dependencies', async () => {
    await writeTestFile(tempRoot, 'apps/mercato/src/modules/sales/.gitkeep')
    await writeTestFile(tempRoot, 'apps/mercato/src/modules/auth/.gitkeep')
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/sales/__integration__/payments/meta.ts',
      "export const integrationMeta = { dependsOnModules: ['currencies'] }\n",
    )
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/sales/__integration__/payments/TC-SALES-001.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/sales/__integration__/TC-SALES-002.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/sales/__integration__/TC-SALES-002.meta.ts',
      "export const integrationMeta = { requiredModules: ['auth'] }\n",
    )

    let discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'apps/mercato/src/modules/sales/__integration__/TC-SALES-002.spec.ts',
    ])

    await writeTestFile(tempRoot, 'apps/mercato/src/modules/currencies/.gitkeep')
    discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'apps/mercato/src/modules/sales/__integration__/payments/TC-SALES-001.spec.ts',
      'apps/mercato/src/modules/sales/__integration__/TC-SALES-002.spec.ts',
    ])
  })

  it('loads enterprise integration tests only when enterprise modules are enabled', async () => {
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/.gitkeep')
    await writeTestFile(
      tempRoot,
      'packages/core/src/modules/sales/__integration__/TC-SALES-010.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'packages/enterprise/src/modules/sales/__integration__/TC-SALES-910.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-910.spec.ts',
      'export {}\n',
    )

    let discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/core/src/modules/sales/__integration__/TC-SALES-010.spec.ts',
    ])

    process.env.OM_ENABLE_ENTERPRISE_MODULES = 'true'
    discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/core/src/modules/sales/__integration__/TC-SALES-010.spec.ts',
      'packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-910.spec.ts',
      'packages/enterprise/src/modules/sales/__integration__/TC-SALES-910.spec.ts',
    ])
  })

  it('discovers tests from create-app template modules', async () => {
    await writeTestFile(
      tempRoot,
      'packages/create-app/template/src/modules/auth/__integration__/TC-AUTH-001.spec.ts',
      'export {}\n',
    )
    const discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/create-app/template/src/modules/auth/__integration__/TC-AUTH-001.spec.ts',
    ])
  })

  it('discovers standalone app integration tests from src/modules', async () => {
    await writeTestFile(tempRoot, 'src/modules/auth/.gitkeep')
    await writeTestFile(tempRoot, 'src/modules/sales/.gitkeep')
    await writeTestFile(
      tempRoot,
      'src/modules/sales/__integration__/TC-SALES-020.spec.ts',
      'export {}\n',
    )

    const discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'src/modules/sales/__integration__/TC-SALES-020.spec.ts',
    ])
  })

  it('discovers standalone package integration tests from node_modules/@open-mercato', async () => {
    await writeTestFile(tempRoot, 'src/modules/customers/.gitkeep')
    await writeTestFile(tempRoot, 'node_modules/@open-mercato/core/src/modules/customers/.gitkeep')
    await writeTestFile(
      tempRoot,
      'node_modules/@open-mercato/core/src/modules/customers/__integration__/TC-CRM-020.spec.ts',
      'export {}\n',
    )

    const discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'node_modules/@open-mercato/core/src/modules/customers/__integration__/TC-CRM-020.spec.ts',
    ])
  })

  it('uses OM_TEST_APP_ROOT and its actual modules.ts for dependency filtering', async () => {
    const standaloneRoot = path.join(tempRoot, 'standalone-app')
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/example/__integration__/meta.ts',
      "export const integrationMeta = { requiredModules: ['example'] }\n",
    )
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/example/__integration__/TC-EXAMPLE-016.spec.ts',
    )
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/example/__integration__/TC-EXAMPLE-018.meta.ts',
      "export const integrationMeta = { requiredModules: ['design_system'] }\n",
    )
    await writeTestFile(
      tempRoot,
      'apps/mercato/src/modules/example/__integration__/TC-EXAMPLE-018.spec.ts',
    )
    await writeTestFile(
      tempRoot,
      'standalone-app/src/modules.ts',
      `const moduleOverrideExamples = [{ id: 'design_system', from: '@open-mercato/core' }]\n\nexport const enabledModules = [{\n  id: 'example',\n  from: '@app',\n  overrides: { routes: { api: { 'GET /api/example/probe': null } } },\n}]\n`,
    )
    await writeTestFile(tempRoot, 'standalone-app/src/modules/design_system/.gitkeep')
    process.env.OM_TEST_APP_ROOT = standaloneRoot

    const discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'apps/mercato/src/modules/example/__integration__/TC-EXAMPLE-016.spec.ts',
    ])
  })

  it('skips standalone specs whose owning module the OM_TEST_APP_ROOT app does not ship', async () => {
    for (const moduleId of ['catalog', 'ecommerce', 'record_locks_probe', 'official_probe']) {
      await writeTestFile(tempRoot, `packages/core/src/modules/${moduleId}/index.ts`)
      await writeTestFile(tempRoot, `packages/core/src/modules/${moduleId}/__integration__/TC-${moduleId}.spec.ts`)
    }
    await writeTestFile(tempRoot, 'packages/core/src/modules/catalog/__integration__/nested/TC-catalog-nested.spec.ts')
    await writeTestFile(tempRoot, 'packages/core/src/modules/core/__integration__/TC-core-shell.spec.ts')
    await writeTestFile(tempRoot, 'packages/ui/__integration__/TC-ui.spec.ts')
    await writeTestFile(
      tempRoot,
      'standalone-app/src/modules.ts',
      [
        "export const enabledModules = [",
        "  { id: 'catalog', from: '@open-mercato/core' },",
        "  // { id: 'ecommerce', from: '@open-mercato/core' },",
        ']',
        "if (process.env.FLAG) enabledModules.push({ id: 'record_locks_probe', from: '@open-mercato/core' })",
        '',
      ].join('\n'),
    )
    await writeTestFile(
      tempRoot,
      'standalone-app/src/official-modules.generated.ts',
      "export const officialModuleEntries = [{ id: 'official_probe', from: '@open-mercato/official' }]\n",
    )

    let discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toContain(
      'packages/core/src/modules/ecommerce/__integration__/TC-ecommerce.spec.ts',
    )

    process.env.OM_TEST_APP_ROOT = path.join(tempRoot, 'standalone-app')
    discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/core/src/modules/catalog/__integration__/nested/TC-catalog-nested.spec.ts',
      'packages/core/src/modules/catalog/__integration__/TC-catalog.spec.ts',
      'packages/core/src/modules/core/__integration__/TC-core-shell.spec.ts',
      'packages/core/src/modules/official_probe/__integration__/TC-official_probe.spec.ts',
      'packages/core/src/modules/record_locks_probe/__integration__/TC-record_locks_probe.spec.ts',
      'packages/ui/__integration__/TC-ui.spec.ts',
    ])
  })

  it('keeps conditional enabledModules pushes out of standalone dependency filtering', async () => {
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/index.ts')
    await writeTestFile(
      tempRoot,
      'packages/core/src/modules/sales/__integration__/TC-SALES-030.meta.ts',
      "export const integrationMeta = { dependsOnModules: ['gated_probe'] }\n",
    )
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/__integration__/TC-SALES-030.spec.ts')
    await writeTestFile(
      tempRoot,
      'standalone-app/src/modules.ts',
      "export const enabledModules = [{ id: 'sales', from: '@open-mercato/core' }]\nif (process.env.FLAG) enabledModules.push({ id: 'gated_probe', from: '@app' })\n",
    )
    process.env.OM_TEST_APP_ROOT = path.join(tempRoot, 'standalone-app')

    const discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([])
  })

  it('fails loudly when OM_TEST_APP_ROOT has no modules.ts instead of skipping every spec', async () => {
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/index.ts')
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/__integration__/TC-SALES-040.spec.ts')
    process.env.OM_TEST_APP_ROOT = path.join(tempRoot, 'missing-standalone-app')

    expect(() => discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))).toThrow(/modules\.ts/)
  })

  it('reads only the top-level enabledModules declaration of a standalone app', async () => {
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/index.ts')
    await writeTestFile(
      tempRoot,
      'packages/core/src/modules/sales/__integration__/TC-SALES-041.meta.ts',
      "export const integrationMeta = { dependsOnModules: ['nested_probe'] }\n",
    )
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/__integration__/TC-SALES-041.spec.ts')
    await writeTestFile(
      tempRoot,
      'standalone-app/src/modules.ts',
      "export const enabledModules = [{ id: 'sales', from: '@open-mercato/core' }]\nfunction preview() {\n  const enabledModules = [{ id: 'nested_probe', from: '@app' }]\n  return enabledModules\n}\n",
    )
    process.env.OM_TEST_APP_ROOT = path.join(tempRoot, 'standalone-app')

    const discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([])
  })

  it('applies folder and per-test metadata environment requirements', async () => {
    await writeTestFile(tempRoot, 'packages/ai-assistant/src/modules/ai_assistant/.gitkeep')
    await writeTestFile(
      tempRoot,
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-001.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-002.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-002.meta.ts',
      "export const integrationMeta = { requiredAnyEnvVars: ['OM_TEST_DISCOVERY_AI_KEY', 'OM_TEST_DISCOVERY_FALLBACK_AI_KEY'] }\n",
    )
    await writeTestFile(
      tempRoot,
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/live/meta.ts',
      "export const integrationMeta = { requiredEnvVars: ['OM_TEST_DISCOVERY_REQUIRED_KEY'] }\n",
    )
    await writeTestFile(
      tempRoot,
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/live/TC-AI-003.spec.ts',
      'export {}\n',
    )

    let discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-001.spec.ts',
    ])

    process.env.OM_TEST_DISCOVERY_FALLBACK_AI_KEY = 'test-key'
    discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-001.spec.ts',
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-002.spec.ts',
    ])

    process.env.OM_TEST_DISCOVERY_REQUIRED_KEY = 'required-key'
    discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/live/TC-AI-003.spec.ts',
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-001.spec.ts',
      'packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-002.spec.ts',
    ])
  })
})
