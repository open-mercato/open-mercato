import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(appRoot, '../..')
const manifestPath = path.join(appRoot, '.mercato/generated/message-objects.generated.ts')
const forbiddenUiRuntimeImports = new Set([
  '@open-mercato/ui',
  '@open-mercato/ui/ai',
])

const importStatements = (source: string): string[] =>
  source.match(/^import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []

const importSpecifiers = (source: string): string[] =>
  importStatements(source).flatMap((statement) => {
    const match = statement.match(/from\s+['"]([^'"]+)['"]$/)
    return match ? [match[1]] : []
  })

const findForbiddenUiRuntimeImports = (source: string): string[] =>
  importStatements(source).filter((statement) => {
    if (/^import\s+type\b/.test(statement)) return false
    const [specifier] = importSpecifiers(statement)
    return specifier !== undefined && forbiddenUiRuntimeImports.has(specifier)
  })

function resolveContributorPath(specifier: string): string {
  const packageMatch = specifier.match(/^@open-mercato\/([^/]+)\/(.+)$/)
  const basePath = packageMatch
    ? path.join(workspaceRoot, 'packages', packageMatch[1], 'src', packageMatch[2])
    : path.resolve(path.dirname(manifestPath), specifier)

  for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.tsx`]) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(`[internal] Cannot resolve generated message-object contributor: ${specifier}`)
}

describe('API bootstrap UI dependency boundary', () => {
  it.each([
    '@open-mercato/ui',
    '@open-mercato/ui/ai',
  ])('recognizes %s as a forbidden runtime import', (specifier) => {
    const statement = `import { RuntimeComponent } from '${specifier}'`
    expect(findForbiddenUiRuntimeImports(statement)).toEqual([statement])
  })

  it('keeps generated message-object contributors off heavyweight UI entrypoints', () => {
    const manifestSource = readFileSync(manifestPath, 'utf8')
    const contributorSpecifiers = importSpecifiers(manifestSource).filter((specifier) =>
      specifier.endsWith('/message-objects'),
    )

    expect(contributorSpecifiers.length).toBeGreaterThan(0)

    const forbiddenImports = contributorSpecifiers.flatMap((specifier) => {
      const contributorPath = resolveContributorPath(specifier)
      const source = readFileSync(contributorPath, 'utf8')
      return findForbiddenUiRuntimeImports(source)
        .map((statement) => ({ specifier, statement }))
    })

    expect(forbiddenImports).toEqual([])
  })
})
