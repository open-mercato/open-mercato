#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
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
const ARCHIVE_LIMIT_BYTES = 32 * 1024 * 1024
const EXTRACTED_LIMIT_BYTES = 256 * 1024 * 1024

const USAGE = `Usage: install-skills.mjs [options]

Options:
  (no options)        Install the default local tiers plus the pinned external set.
  --with <csv>        Install default tiers plus the named tiers.
  --tiers <csv>       Install exactly the named tiers.
  --all               Install every local tier.
  --legacy-links      Also expose skills through .claude/skills and .codex/skills.
  --ignore-agents <csv>
                      Never write the named agent directories.
  --no-external       Skip the pinned external collection (also OM_SKIP_EXTERNAL_SKILLS=1).
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

function removeEmptyDirectory(path) {
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (entry?.isDirectory() && readdirSync(path).length === 0) rmdirSync(path)
}

function prepareLinkDirectory(path, aiSkillsDir, canonicalDir) {
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (entry?.isSymbolicLink()) {
    const target = symlinkTarget(path)
    if (resolve(target) !== resolve(aiSkillsDir) && resolve(target) !== resolve(canonicalDir)) {
      fail(`refusing to replace user-owned link ${path}`)
    }
    unlinkSync(path)
  } else if (entry && !entry.isDirectory()) {
    fail(`refusing to replace user-owned path ${path}`)
  }
  mkdirSync(path, { recursive: true })
}

function replaceManagedLink(linkPath, targetPath, relativeTarget, platform, aiSkillsDir, canonicalDir) {
  const entry = lstatSync(linkPath, { throwIfNoEntry: false })
  if (entry) {
    if (!entry.isSymbolicLink() || !isHarnessOwnedLink(linkPath, aiSkillsDir, canonicalDir)) {
      fail(`refusing to replace user-owned path ${linkPath}`)
    }
    if (resolve(symlinkTarget(linkPath)) === resolve(targetPath)) return
    unlinkSync(linkPath)
  }
  if (platform === 'win32') {
    symlinkSync(resolve(targetPath), linkPath, 'junction')
  } else {
    symlinkSync(relativeTarget, linkPath, 'dir')
  }
}

function cleanManagedLinks(directory, aiSkillsDir, canonicalDir, keep = new Set()) {
  const entry = lstatSync(directory, { throwIfNoEntry: false })
  if (!entry) return
  if (entry.isSymbolicLink()) {
    if (isHarnessOwnedLink(directory, aiSkillsDir, canonicalDir)) unlinkSync(directory)
    return
  }
  if (!entry.isDirectory()) return
  for (const name of readdirSync(directory)) {
    const candidate = join(directory, name)
    if (!keep.has(name) && isHarnessOwnedLink(candidate, aiSkillsDir, canonicalDir)) unlinkSync(candidate)
  }
  removeEmptyDirectory(directory)
}

function parseArgs(args, env) {
  const options = {
    mode: 'default',
    tierValues: [],
    list: false,
    clean: false,
    legacyLinks: false,
    ignoreAgents: undefined,
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
  return options
}

function readManifest(rootDir) {
  const manifestPath = join(rootDir, '.ai', 'skills', 'tiers.json')
  if (!existsSync(manifestPath)) fail(`missing manifest ${manifestPath}`)
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
      if (assigned.has(skill)) fail(`local skill '${skill}' belongs to more than one tier`)
      assigned.add(skill)
    }
  }
  const external = manifest.external
  if (!external || typeof external.source !== 'string' || !COMMIT_PATTERN.test(external.ref ?? '')) {
    fail('external.source and an exact 40-character external.ref are required')
  }
  if (external.cli?.package !== 'skills' || typeof external.cli.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(external.cli.version)) {
    fail('external.cli must pin the skills package to an exact version')
  }
  if (!Array.isArray(external.skills) || external.skills.length === 0) fail('external.skills must be non-empty')
  const externalNames = new Set(external.skills)
  if (externalNames.size !== external.skills.length) fail('external.skills contains duplicates')
  for (const skill of externalNames) if (assigned.has(skill)) fail(`skill '${skill}' is both local and external`)
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

function printCatalog(manifest) {
  for (const [name, tier] of Object.entries(manifest.tiers).sort(([left], [right]) => left.localeCompare(right))) {
    const label = manifest.default.includes(name) ? 'default' : 'opt-in'
    console.log(`${name.padEnd(12)} (${tier.skills.length} skills, ${label}):`)
    console.log(`  ${tier.skills.join(', ')}`)
  }
  console.log(`\nexternal     (${manifest.external.skills.length} skills, pinned):`)
  console.log(`  source: ${manifest.external.source}@${manifest.external.ref}`)
  console.log(`  cli: ${manifest.external.cli.package}@${manifest.external.cli.version}`)
  console.log(`  ${manifest.external.skills.join(', ')}`)
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

export function externalCliInvocation(external, sourceDir, platform = process.platform) {
  const executable = platform === 'win32' ? 'npx.cmd' : 'npx'
  const args = ['-y', `${external.cli.package}@${external.cli.version}`, 'add', sourceDir]
  for (const skill of external.skills) args.push('--skill', skill)
  args.push('--agent', 'universal', '-y')
  return { executable, args }
}

function filesRecursively(root, current = '') {
  const result = []
  for (const entry of readdirSync(join(root, current), { withFileTypes: true })) {
    const child = join(current, entry.name)
    if (entry.isDirectory()) result.push(...filesRecursively(root, child))
    else if (entry.isFile()) result.push(child)
  }
  return result
}

export function hashSkillDirectory(root) {
  const hash = createHash('sha256')
  for (const file of filesRecursively(root).sort()) {
    hash.update(file.split(sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(join(root, file)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

async function installExternal(rootDir, external, platform, spawn, fetchImpl) {
  let downloaded
  try {
    downloaded = await downloadPinnedSource(external, fetchImpl)
    const invocation = externalCliInvocation(external, downloaded.sourceDir, platform)
    const installRoot = join(downloaded.tempRoot, 'install')
    mkdirSync(installRoot, { recursive: true })
    const result = spawn(invocation.executable, invocation.args, { cwd: installRoot, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) fail(`external skills CLI exited with status ${result.status}`)
    const stagedSkillsDir = join(installRoot, '.agents', 'skills')
    const mismatches = []
    for (const skill of external.skills) {
      const skillDir = join(stagedSkillsDir, skill)
      const entry = lstatSync(skillDir, { throwIfNoEntry: false })
      const actual = entry?.isDirectory() ? hashSkillDirectory(skillDir) : 'missing'
      if (actual !== external.contentHashes[skill]) mismatches.push(`${skill} (${actual})`)
    }
    if (mismatches.length > 0) fail(`external skill integrity check failed: ${mismatches.join(', ')}`)

    const aiSkillsDir = join(rootDir, '.ai', 'skills')
    const canonicalDir = join(rootDir, '.agents', 'skills')
    prepareLinkDirectory(canonicalDir, aiSkillsDir, canonicalDir)
    for (const skill of external.skills) {
      const destination = join(canonicalDir, skill)
      const existing = lstatSync(destination, { throwIfNoEntry: false })
      if (existing?.isSymbolicLink() && !isHarnessOwnedLink(destination, aiSkillsDir, canonicalDir)) {
        fail(`refusing to replace user-owned link ${destination}`)
      }
      if (existing && !existing.isDirectory() && !existing.isSymbolicLink()) {
        fail(`refusing to replace user-owned path ${destination}`)
      }
    }
    const nonce = `${process.pid}-${Date.now()}`
    for (const skill of external.skills) {
      const destination = join(canonicalDir, skill)
      const existing = lstatSync(destination, { throwIfNoEntry: false })
      const stagedDestination = join(canonicalDir, `.om-install-${skill}-${nonce}`)
      const backupDestination = join(canonicalDir, `.om-backup-${skill}-${nonce}`)
      cpSync(join(stagedSkillsDir, skill), stagedDestination, { recursive: true, errorOnExist: true })
      if (existing) renameSync(destination, backupDestination)
      try {
        renameSync(stagedDestination, destination)
        if (existing) rmSync(backupDestination, { recursive: true, force: true })
      } catch (error) {
        if (lstatSync(backupDestination, { throwIfNoEntry: false }) && !lstatSync(destination, { throwIfNoEntry: false })) {
          renameSync(backupDestination, destination)
        }
        throw error
      } finally {
        rmSync(stagedDestination, { recursive: true, force: true })
      }
    }
    return `installed ${external.source}@${external.ref}`
  } finally {
    if (downloaded?.tempRoot) rmSync(downloaded.tempRoot, { recursive: true, force: true })
  }
}

function relativeLink(fromDirectory, target) {
  const value = relative(fromDirectory, target) || '.'
  return value.split(sep).join('/')
}

function installLocalLinks(rootDir, localSkills, platform) {
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  prepareLinkDirectory(canonicalDir, aiSkillsDir, canonicalDir)
  for (const skill of localSkills) {
    const target = join(aiSkillsDir, skill)
    if (!lstatSync(target, { throwIfNoEntry: false })?.isDirectory()) fail(`local skill folder is missing: ${target}`)
    replaceManagedLink(
      join(canonicalDir, skill),
      target,
      relativeLink(canonicalDir, target),
      platform,
      aiSkillsDir,
      canonicalDir,
    )
  }
  cleanManagedLinks(canonicalDir, aiSkillsDir, canonicalDir, new Set(localSkills))
}

function installedExternalSkills(rootDir, external) {
  const canonicalDir = join(rootDir, '.agents', 'skills')
  return external.skills.filter((skill) => {
    const skillDir = join(canonicalDir, skill)
    return lstatSync(skillDir, { throwIfNoEntry: false })?.isDirectory()
      && hashSkillDirectory(skillDir) === external.contentHashes[skill]
  })
}

function installAgentLinks(rootDir, agent, names, localSkills, legacyLinks, platform) {
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  const harnessDir = join(rootDir, ...AGENT_DIRECTORIES[agent])
  prepareLinkDirectory(harnessDir, aiSkillsDir, canonicalDir)
  for (const skill of names) {
    const localLegacyTarget = legacyLinks && localSkills.includes(skill)
    const target = localLegacyTarget ? join(aiSkillsDir, skill) : join(canonicalDir, skill)
    replaceManagedLink(
      join(harnessDir, skill),
      target,
      relativeLink(harnessDir, target),
      platform,
      aiSkillsDir,
      canonicalDir,
    )
  }
  cleanManagedLinks(harnessDir, aiSkillsDir, canonicalDir, new Set(names))
}

function cleanAllLinks(rootDir) {
  const aiSkillsDir = join(rootDir, '.ai', 'skills')
  const canonicalDir = join(rootDir, '.agents', 'skills')
  for (const agent of KNOWN_AGENTS) cleanManagedLinks(join(rootDir, ...AGENT_DIRECTORIES[agent]), aiSkillsDir, canonicalDir)
  cleanManagedLinks(canonicalDir, aiSkillsDir, canonicalDir)
}

export async function runInstaller({
  rootDir,
  args = [],
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
  fetchImpl = globalThis.fetch,
} = {}) {
  const options = parseArgs(args, env)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const manifest = readManifest(rootDir)
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
  let externalStatus = 'skipped (--no-external)'
  if (!options.noExternal) {
    try {
      externalStatus = await installExternal(rootDir, manifest.external, platform, spawn, fetchImpl)
    } catch (error) {
      externalStatus = `unavailable (${error.message})`
      console.warn(`install-skills: warning: ${error.message}`)
      console.warn('  Local skills will still be installed. Retry with `yarn install-skills` when online.')
    }
  }
  installLocalLinks(rootDir, localSkills, platform)
  const externalInstalled = installedExternalSkills(rootDir, manifest.external)
  const allInstalled = unique([...localSkills, ...externalInstalled])
  const linkAgents = options.legacyLinks ? LEGACY_AGENTS : ['claude-code']
  for (const agent of KNOWN_AGENTS) {
    const harnessDir = join(rootDir, ...AGENT_DIRECTORIES[agent])
    if (ignoredAgents.includes(agent)) {
      continue
    } else if (linkAgents.includes(agent)) {
      installAgentLinks(rootDir, agent, allInstalled, localSkills, options.legacyLinks, platform)
    } else {
      cleanManagedLinks(harnessDir, join(rootDir, '.ai', 'skills'), join(rootDir, '.agents', 'skills'))
    }
  }
  console.log(`Installed ${localSkills.length} local skills across ${tiers.length} tier(s): ${tiers.join(', ')}.`)
  console.log(`External skills: ${externalStatus}.`)
  const links = linkAgents.filter((agent) => !ignoredAgents.includes(agent))
  console.log(`Layout: .agents/skills/ (canonical); per-agent links: ${links.join(', ') || 'none'}.`)
  if (options.mode === 'default') console.log('Tip: inspect opt-in tiers with `yarn install-skills --list`.')
  return 0
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  runInstaller({ rootDir, args: process.argv.slice(2) }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
