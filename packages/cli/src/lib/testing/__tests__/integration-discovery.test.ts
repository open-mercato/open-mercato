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

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-integration-discovery-'))
    delete process.env.OM_ENABLE_ENTERPRISE_MODULES
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
})
