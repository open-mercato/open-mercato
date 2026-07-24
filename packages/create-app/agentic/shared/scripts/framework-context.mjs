#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const appRoot = realpathSync(process.cwd())
const requireFromApp = createRequire(join(appRoot, 'package.json'))

function fail(message) {
  console.error(`framework-context: ${message}`)
  process.exitCode = 2
}

function parseArgs(argv) {
  const args = { json: false, materialize: true }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') args.json = true
    else if (value === '--no-materialize') args.materialize = false
    else if (value === '--root') args.root = true
    else if (value === '--module') args.module = argv[++index]
    else if (value.startsWith('--module=')) args.module = value.slice(9)
    else if (value === '--package') args.package = argv[++index]
    else if (value.startsWith('--package=')) args.package = value.slice(10)
    else if (value === '--query') args.query = argv[++index]
    else if (value.startsWith('--query=')) args.query = value.slice(8)
    else if (value === '--help' || value === '-h') args.help = true
    else throw new Error(`unknown argument: ${value}`)
  }
  return args
}

function assertToken(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`invalid ${label}: ${String(value)}`)
  }
  return value
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function parseModuleEntries() {
  const modulesPath = join(appRoot, 'src', 'modules.ts')
  if (!existsSync(modulesPath)) return []
  const source = readFileSync(modulesPath, 'utf8')
  const entries = []
  const objectPattern = /\{[\s\S]*?\bid\s*:\s*['"]([^'"]+)['"][\s\S]*?\bfrom\s*:\s*['"]([^'"]+)['"][\s\S]*?\}/g
  for (const match of source.matchAll(objectPattern)) {
    entries.push({ id: match[1], from: match[2] })
  }
  return entries
}

function findPackageRoot(packageName) {
  const attempts = [`${packageName}/package.json`, packageName]
  for (const request of attempts) {
    try {
      let resolvedPath = requireFromApp.resolve(request)
      if (basename(resolvedPath) === 'package.json') return realpathSync(dirname(resolvedPath))
      let cursor = dirname(realpathSync(resolvedPath))
      while (cursor !== dirname(cursor)) {
        const manifestPath = join(cursor, 'package.json')
        if (existsSync(manifestPath)) {
          const manifest = readJson(manifestPath)
          if (manifest.name === packageName) return realpathSync(cursor)
        }
        cursor = dirname(cursor)
      }
    } catch {
      // Package export maps commonly hide package.json; try the entry point next.
    }
  }
  return null
}

function assertInside(root, candidate, label) {
  const delta = relative(root, candidate)
  if (delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta))) return candidate
  throw new Error(`${label} escapes ${root}`)
}

function candidatePackages(moduleId) {
  const declared = parseModuleEntries().filter((entry) => entry.id === moduleId)
  if (declared.length > 0) return [...new Set(declared.map((entry) => entry.from))]

  const appManifest = readJson(join(appRoot, 'package.json'))
  const names = Object.keys({ ...appManifest.dependencies, ...appManifest.devDependencies })
    .filter((name) => name.startsWith('@open-mercato/'))
  return names.filter((name) => {
    const root = findPackageRoot(name)
    return root && existsSync(join(root, 'src', 'modules', moduleId))
  })
}

function nearestAgentsFiles(packageRoot, sourceRoot) {
  const files = []
  const packageAgents = join(packageRoot, 'AGENTS.md')
  if (existsSync(packageAgents)) files.push(packageAgents)
  if (!sourceRoot) return files

  let cursor = sourceRoot
  const nested = []
  while (cursor.startsWith(packageRoot)) {
    const candidate = join(cursor, 'AGENTS.md')
    if (existsSync(candidate) && candidate !== packageAgents) nested.unshift(candidate)
    if (cursor === packageRoot) break
    cursor = dirname(cursor)
  }
  files.push(...nested)
  return [...new Set(files)]
}

function copyContextFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (candidate) => !lstatSync(candidate).isSymbolicLink(),
  })
}

