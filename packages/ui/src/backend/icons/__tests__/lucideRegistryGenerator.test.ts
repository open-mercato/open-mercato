import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Project, ScriptKind, SyntaxKind, type ObjectLiteralExpression, type SourceFile } from 'ts-morph'
import { discoverResolvedIcons } from '../../../../scripts/lucideIconDiscovery.cjs'
import { buildLucideRegistrySource } from '../../../../scripts/lucideRegistrySource.cjs'
import jestConfig from '../../../../jest.config.cjs'

const packageDir = join(__dirname, '..', '..', '..', '..')
const iconsDir = join(packageDir, 'src', 'backend', 'icons')

type ResolvedIcon = { kebab: string; exportName: string }

const populatedFixture: ResolvedIcon[] = [
  { kebab: 'bell', exportName: 'Bell' },
  { kebab: 'alert-circle', exportName: 'AlertCircle' },
  { kebab: 'bar-chart-2', exportName: 'BarChart2' },
]

const duplicateExportFixture: ResolvedIcon[] = [
  { kebab: 'trash', exportName: 'Trash' },
  { kebab: 'trash-can', exportName: 'Trash' },
]

function parse(source: string): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true })
  return project.createSourceFile('lucideRegistry.generated.tsx', source, {
    overwrite: true,
    scriptKind: ScriptKind.TSX,
  })
}

function syntacticDiagnostics(source: string): string[] {
  const sourceFile = parse(source)
  return sourceFile
    .getProject()
    .getProgram()
    .getSyntacticDiagnostics(sourceFile)
    .map((diagnostic) => `${diagnostic.getLineNumber() ?? 0}: ${diagnostic.getMessageText()}`)
}

function registryObject(source: string): ObjectLiteralExpression {
  const declaration = parse(source).getVariableDeclarationOrThrow('LUCIDE_ICON_REGISTRY')
  return declaration.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression)
}

function registryEntries(source: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const property of registryObject(source).getProperties()) {
    const assignment = property.asKindOrThrow(SyntaxKind.PropertyAssignment)
    entries[assignment.getSymbolOrThrow().getName()] = assignment.getInitializerOrThrow().getText()
  }
  return entries
}

function valueImportNames(source: string, moduleSpecifier: string): string[] {
  return parse(source)
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() === moduleSpecifier)
    .filter((declaration) => !declaration.isTypeOnly())
    .flatMap((declaration) => declaration.getNamedImports().map((named) => named.getName()))
}

describe('buildLucideRegistrySource', () => {
  it('maps every discovered kebab name to its lucide export', () => {
    expect(registryEntries(buildLucideRegistrySource(populatedFixture))).toEqual({
      'alert-circle': 'AlertCircle',
      'bar-chart-2': 'BarChart2',
      bell: 'Bell',
    })
  })

  it('emits the registry keys sorted by kebab name', () => {
    const keys = registryObject(buildLucideRegistrySource(populatedFixture))
      .getProperties()
      .map((property) => property.asKindOrThrow(SyntaxKind.PropertyAssignment).getSymbolOrThrow().getName())
    expect(keys).toEqual(['alert-circle', 'bar-chart-2', 'bell'])
  })

  it('imports each lucide export exactly once', () => {
    expect(valueImportNames(buildLucideRegistrySource(populatedFixture), 'lucide-react')).toEqual([
      'AlertCircle',
      'BarChart2',
      'Bell',
    ])
  })

  it('quotes keys that are not valid identifiers', () => {
    const property = registryObject(buildLucideRegistrySource(populatedFixture))
      .getPropertyOrThrow("'bar-chart-2'")
      .asKindOrThrow(SyntaxKind.PropertyAssignment)
    expect(property.getNameNode().getKind()).toBe(SyntaxKind.StringLiteral)
  })

  it('de-duplicates the value import when two names share one export', () => {
    const source = buildLucideRegistrySource(duplicateExportFixture)
    expect(valueImportNames(source, 'lucide-react')).toEqual(['Trash'])
    expect(registryEntries(source)).toEqual({ trash: 'Trash', 'trash-can': 'Trash' })
  })

  it('emits a valid module with an empty registry when no icons are discovered', () => {
    const source = buildLucideRegistrySource([])
    expect(registryObject(source).getProperties()).toHaveLength(0)
    expect(valueImportNames(source, 'lucide-react')).toEqual([])
    expect(source).not.toContain("import {} from 'lucide-react'")
  })

  it('keeps the registry a plain mutable object literal', () => {
    const source = buildLucideRegistrySource(populatedFixture)
    const declaration = parse(source).getVariableDeclarationOrThrow('LUCIDE_ICON_REGISTRY')
    expect(declaration.getTypeNodeOrThrow().getText()).toBe('Record<string, LucideIcon>')
    expect(declaration.getVariableStatementOrThrow().isExported()).toBe(true)
    expect(source).not.toContain('as const')
    expect(source).not.toContain('Object.freeze')
  })

  it('keeps the LucideIcon import type-only', () => {
    const typeOnly = parse(buildLucideRegistrySource(populatedFixture))
      .getImportDeclarations()
      .filter((declaration) => declaration.isTypeOnly())
      .flatMap((declaration) => declaration.getNamedImports().map((named) => named.getName()))
    expect(typeOnly).toEqual(['LucideIcon'])
  })

  it.each([
    ['populated', populatedFixture],
    ['empty', [] as ResolvedIcon[]],
    ['duplicate exports', duplicateExportFixture],
  ])('emits %s output with zero syntactic diagnostics', (_label, fixture) => {
    expect(syntacticDiagnostics(buildLucideRegistrySource(fixture))).toEqual([])
  })

  it('fails loudly when an export name would produce an unparseable module', () => {
    expect(() => buildLucideRegistrySource([{ kebab: 'broken', exportName: 'not a valid export' }])).toThrow(
      /not syntactically valid/
    )
  })
})

