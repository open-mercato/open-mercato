import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(appRoot, '../..')
const manifestPath = path.join(appRoot, '.mercato/generated/message-objects.generated.ts')

const importStatements = (source: string): string[] =>
  source.match(/^import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []

const importSpecifiers = (source: string): string[] =>
  importStatements(source).flatMap((statement) => {
    const match = statement.match(/from\s+['"]([^'"]+)['"]$/)
    return match ? [match[1]] : []
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
  it('keeps generated message-object contributors off the @open-mercato/ui barrel', () => {
    const manifestSource = readFileSync(manifestPath, 'utf8')
    const contributorSpecifiers = importSpecifiers(manifestSource).filter((specifier) =>
      specifier.endsWith('/message-objects'),
    )

    expect(contributorSpecifiers.length).toBeGreaterThan(0)

    const barrelImports = contributorSpecifiers.flatMap((specifier) => {
      const contributorPath = resolveContributorPath(specifier)
      const source = readFileSync(contributorPath, 'utf8')
      return importStatements(source)
        .filter((statement) => (
          /from\s+['"]@open-mercato\/ui['"]$/.test(statement)
          && !/^import\s+type\b/.test(statement)
        ))
        .map((statement) => ({ specifier, statement }))
    })

    expect(barrelImports).toEqual([])
  })
})
