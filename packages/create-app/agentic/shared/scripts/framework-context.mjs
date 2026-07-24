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
const SEARCH_MATCH_LIMIT = 200

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

function assertStrictlyInside(root, candidate, label) {
  const delta = relative(root, candidate)
  if (delta !== '' && !delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta)) return candidate
  throw new Error(`${label} escapes ${root}`)
}

function encodePackageVersion(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(value)
  ) {
    throw new Error(`invalid package version: ${String(value)}`)
  }
  return encodeURIComponent(value)
}

function candidatePackages(moduleId) {
  const declared = parseModuleEntries().filter((entry) => entry.id === moduleId)
  if (declared.length > 0) return [...new Set(declared.map((entry) => entry.from))]

  const appManifest = readJson(join(appRoot, 'package.json'))
  const names = Object.keys({ ...appManifest.dependencies, ...appManifest.devDependencies })
    .filter((name) => name.startsWith('@open-mercato/'))
  return names.filter((name) => {
    const root = findPackageRoot(name)
    return root && (
      existsSync(join(root, 'src', 'modules', moduleId))
      || existsSync(join(root, 'dist', 'modules', moduleId))
    )
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

function runRg(args, label, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync('rg', args, {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer,
  })
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  if (result.status !== 0 && result.status !== 1) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${label} (exit ${String(result.status)}): ${detail || 'unknown rg error'}`)
  }
  return result
}

function runBoundedSearch(query, sourceRoot) {
  const fileSearch = runRg(
    ['--no-ignore', '--hidden', '--files-with-matches', '--sort', 'path', '--', query, sourceRoot],
    'bounded search failed',
  )
  if (fileSearch.status === 1) {
    return { output: '', matches: 0, truncated: false, status: 'no-matches' }
  }

  const matchingFiles = fileSearch.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()
  const matches = []

  for (const file of matchingFiles.slice(0, SEARCH_MATCH_LIMIT + 1)) {
    const remaining = SEARCH_MATCH_LIMIT + 1 - matches.length
    if (remaining <= 0) break
    const search = runRg(
      [
        '--no-ignore',
        '--hidden',
        '--line-number',
        '--with-filename',
        '--color',
        'never',
        '--max-columns',
        '500',
        '--max-columns-preview',
        '--max-count',
        String(remaining),
        '--',
        query,
        file,
      ],
      `bounded search failed for ${file}`,
      512 * 1024,
    )
    if (search.status === 0) {
      matches.push(...search.stdout.split(/\r?\n/).filter(Boolean))
    }
  }

  const truncated = matches.length > SEARCH_MATCH_LIMIT
  const boundedMatches = matches.slice(0, SEARCH_MATCH_LIMIT)
  return {
    output: boundedMatches.length > 0 ? `${boundedMatches.join('\n')}\n` : '',
    matches: boundedMatches.length,
    truncated,
    status: boundedMatches.length > 0 ? 'matched' : 'no-matches',
  }
}

function materialize(result, query) {
  const safePackage = result.package.name.replace(/^@/, '').replaceAll('/', '-')
  const safeVersion = encodePackageVersion(result.package.version)
  const contextRoot = resolve(appRoot, '.ai', 'framework-context')
  const outputRoot = assertStrictlyInside(
    contextRoot,
    resolve(contextRoot, `${safePackage}@${safeVersion}`),
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
    const search = runBoundedSearch(query, result.sourceRoot)
    const searchPath = join(outputRoot, 'search.txt')
    writeFileSync(searchPath, search.output)
    result.searchResult = relative(appRoot, searchPath)
    result.boundedSearch = {
      query,
      maxMatches: SEARCH_MATCH_LIMIT,
      matches: search.matches,
      truncated: search.truncated,
      status: search.status,
      result: result.searchResult,
    }
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
  const sourceKind = existsSync(sourceCandidate) ? 'source' : existsSync(distCandidate) ? 'dist' : 'missing'
  const sourceRoot = sourceKind === 'source'
    ? assertInside(packageRoot, realpathSync(sourceCandidate), 'source root')
    : sourceKind === 'dist'
      ? assertInside(packageRoot, realpathSync(distCandidate), 'dist root')
      : null
  const degraded = sourceKind !== 'source'
  const snapshotVersion = typeof snapshot?.generator === 'string'
    ? snapshot.generator.match(/@(\d+\.\d+\.\d+(?:-[^\s]+)?)/)?.[1] ?? null
    : null
  const factsPath = join(appRoot, '.ai', 'guides', 'module-facts.json')
  const moduleFact = moduleId && existsSync(factsPath) ? readJson(factsPath)?.[moduleId] ?? null : null
  const factSourcePackage = moduleFact?.sourcePackage ?? null
  const factSourceVersion = moduleFact?.sourceVersion ?? moduleFact?.coreVersion ?? null
  const factsCurrent = !moduleFact || (
    (!factSourcePackage || factSourcePackage === packageName)
    && (!factSourceVersion || factSourceVersion === packageManifest.version)
  )

  return {
    mode: moduleId ? 'module' : 'package',
    module: moduleId,
    package: { name: packageName, version: packageManifest.version ?? 'unknown', root: packageRoot },
    sourceRoot,
    sourceKind,
    degraded,
    snapshot,
    generatedFacts: moduleFact ? {
      current: factsCurrent,
      sourcePackage: factSourcePackage,
      sourceVersion: factSourceVersion,
    } : null,
    instructions: [
      { kind: 'standalone-root', path: existsSync(standaloneRoot) ? standaloneRoot : null },
      { kind: 'upstream-bc', path: existsSync(upstreamBc) ? upstreamBc : null },
      ...nearestAgentsFiles(packageRoot, sourceRoot).map((path, index) => ({
        kind: index === 0 ? 'package' : `module-${index}`,
        path,
      })),
      { kind: 'upstream-root', path: existsSync(upstreamRoot) ? upstreamRoot : null },
    ],
    boundedSearch: sourceRoot ? {
      query: args.query ?? null,
      maxMatches: SEARCH_MATCH_LIMIT,
      matches: null,
      truncated: null,
      status: args.query ? 'pending' : 'query-required',
      result: null,
    } : null,
    warnings: [
      ...(degraded ? ['TypeScript package source is unavailable; analysis is limited to dist/types.'] : []),
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
