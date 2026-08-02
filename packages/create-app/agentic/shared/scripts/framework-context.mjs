#!/usr/bin/env node

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { TextDecoder } from 'node:util'

const workingDirectory = process.cwd()
const workingDirectoryStat = lstatSync(workingDirectory)
if (workingDirectoryStat.isSymbolicLink() || !workingDirectoryStat.isDirectory()) {
  throw new Error('app root must be a regular directory, not a symbolic link')
}
const appRoot = realpathSync(workingDirectory)
const requireFromApp = createRequire(join(appRoot, 'package.json'))
const SEARCH_MATCH_LIMIT = 200
const INSTALLED_PACKAGE_SCAN_LIMIT = 1000
const FALLBACK_TREE_ENTRY_LIMIT = 50_000
const FALLBACK_SEARCH_BYTE_LIMIT = 64 * 1024 * 1024
const MATERIALIZATION_ENTRY_LIMIT = 10_000
const MATERIALIZATION_FILE_BYTE_LIMIT = 8 * 1024 * 1024
const MATERIALIZATION_TOTAL_BYTE_LIMIT = 64 * 1024 * 1024
const MATERIALIZATION_TEXT_EXTENSIONS = new Set([
  '.cjs', '.conf', '.css', '.csv', '.cts', '.graphql', '.html', '.ini', '.js', '.json',
  '.jsx', '.less', '.md', '.mdx', '.mjs', '.mts', '.prisma', '.sass', '.scss', '.sql',
  '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])
const MATERIALIZATION_DENIED_DIRECTORIES = new Set([
  '.aws', '.azure', '.git', '.gnupg', '.ssh', 'node_modules',
])
const MATERIALIZATION_DENIED_FILES = new Set([
  '.netrc', '.npmrc', '.pypirc', '.yarnrc', '.yarnrc.yml',
  'auth.json', 'credentials', 'credentials.json', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  'id_rsa', 'secret.json', 'secrets.json', 'secrets.yaml', 'secrets.yml',
  'service-account.json',
])
const MATERIALIZATION_DENIED_EXTENSIONS = new Set([
  '.jks', '.key', '.keystore', '.p12', '.p8', '.pem', '.pfx',
])
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

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

function lstatIfPresent(candidate) {
  try {
    return lstatSync(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function assertRegularDirectory(root, candidate, label) {
  const lexical = resolve(candidate)
  assertInside(root, lexical, label)
  const stat = lstatIfPresent(lexical)
  if (!stat) return false
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`)
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory`)
  assertInside(root, realpathSync(lexical), label)
  return true
}

function ensureDirectoryChain(root, candidate, label) {
  const lexical = resolve(candidate)
  assertInside(root, lexical, label)
  if (!assertRegularDirectory(root, root, 'app root')) throw new Error('app root is unavailable')
  const delta = relative(root, lexical)
  if (!delta) return

  let cursor = root
  for (const component of delta.split(sep).filter(Boolean)) {
    cursor = join(cursor, component)
    if (assertRegularDirectory(root, cursor, `${label} parent`)) continue
    try {
      mkdirSync(cursor, { mode: 0o755 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    if (!assertRegularDirectory(root, cursor, `${label} parent`)) {
      throw new Error(`failed to create ${label} parent`)
    }
  }
}

function writeContextFile(destination, content) {
  const parent = dirname(destination)
  ensureDirectoryChain(appRoot, parent, 'context output')
  assertStrictlyInside(appRoot, resolve(destination), 'context output')
  const flags = constants.O_CREAT
    | constants.O_EXCL
    | constants.O_WRONLY
    | (constants.O_NOFOLLOW ?? 0)
  let descriptor
  try {
    descriptor = openSync(destination, flags, 0o644)
    writeFileSync(descriptor, content)
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw new Error(`context output already exists: ${relative(appRoot, destination)}`)
    }
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  const stat = lstatSync(destination)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('context output is not a regular file')
  assertInside(appRoot, realpathSync(destination), 'context output')
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
  if (declared.length > 0) {
    const providers = [...new Set(declared.map((entry) => entry.from))].sort()
    if (declared.length > 1 && providers.length === 1) {
      throw new Error(`module ${moduleId} is declared ${declared.length} times for ${providers[0]}`)
    }
    return providers
  }

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

function deniedMaterializationPath(relativePath, directory) {
  const components = relativePath.split(sep).filter(Boolean).map((component) => component.toLowerCase())
  if (components.some((component) => MATERIALIZATION_DENIED_DIRECTORIES.has(component))) return true
  if (directory || components.length === 0) return false
  const filename = components.at(-1)
  if (filename === '.env' || filename.startsWith('.env.')) return true
  if (MATERIALIZATION_DENIED_FILES.has(filename)) return true
  return MATERIALIZATION_DENIED_EXTENSIONS.has(extname(filename))
}

function readMaterializationText(source, relativePath, state) {
  let descriptor
  try {
    descriptor = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`context source contains a non-regular file: ${relativePath}`)
    if (stat.size > MATERIALIZATION_FILE_BYTE_LIMIT) {
      throw new Error(`context source file exceeds ${MATERIALIZATION_FILE_BYTE_LIMIT} byte limit: ${relativePath}`)
    }
    if (state.copiedBytes + stat.size > MATERIALIZATION_TOTAL_BYTE_LIMIT) {
      throw new Error(`context source exceeds ${MATERIALIZATION_TOTAL_BYTE_LIMIT} materialized bytes`)
    }
    const content = readFileSync(descriptor)
    if (content.includes(0)) return null
    try {
      utf8Decoder.decode(content)
    } catch {
      return null
    }
    if (/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/.test(content.toString('utf8'))) return null
    return content
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function copyContextFile(source, destination) {
  ensureDirectoryChain(appRoot, dirname(destination), 'context output')
  assertStrictlyInside(appRoot, resolve(destination), 'context output')
  if (lstatIfPresent(destination)) throw new Error(`context output already exists: ${relative(appRoot, destination)}`)

  const sourceRoot = resolve(source)
  const rootStat = lstatSync(sourceRoot)
  if (rootStat.isSymbolicLink()) throw new Error('context source must not be a symbolic link')
  const state = { entriesVisited: 0, copiedFiles: 0, copiedBytes: 0, omittedEntries: 0 }

  function copyEntry(candidate, target, relativePath, root = false) {
    state.entriesVisited += 1
    if (state.entriesVisited > MATERIALIZATION_ENTRY_LIMIT) {
      throw new Error(`context source exceeded ${MATERIALIZATION_ENTRY_LIMIT} filesystem entries`)
    }

    const stat = lstatSync(candidate)
    if (stat.isSymbolicLink()) {
      if (root) throw new Error('context source must not be a symbolic link')
      state.omittedEntries += 1
      return
    }
    if (stat.isDirectory()) {
      if (!root && deniedMaterializationPath(relativePath, true)) {
        state.omittedEntries += 1
        return
      }
      ensureDirectoryChain(appRoot, target, 'context output')
      for (const entry of readdirSync(candidate, { withFileTypes: true })
        .sort((left, right) => comparePaths(left.name, right.name))) {
        copyEntry(join(candidate, entry.name), join(target, entry.name), join(relativePath, entry.name))
      }
      return
    }
    if (!stat.isFile()) throw new Error(`context source contains a special filesystem entry: ${relativePath}`)
    if (deniedMaterializationPath(relativePath, false)
      || !MATERIALIZATION_TEXT_EXTENSIONS.has(extname(relativePath).toLowerCase())) {
      state.omittedEntries += 1
      return
    }

    const content = readMaterializationText(candidate, relativePath, state)
    if (!content) {
      state.omittedEntries += 1
      return
    }
    writeContextFile(target, content)
    state.copiedFiles += 1
    state.copiedBytes += content.byteLength
  }

  copyEntry(sourceRoot, destination, basename(sourceRoot), true)
  if (rootStat.isFile() && state.copiedFiles !== 1) {
    throw new Error(`context source is not an allowed regular text file: ${basename(sourceRoot)}`)
  }
  const stat = lstatSync(destination)
  if (stat.isSymbolicLink()) throw new Error('context output must not be a symbolic link')
  assertInside(appRoot, realpathSync(destination), 'context output')
  return state
}

function runRg(args, label, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync('rg', args, {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer,
  })
  if (result.error?.code === 'ENOENT') return null
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  if (result.status !== 0 && result.status !== 1) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${label} (exit ${String(result.status)}): ${detail || 'unknown rg error'}`)
  }
  return result
}

function nulDelimitedPaths(output) {
  return output.split('\0').filter(Boolean)
}

function regularFileStrictlyBelow(root, candidate, label) {
  const lexicalRoot = resolve(root)
  const lexical = resolve(candidate)
  const canonicalRoot = realpathSync(lexicalRoot)
  try {
    assertStrictlyInside(lexicalRoot, lexical, label)
  } catch {
    assertStrictlyInside(canonicalRoot, lexical, label)
  }
  const stat = lstatIfPresent(lexical)
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symbolic file below ${lexicalRoot}`)
  }
  const canonical = realpathSync(lexical)
  assertStrictlyInside(canonicalRoot, canonical, label)
  return canonical
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function fallbackRegularFiles(root, label) {
  const scanRoot = realpathSync(root)
  const pending = [scanRoot]
  const files = []
  let entriesVisited = 0

  while (pending.length > 0) {
    const directory = pending.pop()
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePaths(left.name, right.name))
    for (const entry of entries) {
      entriesVisited += 1
      if (entriesVisited > FALLBACK_TREE_ENTRY_LIMIT) {
        throw new Error(`${label} exceeded ${FALLBACK_TREE_ENTRY_LIMIT} filesystem entries`)
      }
      const candidate = join(directory, entry.name)
      const stat = lstatSync(candidate)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        assertInside(scanRoot, realpathSync(candidate), label)
        pending.push(candidate)
      } else if (stat.isFile()) {
        assertInside(scanRoot, realpathSync(candidate), label)
        files.push(candidate)
      }
    }
  }

  return files.sort(comparePaths)
}

function fallbackInstalledPackageManifests(nodeModulesRoot) {
  const scanRoot = realpathSync(nodeModulesRoot)
  const manifests = []
  const pendingNodeModules = [scanRoot]
  const visitedNodeModules = new Set()
  let entriesVisited = 0

  function boundedDirectories(directory) {
    const directories = []
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePaths(left.name, right.name))) {
      entriesVisited += 1
      if (entriesVisited > FALLBACK_TREE_ENTRY_LIMIT) {
        throw new Error(`installed package scan failed exceeded ${FALLBACK_TREE_ENTRY_LIMIT} filesystem entries`)
      }
      const candidate = join(directory, entry.name)
      const stat = lstatSync(candidate)
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue
      assertInside(scanRoot, realpathSync(candidate), 'installed package scan failed')
      directories.push(candidate)
    }
    return directories
  }

  function enqueueNodeModules(candidate) {
    const stat = lstatIfPresent(candidate)
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return
    const canonical = realpathSync(candidate)
    assertInside(scanRoot, canonical, 'installed package scan failed')
    if (!visitedNodeModules.has(canonical)) pendingNodeModules.push(canonical)
  }

  function inspectPackageRoot(packageRoot, isOpenMercato) {
    if (isOpenMercato) {
      const manifest = join(packageRoot, 'package.json')
      const stat = lstatIfPresent(manifest)
      if (stat?.isFile() && !stat.isSymbolicLink()) {
        assertInside(scanRoot, realpathSync(manifest), 'installed package scan failed')
        manifests.push(manifest)
        if (manifests.length > INSTALLED_PACKAGE_SCAN_LIMIT) {
          throw new Error(`installed package scan exceeded ${INSTALLED_PACKAGE_SCAN_LIMIT} manifests`)
        }
      }
    }
    enqueueNodeModules(join(packageRoot, 'node_modules'))
  }

  while (pendingNodeModules.length > 0) {
    pendingNodeModules.sort(comparePaths)
    const directory = pendingNodeModules.shift()
    if (visitedNodeModules.has(directory)) continue
    visitedNodeModules.add(directory)

    for (const entryPath of boundedDirectories(directory)) {
      const entryName = basename(entryPath)
      if (entryName === '.pnpm') {
        for (const pnpmPackage of boundedDirectories(entryPath)) {
          enqueueNodeModules(join(pnpmPackage, 'node_modules'))
        }
      } else if (entryName.startsWith('@')) {
        for (const packageRoot of boundedDirectories(entryPath)) {
          inspectPackageRoot(packageRoot, entryName === '@open-mercato')
        }
      } else if (!entryName.startsWith('.')) {
        inspectPackageRoot(entryPath, false)
      }
    }
  }

  return manifests.sort(comparePaths)
}

function fallbackBoundedSearch(query, sourceRoot) {
  const matches = []
  let bytesRead = 0
  for (const file of fallbackRegularFiles(sourceRoot, 'bounded search failed')) {
    const size = lstatSync(file).size
    if (bytesRead + size > FALLBACK_SEARCH_BYTE_LIMIT) {
      throw new Error(`bounded search failed: fallback scan exceeded ${FALLBACK_SEARCH_BYTE_LIMIT} bytes`)
    }
    bytesRead += size
    const content = readFileSync(file)
    if (content.includes(0)) continue

    const lines = content.toString('utf8').split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line.includes(query)) continue
      const preview = line.length > 500 ? `${line.slice(0, 500)}…` : line
      matches.push(`${file}:${index + 1}:${preview}`)
      if (matches.length > SEARCH_MATCH_LIMIT) break
    }
    if (matches.length > SEARCH_MATCH_LIMIT) break
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

function packageRecord(packageName, packageRoot) {
  const manifest = readJson(join(packageRoot, 'package.json'))
  if (manifest.name !== packageName) {
    throw new Error(`resolved package ${packageName} has manifest name ${String(manifest.name)}`)
  }
  const version = typeof manifest.version === 'string' ? manifest.version : 'unknown'
  encodePackageVersion(version)
  return {
    name: packageName,
    version,
    root: packageRoot,
  }
}

function relevantPackageNames(selectedPackage) {
  const appManifest = readJson(join(appRoot, 'package.json'))
  return [...new Set([
    selectedPackage,
    ...parseModuleEntries().map((entry) => entry.from),
    ...Object.keys({ ...appManifest.dependencies, ...appManifest.devDependencies }),
  ].filter((name) => typeof name === 'string' && name.startsWith('@open-mercato/')))].sort()
}

function installedPackageDiagnostics(selectedPackage, selectedRoot) {
  const packageNames = relevantPackageNames(selectedPackage)
  const packageNameSet = new Set(packageNames)
  const cohort = []
  for (const packageName of packageNames) {
    const packageRoot = packageName === selectedPackage ? selectedRoot : findPackageRoot(packageName)
    if (packageRoot) cohort.push(packageRecord(packageName, packageRoot))
  }
  cohort.sort((left, right) => left.name.localeCompare(right.name) || left.root.localeCompare(right.root))

  const installations = new Map()
  for (const record of cohort) installations.set(`${record.name}\0${record.root}`, record)
  const nodeModulesRoot = join(appRoot, 'node_modules')
  if (existsSync(nodeModulesRoot)) {
    const packageScan = runRg(
      [
        '--no-ignore',
        '--hidden',
        '--files',
        '--null',
        '--sort',
        'path',
        '--glob',
        '**/@open-mercato/*/package.json',
        nodeModulesRoot,
      ],
      'installed package scan failed',
    )
    const manifests = packageScan
      ? nulDelimitedPaths(packageScan.stdout)
      : fallbackInstalledPackageManifests(nodeModulesRoot)
    if (manifests.length > INSTALLED_PACKAGE_SCAN_LIMIT) {
      throw new Error(`installed package scan exceeded ${INSTALLED_PACKAGE_SCAN_LIMIT} manifests`)
    }
    for (const manifestPath of manifests) {
      const safeManifestPath = regularFileStrictlyBelow(
        nodeModulesRoot,
        manifestPath,
        'installed package manifest',
      )
      const packageName = `@open-mercato/${basename(dirname(safeManifestPath))}`
      if (!packageNameSet.has(packageName)) continue
      const packageRoot = realpathSync(dirname(safeManifestPath))
      const record = packageRecord(packageName, packageRoot)
      installations.set(`${record.name}\0${record.root}`, record)
    }
  }

  const allInstallations = [...installations.values()]
    .sort((left, right) => left.name.localeCompare(right.name)
      || left.version.localeCompare(right.version)
      || left.root.localeCompare(right.root))
  const duplicates = []
  for (const packageName of packageNames) {
    const records = allInstallations.filter((record) => record.name === packageName)
    if (records.length > 1) duplicates.push({ name: packageName, installations: records })
  }
  return { cohort, duplicates }
}

function displayPackageRecord(record) {
  const location = relative(appRoot, record.root).split(sep).join('/') || '.'
  return `${record.name}@${record.version} (${location})`
}

function packageDiagnosticWarnings(diagnostics) {
  const warnings = []
  const versions = new Set(diagnostics.cohort.map((record) => record.version))
  if (versions.size > 1) {
    warnings.push(
      `Installed Open Mercato package cohort uses mixed versions: ${diagnostics.cohort.map(displayPackageRecord).join(', ')}. Context remains package-specific; do not combine generated facts or source across versions.`,
    )
  }
  for (const duplicate of diagnostics.duplicates) {
    const selected = diagnostics.cohort.find((record) => record.name === duplicate.name)
    warnings.push(
      `Multiple installed copies of ${duplicate.name} were found: ${duplicate.installations.map(displayPackageRecord).join(', ')}.${selected ? ` App resolution selected ${displayPackageRecord(selected)}; no other copy was read.` : ''}`,
    )
  }
  return warnings
}

function runBoundedSearch(query, sourceRoot) {
  const fileSearch = runRg(
    ['--no-ignore', '--hidden', '--fixed-strings', '--files-with-matches', '--null', '--sort', 'path', '--', query, sourceRoot],
    'bounded search failed',
  )
  if (!fileSearch) return fallbackBoundedSearch(query, sourceRoot)
  if (fileSearch.status === 1) {
    return { output: '', matches: 0, truncated: false, status: 'no-matches' }
  }

  const matchingFiles = nulDelimitedPaths(fileSearch.stdout)
    .sort()
  const matches = []

  for (const file of matchingFiles.slice(0, SEARCH_MATCH_LIMIT + 1)) {
    const remaining = SEARCH_MATCH_LIMIT + 1 - matches.length
    if (remaining <= 0) break
    const safeFile = regularFileStrictlyBelow(sourceRoot, file, 'bounded search candidate')
    const search = runRg(
      [
        '--no-ignore',
        '--hidden',
        '--fixed-strings',
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
        safeFile,
      ],
      `bounded search failed for ${safeFile}`,
      512 * 1024,
    )
    if (!search) return fallbackBoundedSearch(query, sourceRoot)
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
  ensureDirectoryChain(appRoot, contextRoot, 'framework context root')
  const existingOutput = lstatIfPresent(outputRoot)
  if (existingOutput) {
    assertRegularDirectory(appRoot, outputRoot, 'context output')
    ensureDirectoryChain(appRoot, contextRoot, 'framework context root')
    rmSync(outputRoot, { recursive: true, force: true })
  }
  ensureDirectoryChain(appRoot, outputRoot, 'context output')

  for (const instruction of result.instructions) {
    if (!instruction.path || !existsSync(instruction.path)) continue
    const target = join(outputRoot, 'instructions', `${instruction.kind}.md`)
    copyContextFile(instruction.path, target)
    instruction.materializedPath = relative(appRoot, target)
  }

  let materializedSourceRoot
  if (result.sourceRoot && existsSync(result.sourceRoot)) {
    const sourceTarget = join(outputRoot, 'source', result.module ?? 'package')
    const materialization = copyContextFile(result.sourceRoot, sourceTarget)
    materializedSourceRoot = sourceTarget
    result.materializedSource = relative(appRoot, sourceTarget)
    if (materialization.omittedEntries > 0) {
      result.warnings.push(
        `Materialized source omitted ${materialization.omittedEntries} credential, key, symbolic, binary, or unsupported filesystem entries.`,
      )
    }
  }

  if (query && materializedSourceRoot) {
    const search = runBoundedSearch(query, materializedSourceRoot)
    const searchPath = join(outputRoot, 'search.txt')
    writeContextFile(searchPath, search.output)
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
  writeContextFile(manifestPath, `${JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2)}\n`)
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
  const installedPackages = installedPackageDiagnostics(packageName, packageRoot)
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
    installedPackages,
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
        ? [`Generated facts for ${moduleId} are stale. After registry changes run yarn generate, then yarn mercato agentic:init --update-harness; after a dependency-only upgrade run the update-harness command.`]
        : []),
      ...packageDiagnosticWarnings(installedPackages),
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
