import os from 'node:os'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolveAppRuntimeModulePath } from '../appRuntime'

describe('resolveAppRuntimeModulePath', () => {
  let tempRoot = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-app-runtime-'))
  })

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it('returns null without a standalone app root so the caller keeps its own copy', () => {
    expect(resolveAppRuntimeModulePath('@open-mercato/shared/lib/commands', undefined)).toBeNull()
    expect(resolveAppRuntimeModulePath('@open-mercato/shared/lib/commands', '  ')).toBeNull()
  })

  it('resolves a package subpath through the standalone app node_modules exports map', async () => {
    const packageRoot = path.join(tempRoot, 'node_modules', '@om-test-fixture', 'runtime-probe')
    await mkdir(path.join(packageRoot, 'dist', 'lib', 'commands'), { recursive: true })
    await writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'standalone-app' }))
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@om-test-fixture/runtime-probe',
        exports: { './lib/commands': { default: './dist/lib/commands/index.js' } },
      }),
    )
    await writeFile(path.join(packageRoot, 'dist', 'lib', 'commands', 'index.js'), 'export {}\n')

    const resolved = resolveAppRuntimeModulePath('@om-test-fixture/runtime-probe/lib/commands', tempRoot)
    expect(resolved && realpathSync(resolved)).toBe(
      realpathSync(path.join(packageRoot, 'dist', 'lib', 'commands', 'index.js')),
    )
  })

  it('fails loudly when the standalone app does not ship the module', async () => {
    await writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'standalone-app' }))
    expect(() => resolveAppRuntimeModulePath('@om-test-fixture/not-installed/lib/x', tempRoot)).toThrow()
  })
})
