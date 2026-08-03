const { readFileSync, writeFileSync } = require('node:fs')
const { join, relative } = require('node:path')
const { glob } = require('glob')

const { buildLucideRegistrySource } = require('./lucideRegistrySource.cjs')

const CANDIDATE_GLOBS = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}']
const CANDIDATE_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.mercato/**',
  'packages/core/generated/**',
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.generated.ts',
  '**/*.generated.tsx',
  '**/*.d.ts',
]
const ICON_LITERAL_PATTERNS = [
  /\bicon\s*:\s*['"`]([^'"`]+)['"`]/g,
  /\bicon\s*=\s*['"`]([^'"`]+)['"`]/g,
]
const EXCLUDED_LUCIDE_EXPORTS = new Set(['Icon'])

function normalizeKebabIconName(input) {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withoutPrefix = trimmed.startsWith('lucide:') ? trimmed.slice('lucide:'.length) : trimmed
  if (!withoutPrefix) return ''
  if (!withoutPrefix.includes('-') && !withoutPrefix.includes('_') && !withoutPrefix.includes(' ') && /[A-Z]/.test(withoutPrefix)) {
    return withoutPrefix
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
  }
  return withoutPrefix
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
}

function kebabToLucideExportName(kebab) {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join('')
}

function collectIconNames(source) {
  const iconNames = new Set()
  for (const pattern of ICON_LITERAL_PATTERNS) {
    pattern.lastIndex = 0
    for (;;) {
      const match = pattern.exec(source)
      if (!match) break
      const normalized = normalizeKebabIconName(match[1] ?? '')
      if (normalized) iconNames.add(normalized)
    }
  }
  return iconNames
}

async function discoverIconNames(repoRoot) {
  const candidateFiles = await glob(CANDIDATE_GLOBS, {
    cwd: repoRoot,
    absolute: true,
    ignore: CANDIDATE_IGNORES,
  })
  const iconNames = new Set()
  for (const absPath of candidateFiles) {
    const discovered = collectIconNames(readFileSync(absPath, 'utf8'))
    for (const name of discovered) iconNames.add(name)
  }
  return iconNames
}

function resolveLucideIcons(iconNames, lucideExportNames) {
  const exportKeys = lucideExportNames instanceof Set ? lucideExportNames : new Set(lucideExportNames)
  const resolved = []
  for (const kebab of iconNames) {
    const exportName = kebabToLucideExportName(kebab)
    if (!EXCLUDED_LUCIDE_EXPORTS.has(exportName) && exportKeys.has(exportName)) {
      resolved.push({ kebab, exportName })
    }
  }
  return resolved
}

function getRegistryPaths(packageDir) {
  return {
    repoRoot: join(packageDir, '..', '..'),
    outputPath: join(packageDir, 'src/backend/icons/lucideRegistry.generated.tsx'),
  }
}

async function generateLucideRegistrySource({ packageDir, lucideExports } = {}) {
  if (!packageDir) throw new Error('generateLucideRegistrySource requires packageDir')
  const { repoRoot } = getRegistryPaths(packageDir)
  const iconNames = await discoverIconNames(repoRoot)
  const exportsObject = lucideExports ?? await import('lucide-react')
  const resolvedIcons = resolveLucideIcons(iconNames, Object.keys(exportsObject))
  return {
    iconCount: resolvedIcons.length,
    source: buildLucideRegistrySource(resolvedIcons),
  }
}

async function syncLucideRegistry({ packageDir } = {}) {
  if (!packageDir) throw new Error('syncLucideRegistry requires packageDir')
  const { outputPath } = getRegistryPaths(packageDir)
  const generated = await generateLucideRegistrySource({ packageDir })
  writeFileSync(outputPath, generated.source)
  return { ...generated, outputPath }
}

function assertLucideRegistryCurrent({ actualSource, expectedSource, outputPath, repoRoot }) {
  if (actualSource === expectedSource) return
  const displayPath = repoRoot ? relative(repoRoot, outputPath) : outputPath
  throw new Error(
    `Lucide registry drift detected in ${displayPath}. ` +
    'Run `yarn lucide:sync` and commit the regenerated file.',
  )
}

async function checkLucideRegistry({ packageDir } = {}) {
  if (!packageDir) throw new Error('checkLucideRegistry requires packageDir')
  const { repoRoot, outputPath } = getRegistryPaths(packageDir)
  const generated = await generateLucideRegistrySource({ packageDir })
  assertLucideRegistryCurrent({
    actualSource: readFileSync(outputPath, 'utf8'),
    expectedSource: generated.source,
    outputPath,
    repoRoot,
  })
  return { ...generated, outputPath }
}

module.exports = {
  assertLucideRegistryCurrent,
  checkLucideRegistry,
  collectIconNames,
  discoverIconNames,
  generateLucideRegistrySource,
  kebabToLucideExportName,
  normalizeKebabIconName,
  resolveLucideIcons,
  syncLucideRegistry,
}
