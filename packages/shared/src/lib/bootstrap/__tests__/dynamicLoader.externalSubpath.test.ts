/**
 * @jest-environment node
 *
 * The CLI bundle externalizes every bare package import. Node's ESM resolver only maps an
 * extensionless subpath such as `next/link` when the package publishes an `exports` map; for a
 * legacy package (no `exports`, like `next`) it requires the file extension and the bundle
 * fails with ERR_MODULE_NOT_FOUND (#6993). The external plugin therefore rewrites such
 * subpaths to the file `require.resolve` finds, and leaves everything else untouched.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { compileAppSourceFile, createCliBundlePlugins } from '../dynamicLoader'

function writePackage(appRoot: string, name: string, manifest: Record<string, unknown>, files: Record<string, string>) {
  const packageDir = path.join(appRoot, 'node_modules', ...name.split('/'))
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }))
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(packageDir, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }
}

async function bundleWithCliPlugins(appRoot: string, source: string): Promise<{ outfile: string; output: string }> {
  const esbuild = await import('esbuild')
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  const entry = path.join(generatedDir, 'entry.ts')
  fs.writeFileSync(entry, source)
  const outfile = path.join(generatedDir, 'entry.mjs')
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    absWorkingDir: appRoot,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    plugins: createCliBundlePlugins(appRoot),
  })
  return { outfile, output: fs.readFileSync(outfile, 'utf8') }
}

describe('createCliBundlePlugins — externalized package subpaths', () => {
  let appRoot: string

  beforeEach(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-external-subpath-'))
    fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }))
    writePackage(appRoot, 'legacy-pkg', { main: 'index.js' }, {
      'index.js': "module.exports = 'legacy-root'\n",
      'link.js': "module.exports = 'legacy-link'\n",
      'dist/nested/index.js': "module.exports = 'legacy-nested'\n",
    })
    writePackage(appRoot, '@scope/legacy-scoped', {}, {
      'tools.js': "module.exports = 'scoped-tools'\n",
    })
    writePackage(appRoot, 'exports-pkg', { exports: { './feature': './lib/feature.js' } }, {
      'lib/feature.js': "module.exports = 'exports-feature'\n",
    })
  })

  afterEach(() => {
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  it('appends the resolved file to extensionless subpaths of packages without an exports map', async () => {
    const { output } = await bundleWithCliPlugins(appRoot, [
      "import link from 'legacy-pkg/link'",
      "import nested from 'legacy-pkg/dist/nested'",
      "import tools from '@scope/legacy-scoped/tools'",
      'export const values = [link, nested, tools]',
      '',
    ].join('\n'))

    expect(output).toContain('"legacy-pkg/link.js"')
    expect(output).toContain('"legacy-pkg/dist/nested/index.js"')
    expect(output).toContain('"@scope/legacy-scoped/tools.js"')
  })

  it('keeps package roots, exports-mapped subpaths, builtins and unresolvable specifiers unchanged', async () => {
    const { output } = await bundleWithCliPlugins(appRoot, [
      "import root from 'legacy-pkg'",
      "import feature from 'exports-pkg/feature'",
      "import explicit from 'legacy-pkg/link.js'",
      "import { readFile } from 'fs/promises'",
      "import missing from 'missing-pkg/sub'",
      'export const values = [root, feature, explicit, readFile, missing]',
      '',
    ].join('\n'))

    expect(output).toContain('"legacy-pkg"')
    expect(output).toContain('"exports-pkg/feature"')
    expect(output).toContain('"legacy-pkg/link.js"')
    expect(output).toContain('"fs/promises"')
    expect(output).toContain('"missing-pkg/sub"')
  })

  it('produces a bundle Node ESM can load', async () => {
    const { outfile } = await bundleWithCliPlugins(appRoot, [
      "import link from 'legacy-pkg/link'",
      "import feature from 'exports-pkg/feature'",
      'console.log(JSON.stringify([link, feature]))',
      '',
    ].join('\n'))

    const result = spawnSync(process.execPath, [outfile], { encoding: 'utf8' })

    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual(['legacy-link', 'exports-feature'])
  })

  it('records the rewritten package manifest so a package upgrade invalidates the cached bundle', async () => {
    fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022' } }))
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    const entry = path.join(generatedDir, 'registry.generated.ts')
    fs.writeFileSync(entry, "import link from 'legacy-pkg/link'\nexport const value = link\n")
    const outFile = path.join(generatedDir, 'registry.generated.mjs')

    await compileAppSourceFile(entry, { appRoot, outFile })
    const metadata = JSON.parse(fs.readFileSync(`${outFile}.cache.json`, 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(metadata.dependencies)).toContain('node_modules/legacy-pkg/package.json')

    const firstOutputMtime = fs.statSync(outFile).mtimeMs
    await compileAppSourceFile(entry, { appRoot, outFile })
    expect(fs.statSync(outFile).mtimeMs).toBe(firstOutputMtime)

    writePackage(appRoot, 'legacy-pkg', { exports: { './link': './link.js' } }, {})
    await compileAppSourceFile(entry, { appRoot, outFile })
    expect(fs.readFileSync(outFile, 'utf8')).toContain('"legacy-pkg/link"')
    expect(fs.readFileSync(outFile, 'utf8')).not.toContain('"legacy-pkg/link.js"')
  })
})
