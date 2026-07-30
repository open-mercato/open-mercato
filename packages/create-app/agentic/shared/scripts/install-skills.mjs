#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const KNOWN_AGENTS = ['claude-code', 'codex', 'cursor']
const LEGACY_AGENTS = ['claude-code', 'codex']
const AGENT_DIRECTORIES = {
  'claude-code': ['.claude', 'skills'],
  codex: ['.codex', 'skills'],
  cursor: ['.cursor', 'skills'],
}
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const COMMIT_PATTERN = /^[a-f0-9]{40}$/
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const ARCHIVE_LIMIT_BYTES = 32 * 1024 * 1024
const EXTRACTED_LIMIT_BYTES = 256 * 1024 * 1024
const EXTERNAL_OWNERSHIP_FILE = '.om-external-ownership.json'

const USAGE = `Usage: install-skills.mjs [options]

Options:
  (no options)        Install the default local and external tiers.
  --with <csv>        Install default local/external tiers plus the named tiers.
  --tiers <csv>       Install exactly the named local/external tiers.
  --all               Install every local and external tier.
  --legacy-links      Also expose skills through .claude/skills and .codex/skills.
  --ignore-agents <csv>
                      Never write the named agent directories.
  --no-external       Skip the pinned external collection (also OM_SKIP_EXTERNAL_SKILLS=1).
  --update            Resolve the shared repository's current main commit, pin
                      its verified skill hashes, then install that exact snapshot.
  --list              Print the tier and external-skill catalog, then exit.
  --clean             Remove harness-owned skill links, then exit.
  --help, -h          Show this message.

--with, --tiers, and --all are mutually exclusive.`

function fail(message) {
  throw new Error(`install-skills: ${message}`)
}

function unique(values) {
  return [...new Set(values)]
}

function csv(value) {
  return unique(value.split(',').map((entry) => entry.trim()).filter(Boolean))
}

function isWithin(candidate, root) {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

function realInstallerRoot(rootDir) {
  const resolved = resolve(rootDir)
  const entry = lstatSync(resolved, { throwIfNoEntry: false })
  if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) fail(`installer root must be a real directory: ${resolved}`)
  return realpathSync(resolved)
}

function relativeComponents(rootDir, targetPath) {
  if (!isWithin(targetPath, rootDir)) fail(`installer-owned path escapes the app root: ${targetPath}`)
  const pathFromRoot = relative(resolve(rootDir), resolve(targetPath))
  return pathFromRoot ? pathFromRoot.split(sep).filter(Boolean) : []
}

function assertRealDirectoryComponents(rootDir, targetPath, { allowedLeafLinks = [], requireLeaf = false } = {}) {
  const components = relativeComponents(rootDir, targetPath)
  let current = resolve(rootDir)
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index])
    const entry = lstatSync(current, { throwIfNoEntry: false })
    if (!entry) {
      if (requireLeaf) fail(`installer-owned directory is missing: ${current}`)
      return
    }
    if (entry.isSymbolicLink()) {
      const isLeaf = index === components.length - 1
      const target = symlinkTarget(current)
      const allowed = isLeaf && allowedLeafLinks.some((candidate) => resolve(candidate) === resolve(target))
      if (allowed) return
      fail(`installer-owned path contains a symbolic-link component: ${current}`)
    }
    if (!entry.isDirectory()) fail(`installer-owned path component is not a directory: ${current}`)
  }
}

function ensureRealDirectory(rootDir, targetPath) {
  const components = relativeComponents(rootDir, targetPath)
  let current = resolve(rootDir)
  for (const component of components) {
    assertRealDirectoryComponents(rootDir, current, { requireLeaf: true })
    current = join(current, component)
    let entry = lstatSync(current, { throwIfNoEntry: false })
    if (!entry) {
      mkdirSync(current)
      entry = lstatSync(current, { throwIfNoEntry: false })
    }
    if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) {
      fail(`installer-owned directory is not a real directory: ${current}`)
    }
  }
}

function assertRegularOwnedFile(rootDir, filePath, { optional = true } = {}) {
  assertRealDirectoryComponents(rootDir, dirname(filePath), { requireLeaf: true })
  const entry = lstatSync(filePath, { throwIfNoEntry: false })
  if (!entry) {
    if (!optional) fail(`installer-owned file is missing: ${filePath}`)
    return
  }
  if (entry.isSymbolicLink() || !entry.isFile()) fail(`installer-owned file must be a regular file: ${filePath}`)
}

function assertOwnedPathAbsent(rootDir, targetPath) {
  assertRealDirectoryComponents(rootDir, dirname(targetPath), { requireLeaf: true })
  if (lstatSync(targetPath, { throwIfNoEntry: false })) fail(`installer temporary path already exists: ${targetPath}`)
}

function removeInstallerTransactionPath(rootDir, targetPath) {
  assertRealDirectoryComponents(rootDir, dirname(targetPath), { requireLeaf: true })
  const entry = lstatSync(targetPath, { throwIfNoEntry: false })
  if (!entry) return
  if (entry.isDirectory() && !entry.isSymbolicLink()) rmSync(targetPath, { recursive: true, force: true })
  else unlinkSync(targetPath)
}

function assertInstallerPathPreflight(rootDir) {
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  assertRealDirectoryComponents(rootDir, aiSkillsDir, { requireLeaf: true })
  assertRealDirectoryComponents(rootDir, join(rootDir, '.agents'))
  assertRealDirectoryComponents(rootDir, canonicalDir, { allowedLeafLinks: [aiSkillsDir] })
  assertRealDirectoryComponents(rootDir, join(rootDir, '.agents', 'skills-quarantine'))
  for (const agent of KNOWN_AGENTS) {
    const agentRoot = join(rootDir, AGENT_DIRECTORIES[agent][0])
    const agentSkills = join(rootDir, ...AGENT_DIRECTORIES[agent])
    assertRealDirectoryComponents(rootDir, agentRoot)
    assertRealDirectoryComponents(rootDir, agentSkills, { allowedLeafLinks: [aiSkillsDir, canonicalDir] })
  }
}

