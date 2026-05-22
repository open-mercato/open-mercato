import { glob } from 'glob'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const distDir = join(packageDir, 'dist')

const toImportPath = (p) => p.replace(/\\/g, '/')

// Translate `#generated/<name>` imports into a relative path into dist/generated/.
// Called per emitted .js file by the shared atomic-write plugin.
function resolveGeneratedImport(importPath, fileDir) {
  let targetPath
  if (importPath === 'entity-fields-registry') {
    targetPath = join(distDir, 'generated-shims', 'entity-fields-registry.js')
  } else if (importPath.startsWith('entities/')) {
    targetPath = join(distDir, 'generated', importPath, 'index.js')
  } else {
    targetPath = join(distDir, 'generated', importPath + '.js')
  }
  let rel = toImportPath(relative(fileDir, targetPath))
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

const rewriteOptions = { resolveGeneratedImport }

await buildPackage(packageDir, {
  name: 'core',
  clearDist: true,
  copyJson: true,
  copyJsonIgnore: ['**/i18n/**'],
  rewriteOptions,
})

const generatedEntryPoints = await glob('generated/**/*.{ts,tsx}', {
  cwd: packageDir,
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  absolute: true,
})

if (generatedEntryPoints.length > 0) {
  await buildPackage(packageDir, {
    name: 'core:generated',
    entryPoints: generatedEntryPoints,
    outbase: 'generated',
    outdir: 'dist/generated',
    rewriteOptions,
  })
}
