// Pure discovery pass feeding src/backend/icons/lucideRegistry.generated.tsx.
// Kept side-effect free, and CommonJS so both build.mjs and the Jest suite can load it.

const { glob } = require('glob')
const { readFileSync } = require('node:fs')

const SOURCE_GLOBS = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}']

const IGNORED_GLOBS = [
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

const ICON_STRING_PATTERNS = [
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

async function discoverIconNames(repoRoot) {
  const candidateFiles = await glob(SOURCE_GLOBS, {
    cwd: repoRoot,
    absolute: true,
    ignore: IGNORED_GLOBS,
  })

  const iconStrings = new Set()
  for (const absPath of candidateFiles) {
    const content = readFileSync(absPath, 'utf-8')
    for (const pattern of ICON_STRING_PATTERNS) {
      pattern.lastIndex = 0
      for (;;) {
        const match = pattern.exec(content)
        if (!match) break
        const raw = match[1]
        if (!raw) continue
        const normalized = normalizeKebabIconName(raw)
        if (!normalized) continue
        iconStrings.add(normalized)
      }
    }
  }

  return iconStrings
}

function resolveIconNames(iconNames, exportNames) {
  const exportKeys = exportNames instanceof Set ? exportNames : new Set(exportNames)
  const resolved = []
  for (const kebab of iconNames) {
    const exportName = kebabToLucideExportName(kebab)
    if (EXCLUDED_LUCIDE_EXPORTS.has(exportName)) continue
    if (exportKeys.has(exportName)) {
      resolved.push({ kebab, exportName })
    }
  }
  return resolved
}

async function discoverResolvedIcons(repoRoot) {
  const lucide = await import('lucide-react')
  return resolveIconNames(await discoverIconNames(repoRoot), Object.keys(lucide))
}

module.exports = {
  normalizeKebabIconName,
  kebabToLucideExportName,
  discoverIconNames,
  resolveIconNames,
  discoverResolvedIcons,
}