describe('lucideRegistry barrel', () => {
  it('keeps its public export list unchanged', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const barrel = project.createSourceFile(
      'lucideRegistry.ts',
      readFileSync(join(iconsDir, 'lucideRegistry.ts'), 'utf-8'),
      { overwrite: true }
    )
    expect([...barrel.getExportedDeclarations().keys()].sort()).toEqual([
      'LUCIDE_ICON_REGISTRY',
      'registerAdditionalIcons',
      'resolveRegisteredLucideIcon',
      'resolveRegisteredLucideIconNode',
    ])
  })
})

type GitWorkTreeProbe = { available: true } | { available: false; reason: string }

function gitProbeFailureReason(error: unknown, cwd: string): string {
  const { code, status } = error as { code?: string; status?: number }
  if (code === 'ENOENT') return `git could not be executed for ${cwd} (no git executable, or the directory is missing)`
  if (typeof status === 'number') return `git exited with status ${status} for ${cwd}`
  return `git could not be executed for ${cwd}`
}

function detectGitWorkTree(cwd: string): GitWorkTreeProbe {
  try {
    const output = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (output.trim() === 'true') return { available: true }
    return { available: false, reason: `git reported no work tree for ${cwd}` }
  } catch (error) {
    return { available: false, reason: gitProbeFailureReason(error, cwd) }
  }
}

function importersOutsideIconsFolder(matches: string[]): string[] {
  return matches.filter((path) => !path.startsWith('packages/ui/src/backend/icons/'))
}

describe('lucideRegistry.generated importers', () => {
  const repoRoot = join(packageDir, '..', '..')
  const workTree = detectGitWorkTree(repoRoot)
  // `git grep` reads the index, so the guard can only run inside a checkout. Outside
  // one (a source tarball, or no git binary) it degrades to a skip that states why,
  // instead of failing an invariant it cannot evaluate.
  const itInsideWorkTree = workTree.available ? it : it.skip
  const skipReason = workTree.available ? '' : ` — skipped: ${workTree.reason}`

  itInsideWorkTree(`is imported only from within src/backend/icons${skipReason}`, () => {
    let matches: string[] = []
    try {
      matches = execFileSync(
        'git',
        ['grep', '-l', 'lucideRegistry.generated', '--', '*.ts', '*.tsx'],
        { cwd: repoRoot, encoding: 'utf-8' }
      )
        .split('\n')
        .filter(Boolean)
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status !== 1) throw error
    }

    expect(importersOutsideIconsFolder(matches)).toEqual([])
  })

  it('flags an importer that lives outside the icons folder', () => {
    expect(
      importersOutsideIconsFolder([
        'packages/ui/src/backend/icons/lucideRegistry.ts',
        'packages/core/src/modules/catalog/backend/products/page.tsx',
      ])
    ).toEqual(['packages/core/src/modules/catalog/backend/products/page.tsx'])
  })

  it('states a reason instead of throwing when git cannot resolve a work tree', () => {
    const absentDir = join(tmpdir(), 'lucide-registry-absent-work-tree')
    const probe = detectGitWorkTree(absentDir)
    expect(probe.available).toBe(false)
    expect(probe.available ? '' : probe.reason).toContain(absentDir)
  })
})

// The registry is build output, so a module can reference an icon string and merge
// while the committed file still lacks it — the icon then silently renders as nothing.
// Running the real discovery pass here turns that drift into a failing test.
describe('committed lucideRegistry.generated.tsx', () => {
  const repoRoot = join(packageDir, '..', '..')
  const committedSource = readFileSync(join(iconsDir, 'lucideRegistry.generated.tsx'), 'utf-8')
  const regenerationHint = 'run `yarn build:packages` and commit the regenerated file'
  let discoveredIcons: ResolvedIcon[] = []

  beforeAll(async () => {
    discoveredIcons = await discoverResolvedIcons(repoRoot)
  })

  it(`registers every icon string used across the repo — ${regenerationHint}`, () => {
    const registered = new Set(Object.keys(registryEntries(committedSource)))
    const missing = discoveredIcons.map((icon) => icon.kebab).filter((kebab) => !registered.has(kebab))
    expect(missing).toEqual([])
  })

  it(`is byte-identical to a fresh generator run — ${regenerationHint}`, () => {
    expect(committedSource).toBe(buildLucideRegistrySource(discoveredIcons))
  })
})

describe('jest transform scope', () => {
  const transformPatterns = Object.keys(jestConfig.transform).map((key) => new RegExp(key))

  it('transforms the build-time emitter under scripts/', () => {
    const emitterPath = join(packageDir, 'scripts', 'lucideRegistrySource.cjs')
    expect(transformPatterns.some((pattern) => pattern.test(emitterPath))).toBe(true)
  })

  it('leaves .cjs files inside node_modules untransformed', () => {
    const vendorPath = join(packageDir, 'node_modules', '@mikro-orm', 'core', 'dist', 'index.cjs')
    expect(transformPatterns.some((pattern) => pattern.test(vendorPath))).toBe(false)
  })
})
