import { Project, SyntaxKind } from 'ts-morph'
import { buildVersionSource } from '../../../scripts/versionSource.cjs'

function parse(source: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile('version.ts', source, { overwrite: true })
  return { project, sourceFile }
}

function exportedLiteral(source: string, name: string): string {
  const { sourceFile } = parse(source)
  return sourceFile.getVariableDeclarationOrThrow(name).getInitializerOrThrow().getText()
}

describe('buildVersionSource', () => {
  it('exports both APP_VERSION and appVersion', () => {
    const { sourceFile } = parse(buildVersionSource('1.2.3'))
    expect([...sourceFile.getExportedDeclarations().keys()].sort()).toEqual(['APP_VERSION', 'appVersion'])
  })

  it('writes the supplied version as the APP_VERSION literal', () => {
    expect(exportedLiteral(buildVersionSource('1.2.3'), 'APP_VERSION')).toBe("'1.2.3'")
  })

  it('aliases appVersion to APP_VERSION rather than repeating the literal', () => {
    expect(exportedLiteral(buildVersionSource('1.2.3'), 'appVersion')).toBe('APP_VERSION')
  })

  it('escapes a version string that would otherwise break the literal', () => {
    const source = buildVersionSource("0.0.0-dev'; drop")
    const { sourceFile } = parse(source)
    const literal = sourceFile
      .getVariableDeclarationOrThrow('APP_VERSION')
      .getInitializerIfKindOrThrow(SyntaxKind.StringLiteral)
    expect(literal.getLiteralValue()).toBe("0.0.0-dev'; drop")
  })

  it('emits zero syntactic diagnostics', () => {
    const { project, sourceFile } = parse(buildVersionSource('1.2.3'))
    expect(project.getProgram().getSyntacticDiagnostics(sourceFile)).toEqual([])
  })

  it('keeps the build-time banner comment', () => {
    expect(buildVersionSource('1.2.3').startsWith('// Build-time generated version\n')).toBe(true)
  })
})
