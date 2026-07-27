import { glob } from 'glob'
import { copyFileSync, mkdirSync } from 'node:fs'
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

// Copy authored markdown assets (e.g. agent skill SKILL.md files) into dist so
// they are present in built/published packages — esbuild only emits JS. Mirrors
// the shared builder's JSON copy. Runtime loaders read these via import.meta.url.
const markdownAssets = await glob('src/**/*.md', {
  cwd: packageDir,
  ignore: ['**/node_modules/**', '**/__tests__/**', '**/AGENTS.md', '**/CLAUDE.md', '**/README.md', '**/DEMO.md', '**/STANDALONE.md'],
  absolute: true,
})
const srcRoot = join(packageDir, 'src')
for (const asset of markdownAssets) {
  const destPath = join(distDir, relative(srcRoot, asset))
  mkdirSync(dirname(destPath), { recursive: true })
  copyFileSync(asset, destPath)
}
