/**
 * Shared package build configuration.
 * Special behavior: version injection from package.json into lib/version.ts.
 */

import { glob } from 'glob'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createIncrementalJsExtensionPlugin, createAddJsExtensionPlugin } from '../../scripts/build-shared.mjs'

function createInjectVersionPlugin(packageDir) {
  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'))
  const packageVersion = packageJson.version

  return {
    name: 'inject-version',
    setup(build) {
      build.onLoad({ filter: /lib\/version\.ts$/ }, async () => {
        return {
          contents: `// Build-time generated version\nexport const APP_VERSION = '${packageVersion}'\nexport const appVersion = APP_VERSION\n`,
          loader: 'ts',
        }
      })
    },
  }
}

export async function getBuildOptions(packageDir, { target = 'node24', incremental = false } = {}) {
  const entryPoints = await glob('src/**/*.{ts,tsx}', {
    cwd: packageDir,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    absolute: true,
  })

  const jsPlugin = incremental
    ? createIncrementalJsExtensionPlugin(packageDir)
    : createAddJsExtensionPlugin(packageDir)

  return {
    entryPoints,
    outdir: join(packageDir, 'dist'),
    outbase: join(packageDir, 'src'),
    format: 'esm',
    platform: 'node',
    target,
    sourcemap: true,
    jsx: 'automatic',
    plugins: [createInjectVersionPlugin(packageDir), jsPlugin],
    logLevel: 'warning',
  }
}

export const watchInputs = ['src/**', 'package.json']
