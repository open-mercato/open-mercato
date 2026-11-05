import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import fg from 'fast-glob'

/**
 * Type-dependency classification guard.
 *
 * When a published package lists a runtime module in `dependencies` but its
 * `@types/*` counterpart in `devDependencies`, the monorepo typechecks fine
 * (dev deps are installed) while a consumer that installs the package from npm
 * gets the runtime module WITHOUT its type declarations. Their `tsc` / Next
 * build then fails with TS7016 "Could not find a declaration file for module
 * 'X'".
 *
 * This exact split shipped `@types/leaflet` as a devDependency of
 * `@open-mercato/core`, so the standalone-app build broke only post-merge (the
 * "Standalone App Integration Tests" job installs core from an npm snapshot).
 * That job is not a PR gate, so nothing caught it before merge. This guard runs
 * in the existing `test` PR job and pins the invariant statically:
 *
 *   For every PUBLISHED (non-private) workspace package, any `@types/X` that
 *   provides types for a runtime `dependency` `X` MUST also live in
 *   `dependencies`, never `devDependencies`.
 *
 * Private packages (the apps) are exempt — nobody installs them as a dependency,
 * so their dev-only `@types/react` etc. cannot bite a consumer.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const packageJsonFiles = fg.sync(['packages/*/package.json'], {
  cwd: repoRoot,
  absolute: true,
  ignore: ['**/node_modules/**'],
})

const typesPackageFor = (dependency: string): string =>
  dependency.startsWith('@')
    ? `@types/${dependency.slice(1).replace('/', '__')}`
    : `@types/${dependency}`

type Offender = { pkg: string; dependency: string; typesPackage: string }

const offendersFor = (file: string): Offender[] => {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
    name?: string
    private?: boolean
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  if (manifest.private) return []
  const dependencies = manifest.dependencies ?? {}
  const devDependencies = manifest.devDependencies ?? {}
  const pkg = manifest.name ?? relative(repoRoot, file).split(sep).join('/')
  return Object.keys(dependencies)
    .map((dependency) => ({ dependency, typesPackage: typesPackageFor(dependency) }))
    .filter(({ typesPackage }) => typesPackage in devDependencies)
    .map(({ dependency, typesPackage }) => ({ pkg, dependency, typesPackage }))
}

describe('type-dependency classification', () => {
  it('discovers workspace package manifests', () => {
    expect(packageJsonFiles.length).toBeGreaterThan(0)
  })

  it('keeps @types for runtime dependencies in dependencies, not devDependencies', () => {
    const offenders = packageJsonFiles
      .flatMap(offendersFor)
      .map((o) => `${o.pkg}: ${o.typesPackage} must move to dependencies (${o.dependency} is a runtime dependency)`)

    expect(offenders).toEqual([])
  })
})
