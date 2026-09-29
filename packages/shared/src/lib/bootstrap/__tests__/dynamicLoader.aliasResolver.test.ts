/**
 * @jest-environment node
 *
 * The CLI bundle's `@/` alias must mirror what the app tsconfig maps, because the dynamic
 * bootstrap path compiles app sources (`src/di.ts`) and generated registries that import app
 * modules through the alias. The tsconfig maps `@/.mercato/*` to the app root and every other
 * `@/*` to the app's `src/` directory; resolving everything against the app root silently sends
 * `@/lib/x` to a path that does not exist.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createCliBundlePlugins } from '../dynamicLoader'

async function bundleWithCliPlugins(appRoot: string, entry: string): Promise<string> {
  const esbuild = await import('esbuild')
  const outfile = path.join(appRoot, 'bundle.mjs')
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
  return fs.readFileSync(outfile, 'utf8')
}

describe('createCliBundlePlugins — @/ alias resolution', () => {
  let appRoot: string

  beforeEach(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-alias-resolver-'))
    fs.mkdirSync(path.join(appRoot, 'src', 'lib'), { recursive: true })
    fs.mkdirSync(path.join(appRoot, 'src', 'modules', 'demo'), { recursive: true })
    fs.mkdirSync(path.join(appRoot, '.mercato', 'generated'), { recursive: true })

    fs.writeFileSync(
      path.join(appRoot, 'src', 'lib', 'marker.ts'),
      "export const srcLibMarker = 'resolved-from-src-lib'\n",
    )
    fs.writeFileSync(
      path.join(appRoot, 'src', 'modules', 'demo', 'index.ts'),
      "export const srcModuleMarker = 'resolved-from-src-module-index'\n",
    )
    fs.writeFileSync(
      path.join(appRoot, '.mercato', 'generated', 'registry.generated.ts'),
      "export const generatedMarker = 'resolved-from-generated'\n",
    )
  })

  afterEach(() => {
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  it('resolves @/* against the app src directory and @/.mercato/* against the app root', async () => {
    const entry = path.join(appRoot, '.mercato', 'generated', 'entry.ts')
    fs.writeFileSync(
      entry,
      [
        "import { srcLibMarker } from '@/lib/marker'",
        "import { srcModuleMarker } from '@/modules/demo'",
        "import { generatedMarker } from '@/.mercato/generated/registry.generated'",
        'export const markers = [srcLibMarker, srcModuleMarker, generatedMarker]',
        '',
      ].join('\n'),
    )

    const output = await bundleWithCliPlugins(appRoot, entry)

    expect(output).toContain('resolved-from-src-lib')
    expect(output).toContain('resolved-from-src-module-index')
    expect(output).toContain('resolved-from-generated')
  })

  it('prefers an app-root match when the specifier has no src counterpart', async () => {
    fs.writeFileSync(
      path.join(appRoot, 'root-only.ts'),
      "export const rootOnlyMarker = 'resolved-from-app-root'\n",
    )
    const entry = path.join(appRoot, '.mercato', 'generated', 'entry.ts')
    fs.writeFileSync(
      entry,
      [
        "import { rootOnlyMarker } from '@/root-only'",
        'export const markers = [rootOnlyMarker]',
        '',
      ].join('\n'),
    )

    const output = await bundleWithCliPlugins(appRoot, entry)

    expect(output).toContain('resolved-from-app-root')
  })
})
