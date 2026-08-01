import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Project, ScriptKind, SyntaxKind, type ObjectLiteralExpression, type SourceFile } from 'ts-morph'
import { buildLucideRegistrySource } from '../../../../scripts/lucideRegistrySource.cjs'

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

describe('lucideRegistry.generated importers', () => {
  it('is imported only from within src/backend/icons', () => {
    const repoRoot = join(packageDir, '..', '..')
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

    const outsideIconsFolder = matches.filter(
      (path) => !path.startsWith('packages/ui/src/backend/icons/')
    )
    expect(outsideIconsFolder).toEqual([])
  })
})