function symlinkTarget(linkPath) {
  const target = readlinkSync(linkPath)
  return resolve(dirname(linkPath), target)
}

function isHarnessOwnedLink(linkPath, aiSkillsDir, canonicalDir) {
  const entry = lstatSync(linkPath, { throwIfNoEntry: false })
  if (!entry?.isSymbolicLink()) return false
  const target = symlinkTarget(linkPath)
  return isWithin(target, aiSkillsDir) || isWithin(target, canonicalDir)
}

function removeEmptyDirectory(rootDir, path) {
  assertRealDirectoryComponents(rootDir, dirname(path), { requireLeaf: true })
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (entry?.isDirectory() && !entry.isSymbolicLink() && readdirSync(path).length === 0) {
    assertRealDirectoryComponents(rootDir, dirname(path), { requireLeaf: true })
    rmdirSync(path)
  }
}

function prepareLinkDirectory(rootDir, path, aiSkillsDir, canonicalDir) {
  ensureRealDirectory(rootDir, dirname(path))
  assertRealDirectoryComponents(rootDir, dirname(path), { requireLeaf: true })
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (entry?.isSymbolicLink()) {
    const target = symlinkTarget(path)
    if (resolve(target) !== resolve(aiSkillsDir) && resolve(target) !== resolve(canonicalDir)) {
      fail(`refusing to replace user-owned link ${path}`)
    }
    assertRealDirectoryComponents(rootDir, dirname(path), { requireLeaf: true })
    unlinkSync(path)
  } else if (entry && !entry.isDirectory()) {
    fail(`refusing to replace user-owned path ${path}`)
  }
  ensureRealDirectory(rootDir, path)
}

function replaceManagedLink(rootDir, linkPath, targetPath, relativeTarget, platform, aiSkillsDir, canonicalDir) {
  assertRealDirectoryComponents(rootDir, dirname(linkPath), { requireLeaf: true })
  const entry = lstatSync(linkPath, { throwIfNoEntry: false })
  if (entry) {
    if (!entry.isSymbolicLink() || !isHarnessOwnedLink(linkPath, aiSkillsDir, canonicalDir)) {
      fail(`refusing to replace user-owned path ${linkPath}`)
    }
    if (resolve(symlinkTarget(linkPath)) === resolve(targetPath)) return
    assertRealDirectoryComponents(rootDir, dirname(linkPath), { requireLeaf: true })
    unlinkSync(linkPath)
  }
  assertRealDirectoryComponents(rootDir, dirname(linkPath), { requireLeaf: true })
  if (platform === 'win32') {
    symlinkSync(resolve(targetPath), linkPath, 'junction')
  } else {
    symlinkSync(relativeTarget, linkPath, 'dir')
  }
}

function cleanManagedLinks(rootDir, directory, aiSkillsDir, canonicalDir, keep = new Set()) {
  assertRealDirectoryComponents(rootDir, dirname(directory))
  const entry = lstatSync(directory, { throwIfNoEntry: false })
  if (!entry) return
  if (entry.isSymbolicLink()) {
    if (isHarnessOwnedLink(directory, aiSkillsDir, canonicalDir)) {
      assertRealDirectoryComponents(rootDir, dirname(directory), { requireLeaf: true })
      unlinkSync(directory)
    }
    return
  }
  if (!entry.isDirectory()) return
  for (const name of readdirSync(directory)) {
    const candidate = join(directory, name)
    if (!keep.has(name) && isHarnessOwnedLink(candidate, aiSkillsDir, canonicalDir)) {
      assertRealDirectoryComponents(rootDir, directory, { requireLeaf: true })
      unlinkSync(candidate)
    }
  }
  removeEmptyDirectory(rootDir, directory)
}

function parseArgs(args, env) {
  const options = {
    mode: 'default',
    tierValues: [],
    list: false,
    clean: false,
    legacyLinks: false,
    ignoreAgents: undefined,
    update: false,
    noExternal: Boolean(env.OM_SKIP_EXTERNAL_SKILLS && env.OM_SKIP_EXTERNAL_SKILLS !== '0'),
  }
  let selectionFlag
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') return { ...options, help: true }
    if (arg === '--list') options.list = true
    else if (arg === '--clean') options.clean = true
    else if (arg === '--legacy-links') options.legacyLinks = true
    else if (arg === '--no-external') options.noExternal = true
    else if (arg === '--update') options.update = true
    else if (arg === '--all') {
      if (selectionFlag && selectionFlag !== '--all') fail('--with, --tiers, and --all are mutually exclusive')
      selectionFlag = '--all'
      options.mode = 'all'
    } else if (arg === '--with' || arg === '--tiers' || arg === '--ignore-agents') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) fail(`${arg} requires a comma-separated value`)
      index += 1
      if (arg === '--ignore-agents') options.ignoreAgents = csv(value)
      else {
        if (selectionFlag && selectionFlag !== arg) fail('--with, --tiers, and --all are mutually exclusive')
        selectionFlag = arg
        options.mode = arg === '--with' ? 'with' : 'tiers'
        options.tierValues = csv(value)
        if (options.tierValues.length === 0) fail(`${arg} requires at least one tier name`)
      }
    } else if (arg.startsWith('--with=') || arg.startsWith('--tiers=') || arg.startsWith('--ignore-agents=')) {
      const [flag, value = ''] = arg.split(/=(.*)/s, 2)
      if (flag === '--ignore-agents') options.ignoreAgents = csv(value)
      else {
        if (selectionFlag && selectionFlag !== flag) fail('--with, --tiers, and --all are mutually exclusive')
        selectionFlag = flag
        options.mode = flag === '--with' ? 'with' : 'tiers'
        options.tierValues = csv(value)
        if (options.tierValues.length === 0) fail(`${flag} requires at least one tier name`)
      }
    } else fail(`unknown option '${arg}'`)
  }
  if (options.update && options.noExternal) fail('--update and --no-external are mutually exclusive')
  return options
}

