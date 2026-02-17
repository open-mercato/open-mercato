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

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-integration-discovery-'))
  })

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
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

  it('includes enterprise overlay tests only when matching base module tests exist', async () => {
    await writeTestFile(tempRoot, 'packages/core/src/modules/sales/.gitkeep')
    await writeTestFile(
      tempRoot,
      'packages/core/src/modules/sales/__integration__/TC-SALES-010.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'packages/enterprise/modules/sales/__integration__/TC-SALES-910.spec.ts',
      'export {}\n',
    )
    await writeTestFile(
      tempRoot,
      'packages/enterprise/modules/catalog/__integration__/TC-CAT-910.spec.ts',
      'export {}\n',
    )

    const discovered = discoverIntegrationSpecFiles(tempRoot, path.join(tempRoot, '.ai', 'qa', 'tests'))
    expect(discovered.map((entry) => entry.path)).toEqual([
      'packages/core/src/modules/sales/__integration__/TC-SALES-010.spec.ts',
      'packages/enterprise/modules/sales/__integration__/TC-SALES-910.spec.ts',
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
