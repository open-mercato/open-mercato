import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const srcRoot = join(__dirname, '..', '..')
const packageRoot = join(srcRoot, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '.storybook') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.stories\.tsx$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const sourceFiles = walk(srcRoot)
const importPattern = /(?:from|import)\s*['"]([^'"]+)['"]/g

const FIXED_DEPENDENCIES = [
  '@radix-ui/react-accordion',
  '@radix-ui/react-checkbox',
  '@radix-ui/react-dialog',
  '@radix-ui/react-label',
  '@radix-ui/react-popover',
  '@radix-ui/react-radio-group',
  '@radix-ui/react-select',
  '@radix-ui/react-separator',
  '@radix-ui/react-slot',
  '@radix-ui/react-tooltip',
  '@radix-ui/react-visually-hidden',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
]

describe('storefront-ui isolation (storefront-app spec §3.1, §3.2)', () => {
  it('scans the package sources', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
  })

  it('imports nothing from @open-mercato/*, next/*, node built-ins or server-only modules', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]
        if (
          specifier.startsWith('@open-mercato/') ||
          specifier.startsWith('next') ||
          specifier.startsWith('node:') ||
          ['fs', 'path', 'os', 'crypto', 'http', 'child_process', 'server-only'].includes(specifier)
        ) {
          offenders.push(`${relative(packageRoot, file)} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('imports only the fixed runtime dependency list plus react', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]
        if (specifier.startsWith('.') || specifier === 'react' || specifier === 'react-dom' || specifier.startsWith('react/') || specifier.startsWith('react-dom/')) continue
        const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
        if (!FIXED_DEPENDENCIES.includes(packageName)) offenders.push(`${relative(packageRoot, file)} imports ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares only fixed dependencies in package.json', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
    const declared = Object.keys(manifest.dependencies ?? {})
    const unexpected = declared.filter((name) => !FIXED_DEPENDENCIES.includes(name))
    expect(unexpected).toEqual([])
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(['react', 'react-dom'])
    for (const field of ['dependencies', 'peerDependencies'] as const) {
      expect(Object.keys(manifest[field] ?? {}).filter((name) => name.startsWith('@open-mercato/'))).toEqual([])
    }
  })
})