function readManifest(rootDir) {
  const manifestPath = join(rootDir, '.ai', 'skills', 'tiers.json')
  assertRegularOwnedFile(rootDir, manifestPath, { optional: false })
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`cannot parse ${manifestPath}: ${error.message}`)
  }
  if (!Array.isArray(manifest.default) || manifest.default.length === 0 || !manifest.tiers || typeof manifest.tiers !== 'object') {
    fail('manifest requires a non-empty default list and a tiers object')
  }
  for (const tier of manifest.default) if (!manifest.tiers[tier]) fail(`default tier '${tier}' is not defined`)
  const assigned = new Set()
  for (const [tierName, tier] of Object.entries(manifest.tiers)) {
    if (!tier || typeof tier.description !== 'string' || !Array.isArray(tier.skills) || tier.skills.length === 0) {
      fail(`tier '${tierName}' requires a description and non-empty skills list`)
    }
    for (const skill of tier.skills) {
      if (typeof skill !== 'string' || !SKILL_NAME_PATTERN.test(skill)) fail(`local skill name '${skill}' is invalid`)
      if (assigned.has(skill)) fail(`local skill '${skill}' belongs to more than one tier`)
      assigned.add(skill)
    }
  }
  const external = manifest.external
  if (!external || typeof external.source !== 'string' || !COMMIT_PATTERN.test(external.ref ?? '')) {
    fail('external.source and an exact 40-character external.ref are required')
  }
  if (!Array.isArray(external.skills) || external.skills.length === 0) fail('external.skills must be non-empty')
  for (const skill of external.skills) {
    if (typeof skill !== 'string' || !SKILL_NAME_PATTERN.test(skill)) fail(`external skill name '${skill}' is invalid`)
  }
  const externalNames = new Set(external.skills)
  if (externalNames.size !== external.skills.length) fail('external.skills contains duplicates')
  for (const skill of externalNames) if (assigned.has(skill)) fail(`skill '${skill}' is both local and external`)
  if (!external.tiers || typeof external.tiers !== 'object' || Object.keys(external.tiers).length === 0) {
    fail('external.tiers must define at least one explicit tier')
  }
  const tierAssigned = new Set()
  for (const [tierName, tier] of Object.entries(external.tiers)) {
    if (!manifest.tiers[tierName]) fail(`external tier '${tierName}' has no matching local tier selector`)
    if (!tier || typeof tier.description !== 'string' || !Array.isArray(tier.skills) || tier.skills.length === 0) {
      fail(`external tier '${tierName}' requires a description and non-empty skills list`)
    }
    for (const skill of tier.skills) {
      if (!externalNames.has(skill)) fail(`external tier '${tierName}' names unknown skill '${skill}'`)
      if (tierAssigned.has(skill)) fail(`external skill '${skill}' belongs to more than one tier`)
      tierAssigned.add(skill)
    }
  }
  for (const skill of externalNames) {
    if (!tierAssigned.has(skill)) fail(`external skill '${skill}' is not assigned to an external tier`)
  }
  if (!external.dependencies || typeof external.dependencies !== 'object') fail('external.dependencies is required')
  if (!external.contentHashes || typeof external.contentHashes !== 'object') fail('external.contentHashes is required')
  for (const skill of external.skills) {
    const dependencies = external.dependencies[skill]
    if (!Array.isArray(dependencies)) fail(`external dependency graph has no entry for '${skill}'`)
    for (const dependency of dependencies) {
      if (!externalNames.has(dependency)) fail(`external skill '${skill}' requires missing '${dependency}'`)
    }
    if (!SHA256_PATTERN.test(external.contentHashes[skill] ?? '')) fail(`external skill '${skill}' has no pinned SHA-256 hash`)
  }
  for (const skill of Object.keys(external.dependencies)) if (!externalNames.has(skill)) fail(`dependency graph names unknown skill '${skill}'`)
  for (const skill of Object.keys(external.contentHashes)) if (!externalNames.has(skill)) fail(`contentHashes names unknown skill '${skill}'`)
  for (const agent of manifest.agents?.ignore ?? []) {
    if (!KNOWN_AGENTS.includes(agent)) fail(`unknown agent '${agent}'; valid agents: ${KNOWN_AGENTS.join(', ')}`)
  }
  return manifest
}

function selectedTiers(manifest, options) {
  const allTiers = Object.keys(manifest.tiers).sort()
  let selected
  if (options.mode === 'all') selected = allTiers
  else if (options.mode === 'tiers') selected = options.tierValues
  else selected = [...manifest.default, ...(options.mode === 'with' ? options.tierValues : [])]
  selected = unique(selected)
  for (const tier of selected) if (!manifest.tiers[tier]) fail(`unknown tier '${tier}'; valid tiers: ${allTiers.join(', ')}`)
  return selected
}

function selectedLocalSkills(manifest, tiers) {
  return unique(tiers.flatMap((tier) => manifest.tiers[tier].skills))
}