function materialize(result, query) {
  const safePackage = result.package.name.replace(/^@/, '').replaceAll('/', '-')
  const outputRoot = assertInside(
    appRoot,
    resolve(appRoot, '.ai', 'framework-context', `${safePackage}@${result.package.version}`),
    'context output',
  )
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })

  for (const instruction of result.instructions) {
    if (!instruction.path || !existsSync(instruction.path)) continue
    const target = join(outputRoot, 'instructions', `${instruction.kind}.md`)
    copyContextFile(instruction.path, target)
    instruction.materializedPath = relative(appRoot, target)
  }

  if (result.sourceRoot && existsSync(result.sourceRoot)) {
    const sourceTarget = join(outputRoot, 'source', result.module ?? 'package')
    copyContextFile(result.sourceRoot, sourceTarget)
    result.materializedSource = relative(appRoot, sourceTarget)
  }

  if (query && result.sourceRoot) {
    const search = spawnSync('rg', ['--no-ignore', '--hidden', '--max-count', '200', '--', query, result.sourceRoot], {
      cwd: appRoot,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    })
    const searchPath = join(outputRoot, 'search.txt')
    writeFileSync(searchPath, (search.stdout || search.stderr || '').slice(0, 1024 * 1024))
    result.searchResult = relative(appRoot, searchPath)
  }

  const manifestPath = join(outputRoot, 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2)}\n`)
  result.manifest = relative(appRoot, manifestPath)
}

function buildResult(args) {
  const upstreamRoot = join(appRoot, '.ai', 'guides', 'upstream', 'AGENTS.md')
  const upstreamBc = join(appRoot, '.ai', 'guides', 'upstream', 'BACKWARD_COMPATIBILITY.md')
  const standaloneRoot = join(appRoot, 'AGENTS.md')
  const snapshotManifestPath = join(appRoot, '.ai', 'guides', 'upstream', 'manifest.json')
  const snapshot = existsSync(snapshotManifestPath) ? readJson(snapshotManifestPath) : null

  if (args.root) {
    return {
      mode: 'root',
      snapshot,
      instructions: [
        { kind: 'standalone-root', path: existsSync(standaloneRoot) ? standaloneRoot : null },
        { kind: 'upstream-bc', path: existsSync(upstreamBc) ? upstreamBc : null },
        { kind: 'upstream-root', path: existsSync(upstreamRoot) ? upstreamRoot : null },
      ],
    }
  }

  const moduleId = args.module
    ? assertToken(args.module, 'module id', /^[a-z0-9][a-z0-9_-]*$/)
    : null
  let packageName = args.package
    ? assertToken(args.package, 'package name', /^@open-mercato\/[a-z0-9][a-z0-9._-]*$/)
    : null

  if (moduleId && !packageName) {
    const candidates = candidatePackages(moduleId)
    if (candidates.length === 0) throw new Error(`no installed package declares module ${moduleId}`)
    if (candidates.length > 1) {
      throw new Error(`module ${moduleId} is ambiguous; pass --package (${candidates.join(', ')})`)
    }
    packageName = candidates[0]
  }
  if (!packageName) throw new Error('pass --module, --package, or --root')

  const packageRoot = findPackageRoot(packageName)
  if (!packageRoot) throw new Error(`cannot resolve ${packageName} from ${appRoot}`)
  const packageManifest = readJson(join(packageRoot, 'package.json'))
  const sourceCandidate = moduleId
    ? join(packageRoot, 'src', 'modules', moduleId)
    : join(packageRoot, 'src')
  const distCandidate = moduleId
    ? join(packageRoot, 'dist', 'modules', moduleId)
    : join(packageRoot, 'dist')
  const sourceRoot = existsSync(sourceCandidate)
    ? assertInside(packageRoot, realpathSync(sourceCandidate), 'source root')
    : existsSync(distCandidate)
      ? assertInside(packageRoot, realpathSync(distCandidate), 'dist root')
      : null
  const degraded = sourceRoot ? !sourceRoot.includes(`${sep}src${sep}`) && !sourceRoot.endsWith(`${sep}src`) : true
  const snapshotVersion = typeof snapshot?.generator === 'string'
    ? snapshot.generator.match(/@(\d+\.\d+\.\d+(?:-[^\s]+)?)/)?.[1] ?? null
    : null
  const factsPath = join(appRoot, '.ai', 'guides', 'module-facts.json')
  const moduleFact = moduleId && existsSync(factsPath) ? readJson(factsPath)?.[moduleId] ?? null : null
  const factsCurrent = !moduleFact || !moduleFact.sourceVersion || moduleFact.sourceVersion === packageManifest.version

  return {
    mode: moduleId ? 'module' : 'package',
    module: moduleId,
    package: { name: packageName, version: packageManifest.version ?? 'unknown', root: packageRoot },
    sourceRoot,
    degraded,
    snapshot,
    generatedFacts: moduleFact ? { current: factsCurrent, sourceVersion: moduleFact.sourceVersion ?? moduleFact.coreVersion ?? null } : null,
    instructions: [
      { kind: 'standalone-root', path: existsSync(standaloneRoot) ? standaloneRoot : null },
      { kind: 'upstream-bc', path: existsSync(upstreamBc) ? upstreamBc : null },
      ...nearestAgentsFiles(packageRoot, sourceRoot).map((path, index) => ({
        kind: index === 0 ? 'package' : `module-${index}`,
        path,
      })),
      { kind: 'upstream-root', path: existsSync(upstreamRoot) ? upstreamRoot : null },
    ],
    boundedSearch: sourceRoot ? ['rg', '--no-ignore', '--hidden', '--', args.query ?? '<query>', sourceRoot] : null,
    warnings: [
      ...(degraded ? ['Package source is unavailable; analysis is limited to dist/types.'] : []),
      ...(!existsSync(join(packageRoot, 'AGENTS.md')) ? ['Package AGENTS.md is unavailable.'] : []),
      ...(snapshotVersion && snapshotVersion !== packageManifest.version
        ? [`Upstream snapshot ${snapshotVersion} differs from installed ${packageName}@${packageManifest.version}.`]
        : []),
      ...(!factsCurrent
        ? [`Generated facts for ${moduleId} are stale and must not be used until yarn generate/agentic:init refreshes them.`]
        : []),
    ],
  }
}

function printHelp() {
  console.log(`Usage:
  yarn framework:context --module <id> [--package <name>] [--query <text>] [--json]
  yarn framework:context --package <@open-mercato/name> [--query <text>] [--json]
  yarn framework:context --root [--json]

The command reads the installed package selected by this app and materializes the
smallest read-only instruction/source context under .ai/framework-context/.`)
}

try {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
  } else {
    const result = buildResult(args)
    if (args.materialize && result.package) materialize(result, args.query)
    if (args.json) console.log(JSON.stringify(result, null, 2))
    else {
      if (result.package) console.log(`Package: ${result.package.name}@${result.package.version}`)
      if (result.module) console.log(`Module: ${result.module}`)
      if (result.sourceRoot) console.log(`Source: ${result.sourceRoot}`)
      for (const instruction of result.instructions) {
        if (instruction.path) console.log(`Instruction (${instruction.kind}): ${instruction.path}`)
      }
      if (result.manifest) console.log(`Materialized: ${result.manifest}`)
      for (const warning of result.warnings ?? []) console.warn(`Warning: ${warning}`)
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
