import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const STANDALONE_SMOKE_SPECS = [
  'packages/core/src/modules/auth/__integration__/TC-AUTH-001.spec.ts',
  'packages/core/src/modules/catalog/__integration__/TC-CAT-043-bulk-delete-org-scope.spec.ts',
  'packages/core/src/modules/phone_calls/__integration__/TC-PHONE-HUB-006-calls-list-cache.spec.ts',
]

export const STANDALONE_LOCAL_PREPACK_COMMANDS = [
  ['yarn', ['build:packages']],
  ['yarn', ['generate']],
  ['yarn', ['build:packages']],
]

export async function prepareStandaloneLocalPackages(run) {
  for (const [command, args] of STANDALONE_LOCAL_PREPACK_COMMANDS) {
    await run(command, args)
  }
}

export function assertStandaloneSmokeCoverage(report, { executed = false } = {}) {
  if (report.errors?.length) throw new Error('Standalone Playwright report contains collection or runtime errors')
  const specs = []
  function visit(suites) {
    for (const suite of suites ?? []) {
      specs.push(...suite.specs ?? [])
      visit(suite.suites)
    }
  }
  visit(report.suites)
  for (const smokePath of STANDALONE_SMOKE_SPECS) {
    const matching = specs.filter((spec) => {
      const filePath = spec.file?.replaceAll('\\', '/') ?? ''
      return filePath === smokePath || filePath.endsWith(`/${smokePath}`)
    })
    if (!matching.length || matching.some((spec) => !spec.tests?.length)) {
      throw new Error(`Required standalone smoke spec was not collected: ${smokePath}`)
    }
    if (executed && matching.some((spec) => spec.tests.some((entry) => !entry.results?.some((result) => result.status === 'passed')))) {
      throw new Error(`Required standalone smoke spec did not execute successfully: ${smokePath}`)
    }
  }
}

export function selectStandaloneSpecs(discovered, changedPaths, suite) {
  const available = new Set(discovered.map((spec) => spec.path))
  for (const smokePath of STANDALONE_SMOKE_SPECS) {
    if (!available.has(smokePath)) throw new Error(`Required standalone smoke spec was not discovered: ${smokePath}`)
  }
  if (!['smoke', 'affected', 'full'].includes(suite)) throw new Error(`Unknown standalone suite: ${suite}`)
  const changedModules = new Set()
  let fullSuite = suite === 'full'
  if (suite === 'affected') {
    if (!changedPaths.length) throw new Error('Affected standalone selection requires changed files')
    for (const changedPath of changedPaths) {
      const moduleMatch = changedPath.match(/^(?:packages\/[^/]+\/src|apps\/mercato\/src)\/modules\/([^/]+)\//)
      if (moduleMatch) changedModules.add(moduleMatch[1])
      else if (!/^(?:\.ai\/(?:runs|specs)\/|apps\/docs\/|.*\.md$)/.test(changedPath)) fullSuite = true
    }
  }
  const selected = discovered.filter((spec) => fullSuite
    || available.has(spec.path) && STANDALONE_SMOKE_SPECS.includes(spec.path)
    || suite === 'affected' && (changedModules.has(spec.moduleName)
      || spec.requiredModules.some((moduleId) => changedModules.has(moduleId))))
  return {
    suite,
    fullSuite,
    changedModules: [...changedModules].sort(),
    selected: selected.map((spec) => spec.path),
    excluded: discovered.filter((spec) => !selected.includes(spec)).map((spec) => ({
      path: spec.path,
      reason: 'Outside the fixed smoke suite and changed module dependencies',
    })),
  }
}

export function pinStandalonePackages(manifest, packages) {
  const sources = Object.fromEntries(packages.map((entry) => [entry.name, `file:${entry.tarball}`]))
  const pinned = structuredClone(manifest)
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pinned[section] ?? {})) {
      if (!name.startsWith('@open-mercato/')) continue
      if (!sources[name]) throw new Error(`No PR package was packed for ${name}`)
      pinned[section][name] = sources[name]
    }
  }
  if (!sources['@open-mercato/enterprise']) throw new Error('The enterprise PR package was not packed')
  pinned.dependencies = { ...pinned.dependencies, '@open-mercato/enterprise': sources['@open-mercato/enterprise'] }
  pinned.resolutions = { ...pinned.resolutions, ...sources }
  return pinned
}

function fileDigest(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function assertPackageFiles(sourceDir, installedDir) {
  for (const entry of fs.readdirSync(installedDir)) {
    if (entry !== 'node_modules' && !fs.existsSync(path.join(sourceDir, entry))) {
      throw new Error(`Installed first-party package contains a file absent from the PR tarball: ${path.join(installedDir, entry)}`)
    }
  }
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const installedPath = path.join(installedDir, entry.name)
    if (entry.isDirectory()) {
      if (!fs.existsSync(installedPath) || !fs.statSync(installedPath).isDirectory()) {
        throw new Error(`Installed first-party package is missing a PR tarball directory: ${installedPath}`)
      }
      assertPackageFiles(sourcePath, installedPath)
    }
    else if (entry.isFile() && (!fs.existsSync(installedPath) || fileDigest(sourcePath) !== fileDigest(installedPath))) {
      throw new Error(`Installed first-party package differs from the PR tarball: ${installedPath}`)
    }
  }
}

export function verifyStandalonePackages(appDir, packages) {
  const sources = new Map(packages.map((entry) => [entry.name, entry]))
  const installedRoot = fs.realpathSync(path.join(appDir, 'node_modules'))
  const checked = new Set()
  function visit(nodeModulesDir) {
    if (!fs.existsSync(nodeModulesDir)) return
    for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const entryPath = path.join(nodeModulesDir, entry.name)
      const packageDirs = entry.name.startsWith('@')
        ? fs.readdirSync(entryPath).map((name) => path.join(entryPath, name))
        : [entryPath]
      for (const packageDir of packageDirs) {
        const manifestPath = path.join(packageDir, 'package.json')
        if (!fs.existsSync(manifestPath)) continue
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        if (manifest.name?.startsWith('@open-mercato/')) {
          const source = sources.get(manifest.name)
          if (!source) throw new Error(`Installed first-party package was not packed from this PR: ${manifest.name}`)
          if (!fs.realpathSync(packageDir).startsWith(`${installedRoot}${path.sep}`)) {
            throw new Error(`Standalone package resolves outside its node_modules: ${packageDir}`)
          }
          assertPackageFiles(source.unpackedDir, packageDir)
          checked.add(manifest.name)
        }
        visit(path.join(packageDir, 'node_modules'))
      }
    }
  }
  visit(installedRoot)
  if (!checked.has('@open-mercato/core') || !checked.has('@open-mercato/shared')) {
    throw new Error('Standalone package verification found no core/shared runtime')
  }
  return [...checked].sort()
}