function selectedExternalSkills(manifest, tiers) {
  const selected = new Set(tiers.flatMap((tier) => manifest.external.tiers[tier]?.skills ?? []))
  const visited = new Set()
  const visit = (skill) => {
    if (visited.has(skill)) return
    visited.add(skill)
    for (const dependency of manifest.external.dependencies[skill]) {
      selected.add(dependency)
      visit(dependency)
    }
  }
  for (const skill of [...selected]) visit(skill)
  return manifest.external.skills.filter((skill) => selected.has(skill))
}

function selectedExternalConfig(manifest, tiers) {
  return { ...manifest.external, skills: selectedExternalSkills(manifest, tiers) }
}

function printCatalog(manifest) {
  for (const [name, tier] of Object.entries(manifest.tiers).sort(([left], [right]) => left.localeCompare(right))) {
    const label = manifest.default.includes(name) ? 'default' : 'opt-in'
    console.log(`${name.padEnd(12)} (${tier.skills.length} skills, ${label}):`)
    console.log(`  ${tier.skills.join(', ')}`)
  }
  console.log(`\nexternal     (${manifest.external.skills.length} skills available, pinned):`)
  console.log(`  source: ${manifest.external.source}@${manifest.external.ref}`)
  for (const [name, tier] of Object.entries(manifest.external.tiers).sort(([left], [right]) => left.localeCompare(right))) {
    const label = manifest.default.includes(name) ? 'default' : 'opt-in'
    console.log(`  ${name.padEnd(10)} (${tier.skills.length} entry skills, ${label}; dependencies added): ${tier.skills.join(', ')}`)
  }
}

function readTarString(buffer, start, length) {
  const end = buffer.indexOf(0, start)
  return buffer.subarray(start, end === -1 || end > start + length ? start + length : end).toString('utf8')
}

function extractGitHubArchive(compressed, destination) {
  const archive = gunzipSync(compressed, { maxOutputLength: EXTRACTED_LIMIT_BYTES })
  let offset = 0
  let rootName
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const archivePath = prefix ? `${prefix}/${name}` : name
    const sizeText = readTarString(header, 124, 12).trim().replace(/\0/g, '')
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0
    if (!Number.isSafeInteger(size) || size < 0) fail('external archive contains an invalid entry size')
    const type = String.fromCharCode(header[156] || 48)
    if (type === 'x' || type === 'g') {
      offset += 512 + Math.ceil(size / 512) * 512
      continue
    }
    const segments = archivePath.split('/').filter(Boolean)
    if (segments.length === 0 || segments.some((segment) => segment === '..' || segment.includes('\\'))) {
      fail(`external archive contains unsafe path '${archivePath}'`)
    }
    rootName ??= segments[0]
    if (segments[0] !== rootName) fail('external archive contains multiple roots')
    const outputPath = join(destination, ...segments)
    if (!isWithin(outputPath, destination)) fail(`external archive escapes extraction root: '${archivePath}'`)
    if (type === '5') mkdirSync(outputPath, { recursive: true })
    else if (type === '0' || type === '\0') {
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, archive.subarray(offset + 512, offset + 512 + size))
    } else {
      fail(`external archive contains unsupported entry type '${type}'`)
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (!rootName) fail('external archive is empty')
  return join(destination, rootName)
}

async function downloadPinnedSource(external, fetchImpl) {
  const match = external.source.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (!match) fail(`unsupported external source '${external.source}'; expected owner/repository`)
  const [, owner, repository] = match
  const archiveUrl = `https://codeload.github.com/${owner}/${repository}/tar.gz/${external.ref}`
  const response = await fetchImpl(archiveUrl, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) fail(`external archive download failed (${response.status})`)
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > ARCHIVE_LIMIT_BYTES) fail('external archive exceeds the download limit')
  const compressed = Buffer.from(await response.arrayBuffer())
  if (compressed.length > ARCHIVE_LIMIT_BYTES) fail('external archive exceeds the download limit')
  const tempRoot = mkdtempSync(join(tmpdir(), 'om-skills-'))
  try {
    return { tempRoot, sourceDir: extractGitHubArchive(compressed, tempRoot) }
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true })
    throw error
  }
}

