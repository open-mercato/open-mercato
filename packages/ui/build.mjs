import { glob } from 'glob'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'
import { buildLucideRegistrySource } from './scripts/lucideRegistrySource.cjs'

const packageDir = dirname(fileURLToPath(import.meta.url))

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

async function generateLucideRegistry() {
  const repoRoot = join(packageDir, '..', '..')
  const candidateFiles = await glob(['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'], {
    cwd: repoRoot,
    absolute: true,
    ignore: [
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
    ],
  })

  const iconStrings = new Set()
  const patterns = [
    /\bicon\s*:\s*['"`]([^'"`]+)['"`]/g,
    /\bicon\s*=\s*['"`]([^'"`]+)['"`]/g,
  ]

  for (const absPath of candidateFiles) {
    const content = readFileSync(absPath, 'utf-8')
    for (const pattern of patterns) {
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

  const lucide = await import('lucide-react')
  const exportKeys = new Set(Object.keys(lucide))
  const excludedLucideExports = new Set(['Icon'])

  const resolved = []
  for (const name of iconStrings) {
    const exportName = kebabToLucideExportName(name)
    if (excludedLucideExports.has(exportName)) continue
    if (exportKeys.has(exportName)) {
      resolved.push({ kebab: name, exportName })
    }
  }

  const outPath = join(packageDir, 'src/backend/icons/lucideRegistry.generated.tsx')
  writeFileSync(outPath, buildLucideRegistrySource(resolved))
  console.log(`Generated lucide registry with ${resolved.length} icons -> ${outPath}`)
}

await buildPackage(packageDir, {
  name: 'ui',
  beforeBuild: generateLucideRegistry,
})