async function resolveLatestRef(external, fetchImpl) {
  const match = external.source.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (!match) fail(`unsupported external source '${external.source}'; expected owner/repository`)
  const [, owner, repository] = match
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repository}/commits/main`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) fail(`external current-ref lookup failed (${response.status})`)
  const payload = await response.json()
  if (!COMMIT_PATTERN.test(payload?.sha ?? '')) fail('external current-ref lookup returned an invalid commit')
  return payload.sha
}

function inspectDownloadedSource(downloaded) {
  const lexicalDownloadRoot = resolve(downloaded.tempRoot)
  if (!isWithin(downloaded.sourceDir, lexicalDownloadRoot)) fail('downloaded external source escapes its temporary root')
  const downloadRoot = realInstallerRoot(downloaded.tempRoot)
  const sourceEntry = lstatSync(downloaded.sourceDir, { throwIfNoEntry: false })
  if (!sourceEntry || sourceEntry.isSymbolicLink() || !sourceEntry.isDirectory()) {
    fail('downloaded external source must be a real directory')
  }
  const sourceDir = realpathSync(downloaded.sourceDir)
  if (!isWithin(sourceDir, downloadRoot)) fail('downloaded external source escapes its temporary root')
  assertRealDirectoryComponents(downloadRoot, sourceDir, { requireLeaf: true })
  assertRegularSkillTree(sourceDir)
  const sourceSkillsDir = join(sourceDir, 'skills')
  assertRealDirectoryComponents(downloadRoot, sourceSkillsDir, { requireLeaf: true })
  return { downloadRoot, sourceDir, sourceSkillsDir }
}

function cleanupDownloadedSource(downloadRoot) {
  if (!downloadRoot) return
  const entry = lstatSync(downloadRoot, { throwIfNoEntry: false })
  if (entry?.isDirectory() && !entry.isSymbolicLink()) rmSync(downloadRoot, { recursive: true, force: true })
  else if (entry) unlinkSync(downloadRoot)
}

function writeManifest(rootDir, manifestOrSource) {
  const manifestPath = join(rootDir, '.ai', 'skills', 'tiers.json')
  assertRegularOwnedFile(rootDir, manifestPath, { optional: false })
  const temporary = `${manifestPath}.tmp-${randomUUID()}`
  const source = typeof manifestOrSource === 'string'
    ? manifestOrSource
    : `${JSON.stringify(manifestOrSource, null, 2)}\n`
  try {
    assertOwnedPathAbsent(rootDir, temporary)
    writeFileSync(temporary, source, { mode: 0o600, flag: 'wx' })
    assertRegularOwnedFile(rootDir, temporary, { optional: false })
    assertRegularOwnedFile(rootDir, manifestPath, { optional: false })
    renameSync(temporary, manifestPath)
  } finally {
    const entry = lstatSync(temporary, { throwIfNoEntry: false })
    if (entry) unlinkSync(temporary)
  }
}

async function refreshExternalManifest(rootDir, manifest, fetchImpl, downloadSource, latestRefResolver) {
  const ref = await latestRefResolver(manifest.external, fetchImpl)
  const candidate = { ...manifest.external, ref }
  let downloadRoot
  try {
    const downloaded = await downloadSource(candidate, fetchImpl)
    downloadRoot = realInstallerRoot(downloaded.tempRoot)
    const inspected = inspectDownloadedSource(downloaded)
    downloadRoot = inspected.downloadRoot
    const contentHashes = {}
    for (const skill of candidate.skills) {
      const skillDir = join(inspected.sourceSkillsDir, skill)
      const entry = lstatSync(skillDir, { throwIfNoEntry: false })
      if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) fail(`current external skill is missing: ${skill}`)
      contentHashes[skill] = hashSkillDirectory(skillDir)
    }
    const refreshed = {
      ...manifest,
      external: { ...candidate, contentHashes },
    }
    writeManifest(rootDir, refreshed)
    return { manifest: refreshed, downloaded }
  } catch (error) {
    cleanupDownloadedSource(downloadRoot)
    throw error
  }
}

function filesystemEntryKind(entry) {
  if (entry.isSymbolicLink()) return 'symbolic link'
  if (entry.isFIFO()) return 'FIFO'
  if (entry.isSocket()) return 'socket'
  if (entry.isBlockDevice()) return 'block device'
  if (entry.isCharacterDevice()) return 'character device'
  return 'unsupported filesystem node'
}

function regularFilesRecursively(root, current = '') {
  const directory = join(root, current)
  const directoryEntry = lstatSync(directory, { throwIfNoEntry: false })
  const displayDirectory = current ? current.split(sep).join('/') : '.'
  if (!directoryEntry) fail(`skill tree entry disappeared during validation: '${displayDirectory}'`)
  if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) {
    fail(`skill tree requires a real directory at '${displayDirectory}', found ${filesystemEntryKind(directoryEntry)}`)
  }

  const result = []
  for (const name of readdirSync(directory)) {
    const child = join(current, name)
    const childPath = join(root, child)
    const entry = lstatSync(childPath, { throwIfNoEntry: false })
    const displayChild = child.split(sep).join('/')
    if (!entry) fail(`skill tree entry disappeared during validation: '${displayChild}'`)
    if (entry.isSymbolicLink()) fail(`skill tree contains a symbolic link at '${displayChild}'`)
    if (entry.isDirectory()) result.push(...regularFilesRecursively(root, child))
    else if (entry.isFile()) result.push(child)
    else fail(`skill tree contains an unsupported ${filesystemEntryKind(entry)} at '${displayChild}'`)
  }
  return result
}

export function assertRegularSkillTree(root) {
  regularFilesRecursively(root)
}

export function hashSkillDirectory(root) {
  const hash = createHash('sha256')
  for (const file of regularFilesRecursively(root).sort()) {
    hash.update(file.split(sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(join(root, file)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function externalOwnershipPath(rootDir) {
  return join(rootDir, '.agents', 'skills', EXTERNAL_OWNERSHIP_FILE)
}

function readExternalOwnership(rootDir) {
  const ledgerPath = externalOwnershipPath(rootDir)
  assertRealDirectoryComponents(rootDir, dirname(ledgerPath))
  const ledgerEntry = lstatSync(ledgerPath, { throwIfNoEntry: false })
  if (!ledgerEntry) return null
  if (ledgerEntry.isSymbolicLink() || !ledgerEntry.isFile()) fail('external skill ownership ledger must be a regular file')
  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch (error) {
    fail(`cannot parse external skill ownership ledger: ${error.message}`)
  }
  if (ledger?.version !== 1 || typeof ledger.source !== 'string' || !COMMIT_PATTERN.test(ledger.ref ?? '') || !ledger.skills || typeof ledger.skills !== 'object') {
    fail('external skill ownership ledger is invalid')
  }
  for (const [skill, hash] of Object.entries(ledger.skills)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(skill) || !SHA256_PATTERN.test(hash)) fail('external skill ownership ledger is invalid')
  }
  return ledger
}

function writeExternalOwnership(rootDir, external, skills = undefined) {
  const ledgerPath = externalOwnershipPath(rootDir)
  ensureRealDirectory(rootDir, dirname(ledgerPath))
  assertRegularOwnedFile(rootDir, ledgerPath)
  const temporary = `${ledgerPath}.tmp-${randomUUID()}`
  const ledger = {
    version: 1,
    source: external.source,
    ref: external.ref,
    skills: skills ?? Object.fromEntries(external.skills.map((skill) => [skill, external.contentHashes[skill]])),
  }
  try {
    assertOwnedPathAbsent(rootDir, temporary)
    writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    assertRegularOwnedFile(rootDir, temporary, { optional: false })
    assertRegularOwnedFile(rootDir, ledgerPath)
    assertRealDirectoryComponents(rootDir, dirname(ledgerPath), { requireLeaf: true })
    renameSync(temporary, ledgerPath)
  } finally {
    assertRealDirectoryComponents(rootDir, dirname(temporary), { requireLeaf: true })
    const temporaryEntry = lstatSync(temporary, { throwIfNoEntry: false })
    if (temporaryEntry) {
      if (temporaryEntry.isDirectory() && !temporaryEntry.isSymbolicLink()) rmSync(temporary, { recursive: true, force: true })
      else unlinkSync(temporary)
    }
  }
}

function uniqueQuarantinePath(rootDir, skill) {
  const quarantineRoot = join(rootDir, '.agents', 'skills-quarantine')
  ensureRealDirectory(rootDir, quarantineRoot)
  assertRealDirectoryComponents(rootDir, quarantineRoot, { requireLeaf: true })
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(quarantineRoot, suffix === 1 ? skill : `${skill}.${suffix}`)
    if (!lstatSync(candidate, { throwIfNoEntry: false })) return candidate
  }
}

export function reconcileExternalSkillVisibility(rootDir, external) {
  assertRealDirectoryComponents(rootDir, join(rootDir, '.agents', 'skills'))
  assertRealDirectoryComponents(rootDir, join(rootDir, '.agents', 'skills-quarantine'))
  const ledger = readExternalOwnership(rootDir)
  const canonicalDir = join(rootDir, '.agents', 'skills')
  const quarantined = []
  const active = {}
  const names = unique([...Object.keys(ledger?.skills ?? {}), ...external.skills])
  for (const skill of names) {
    const skillDir = join(canonicalDir, skill)
    const entry = lstatSync(skillDir, { throwIfNoEntry: false })
    if (!entry) continue
    let actual = 'non-directory'
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      try {
        actual = hashSkillDirectory(skillDir)
      } catch (error) {
        actual = `unsafe (${error.message})`
      }
    }
    const expected = external.skills.includes(skill) ? external.contentHashes[skill] : undefined
    if (actual === expected) {
      active[skill] = expected
      continue
    }
    const previouslyOwned = Object.hasOwn(ledger?.skills ?? {}, skill)
    if (!previouslyOwned) continue
    const quarantinePath = uniqueQuarantinePath(rootDir, skill)
    assertRealDirectoryComponents(rootDir, canonicalDir, { requireLeaf: true })
    assertRealDirectoryComponents(rootDir, dirname(quarantinePath), { requireLeaf: true })
    renameSync(skillDir, quarantinePath)
    quarantined.push({ skill, path: quarantinePath, actual, expected: expected ?? 'removed from manifest' })
  }
  if (ledger || Object.keys(active).length > 0) writeExternalOwnership(rootDir, external, active)
  return quarantined
}

export function assertExternalDestinationsReplaceable(rootDir, external) {
  const ledger = readExternalOwnership(rootDir)
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  assertRealDirectoryComponents(rootDir, aiSkillsDir, { requireLeaf: true })
  assertRealDirectoryComponents(rootDir, canonicalDir, { requireLeaf: true })
  for (const skill of external.skills) {
    const destination = join(canonicalDir, skill)
    const existing = lstatSync(destination, { throwIfNoEntry: false })
    if (!existing) continue
    if (existing.isSymbolicLink()) {
      if (!isHarnessOwnedLink(destination, aiSkillsDir, canonicalDir)) fail(`refusing to replace user-owned link ${destination}`)
      continue
    }
    if (!existing.isDirectory()) fail(`refusing to replace user-owned path ${destination}`)
    const actual = hashSkillDirectory(destination)
    const previouslyOwned = ledger?.skills?.[skill] === actual
    const alreadyPinned = external.contentHashes[skill] === actual
    if (!previouslyOwned && !alreadyPinned) fail(`refusing to replace unowned external skill directory ${destination}`)
  }
}

async function installExternal(rootDir, external, fetchImpl, downloadSource, activationObserver) {
  let downloaded
  let downloadRoot
  try {
    downloaded = await downloadSource(external, fetchImpl)
    downloadRoot = realInstallerRoot(downloaded.tempRoot)
    const inspected = inspectDownloadedSource(downloaded)
    downloadRoot = inspected.downloadRoot
    const { sourceSkillsDir } = inspected
    const mismatches = []
    for (const skill of external.skills) {
      const skillDir = join(sourceSkillsDir, skill)
      const entry = lstatSync(skillDir, { throwIfNoEntry: false })
      const actual = entry?.isDirectory() && !entry.isSymbolicLink() ? hashSkillDirectory(skillDir) : 'missing'
      if (actual !== external.contentHashes[skill]) mismatches.push(`${skill} (${actual})`)
    }
    if (mismatches.length > 0) fail(`external skill integrity check failed: ${mismatches.join(', ')}`)

    const aiSkillsDir = join(rootDir, '.ai', 'skills')
    const canonicalDir = join(rootDir, '.agents', 'skills')
    prepareLinkDirectory(rootDir, canonicalDir, aiSkillsDir, canonicalDir)
    assertExternalDestinationsReplaceable(rootDir, external)
    const nonce = randomUUID()
    const transactions = external.skills.map((skill) => ({
      skill,
      destination: join(canonicalDir, skill),
      stagedDestination: join(canonicalDir, `.om-install-${skill}-${nonce}`),
      backupDestination: join(canonicalDir, `.om-backup-${skill}-${nonce}`),
      existed: Boolean(lstatSync(join(canonicalDir, skill), { throwIfNoEntry: false })),
      staged: false,
      backedUp: false,
      activated: false,
    }))
    let committed = false
    try {
      // Stage and attest the complete set before changing any discoverable path.
      for (const transaction of transactions) {
        const { skill, stagedDestination, backupDestination } = transaction
        assertRealDirectoryComponents(downloadRoot, sourceSkillsDir, { requireLeaf: true })
        assertOwnedPathAbsent(rootDir, stagedDestination)
        assertOwnedPathAbsent(rootDir, backupDestination)
        cpSync(join(sourceSkillsDir, skill), stagedDestination, { recursive: true, errorOnExist: true })
        transaction.staged = true
        const copiedHash = hashSkillDirectory(stagedDestination)
        if (copiedHash !== external.contentHashes[skill]) {
          fail(`external skill changed while copying '${skill}' (${copiedHash})`)
        }
      }

      // Keep every previous destination as a backup until every new skill and
      // the ownership ledger have committed. Any failure restores the full old
      // set, so the non-fatal caller can safely continue with local skills.
      for (const transaction of transactions) {
        const { skill, destination, stagedDestination, backupDestination } = transaction
        if (transaction.existed) {
          assertRealDirectoryComponents(rootDir, canonicalDir, { requireLeaf: true })
          renameSync(destination, backupDestination)
          transaction.backedUp = true
        }
        assertRealDirectoryComponents(rootDir, canonicalDir, { requireLeaf: true })
        renameSync(stagedDestination, destination)
        transaction.staged = false
        transaction.activated = true
        const installedHash = hashSkillDirectory(destination)
        if (installedHash !== external.contentHashes[skill]) {
          fail(`external skill changed while activating '${skill}' (${installedHash})`)
        }
        activationObserver?.(skill)
      }

      const verified = {}
      for (const skill of external.skills) {
        const actual = hashSkillDirectory(join(canonicalDir, skill))
        if (actual !== external.contentHashes[skill]) fail(`installed external skill integrity check failed: ${skill} (${actual})`)
        verified[skill] = actual
      }
      writeExternalOwnership(rootDir, external, verified)
      committed = true
    } catch (error) {
      const rollbackErrors = []
      for (const transaction of [...transactions].reverse()) {
        try {
          if (transaction.activated) removeInstallerTransactionPath(rootDir, transaction.destination)
          if (transaction.backedUp && lstatSync(transaction.backupDestination, { throwIfNoEntry: false })) {
            assertRealDirectoryComponents(rootDir, canonicalDir, { requireLeaf: true })
            renameSync(transaction.backupDestination, transaction.destination)
            transaction.backedUp = false
          }
        } catch (rollbackError) {
          rollbackErrors.push(`${transaction.skill}: ${rollbackError.message}`)
        }
      }
      if (rollbackErrors.length > 0) {
        fail(`${error.message}; external skill rollback failed (${rollbackErrors.join('; ')})`)
      }
      throw error
    } finally {
      for (const transaction of transactions) {
        if (transaction.staged) removeInstallerTransactionPath(rootDir, transaction.stagedDestination)
        if (committed && transaction.backedUp) {
          try {
            removeInstallerTransactionPath(rootDir, transaction.backupDestination)
            transaction.backedUp = false
          } catch (error) {
            console.warn(`install-skills: warning: committed '${transaction.skill}' but could not remove its hidden backup (${error.message})`)
          }
        }
      }
    }
    return `installed ${external.source}@${external.ref}`
  } finally {
    cleanupDownloadedSource(downloadRoot)
  }
}

function relativeLink(fromDirectory, target) {
  const value = relative(fromDirectory, target) || '.'
  return value.split(sep).join('/')
}

function installLocalLinks(rootDir, localSkills, platform) {
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  prepareLinkDirectory(rootDir, canonicalDir, aiSkillsDir, canonicalDir)
  for (const skill of localSkills) {
    const target = join(aiSkillsDir, skill)
    assertRealDirectoryComponents(rootDir, target, { requireLeaf: true })
    assertRegularSkillTree(target)
    replaceManagedLink(
      rootDir,
      join(canonicalDir, skill),
      target,
      relativeLink(canonicalDir, target),
      platform,
      aiSkillsDir,
      canonicalDir,
    )
  }
  cleanManagedLinks(rootDir, canonicalDir, aiSkillsDir, canonicalDir, new Set(localSkills))
}

function installedExternalSkills(rootDir, external) {
  const canonicalDir = join(rootDir, '.agents', 'skills')
  return external.skills.filter((skill) => {
    const skillDir = join(canonicalDir, skill)
    const entry = lstatSync(skillDir, { throwIfNoEntry: false })
    if (!entry?.isDirectory() || entry.isSymbolicLink()) return false
    try {
      return hashSkillDirectory(skillDir) === external.contentHashes[skill]
    } catch {
      return false
    }
  })
}

function installAgentLinks(rootDir, agent, names, localSkills, legacyLinks, platform) {
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  const harnessDir = join(rootDir, ...AGENT_DIRECTORIES[agent])
  prepareLinkDirectory(rootDir, harnessDir, aiSkillsDir, canonicalDir)
  for (const skill of names) {
    const localLegacyTarget = legacyLinks && localSkills.includes(skill)
    const target = localLegacyTarget ? join(aiSkillsDir, skill) : join(canonicalDir, skill)
    replaceManagedLink(
      rootDir,
      join(harnessDir, skill),
      target,
      relativeLink(harnessDir, target),
      platform,
      aiSkillsDir,
      canonicalDir,
    )
  }
  cleanManagedLinks(rootDir, harnessDir, aiSkillsDir, canonicalDir, new Set(names))
}

function cleanAllLinks(rootDir) {
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  for (const agent of KNOWN_AGENTS) cleanManagedLinks(rootDir, join(rootDir, ...AGENT_DIRECTORIES[agent]), aiSkillsDir, canonicalDir)
  cleanManagedLinks(rootDir, canonicalDir, aiSkillsDir, canonicalDir)
}

export async function runInstaller({
  rootDir,
  args = [],
  env = process.env,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  downloadSource = downloadPinnedSource,
  resolveLatestRef: latestRefResolver = resolveLatestRef,
  activationObserver = undefined,
} = {}) {
  const options = parseArgs(args, env)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  rootDir = realInstallerRoot(rootDir)
  assertInstallerPathPreflight(rootDir)
  let manifest = readManifest(rootDir)
  if (options.list) {
    printCatalog(manifest)
    return 0
  }
  if (options.clean) {
    cleanAllLinks(rootDir)
    console.log('Removed harness-owned skill links; user-owned paths and installed external directories were preserved.')
    return 0
  }
  const ignoredAgents = options.ignoreAgents ?? manifest.agents?.ignore ?? []
  for (const agent of ignoredAgents) if (!KNOWN_AGENTS.includes(agent)) fail(`unknown agent '${agent}'; valid agents: ${KNOWN_AGENTS.join(', ')}`)
  const tiers = selectedTiers(manifest, options)
  const localSkills = selectedLocalSkills(manifest, tiers)
  let external = selectedExternalConfig(manifest, tiers)
  for (const skill of localSkills) {
    const localSkillDir = join(rootDir, '.ai', 'skills', skill)
    assertRealDirectoryComponents(rootDir, localSkillDir, { requireLeaf: true })
    assertRegularSkillTree(localSkillDir)
  }
  prepareLinkDirectory(rootDir, join(rootDir, '.agents', 'skills'), join(rootDir, '.ai', 'skills'), join(rootDir, '.agents', 'skills'))
  const quarantined = reconcileExternalSkillVisibility(rootDir, external)
  for (const item of quarantined) {
    console.warn(`install-skills: quarantined stale or modified managed skill '${item.skill}' outside agent discovery: ${item.path}`)
  }
  let externalStatus = 'skipped (--no-external)'
  let refreshDownload
  const originalManifestSource = options.update
    ? readFileSync(join(rootDir, '.ai', 'skills', 'tiers.json'), 'utf8')
    : undefined
  if (options.update) {
    const refreshed = await refreshExternalManifest(rootDir, manifest, fetchImpl, downloadSource, latestRefResolver)
    manifest = refreshed.manifest
    refreshDownload = refreshed.downloaded
    external = selectedExternalConfig(manifest, tiers)
  }
  try {
    if (external.skills.length === 0) {
      externalStatus = 'skipped (no external skills selected)'
    } else if (!options.noExternal) {
      try {
        const installDownloadSource = refreshDownload
          ? async () => {
              const downloaded = refreshDownload
              refreshDownload = undefined
              return downloaded
            }
          : downloadSource
        externalStatus = await installExternal(rootDir, external, fetchImpl, installDownloadSource, activationObserver)
      } catch (error) {
        if (options.update) {
          writeManifest(rootDir, originalManifestSource)
          throw error
        }
        externalStatus = `unavailable (${error.message})`
        console.warn(`install-skills: warning: ${error.message}`)
        console.warn('  Local skills will still be installed. Retry with `yarn install-skills` when online.')
      }
    }
  } finally {
    if (refreshDownload) cleanupDownloadedSource(realInstallerRoot(refreshDownload.tempRoot))
  }
  installLocalLinks(rootDir, localSkills, platform)
  const externalInstalled = installedExternalSkills(rootDir, external)
  const allInstalled = unique([...localSkills, ...externalInstalled])
  const linkAgents = options.legacyLinks ? LEGACY_AGENTS : ['claude-code']
  for (const agent of KNOWN_AGENTS) {
    const harnessDir = join(rootDir, ...AGENT_DIRECTORIES[agent])
    if (ignoredAgents.includes(agent)) {
      cleanManagedLinks(rootDir, harnessDir, join(rootDir, '.ai', 'skills'), join(rootDir, '.agents', 'skills'))
    } else if (linkAgents.includes(agent)) {
      installAgentLinks(rootDir, agent, allInstalled, localSkills, options.legacyLinks, platform)
    } else {
      cleanManagedLinks(rootDir, harnessDir, join(rootDir, '.ai', 'skills'), join(rootDir, '.agents', 'skills'))
    }
  }
  console.log(`Installed ${localSkills.length} local skills across ${tiers.length} tier(s): ${tiers.join(', ')}.`)
  console.log(`External skills: ${externalStatus}.`)
  if (options.update) console.log(`Pinned current shared skills at ${external.ref}.`)
  const links = linkAgents.filter((agent) => !ignoredAgents.includes(agent))
  console.log(`Layout: .agents/skills/ (canonical); per-agent links: ${links.join(', ') || 'none'}.`)
  if (options.mode === 'default') console.log('Tip: inspect opt-in tiers with `yarn install-skills --list`.')
  return 0
}

// Node canonicalizes import.meta.url through real filesystem paths, while argv
// may retain a lexical alias (for example macOS /tmp -> /private/tmp). Compare
// canonical paths so scaffolding through a symlinked parent still runs the
// installer instead of returning success without installing anything.
const isEntryPoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  runInstaller({ rootDir, args: process.argv.slice(2) }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
