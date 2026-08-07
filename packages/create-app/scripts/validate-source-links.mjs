#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2

// Deliberately NOT under `agentic/shared/**`: the scaffolder copies that whole tree into
// every generated app (`copyTree(AGENTIC_DIR/ai → .ai)` / `.../scripts → scripts`), and these
// assets are monorepo-only — the baseline pins monorepo SHAs and validates monorepo files.
// Shipping them added ~148KB of dead weight to every scaffold.
export const HARNESS_RELATIVE_DIR = 'packages/create-app/scripts/source-links'
export const BASELINE_RELATIVE_PATH = `${HARNESS_RELATIVE_DIR}/source-link-baseline.json`
export const TOPICS_RELATIVE_PATH = `${HARNESS_RELATIVE_DIR}/source-link-topics.json`

export const DISPOSITIONS = Object.freeze([
  'linked',
  'retained-normative-snippet',
  'superseded-with-current-rule-and-source',
  'not-implementation',
])

export const REQUIREMENT_CLASSES = Object.freeze([
  'source-required',
  'self-authoritative',
  'generated-fact',
  'retained-normative-snippet',
])

const DISPOSITIONS_REQUIRING_TARGETS = Object.freeze([
  'linked',
  'superseded-with-current-rule-and-source',
])

const DISPOSITIONS_REQUIRING_RATIONALE = Object.freeze([
  'retained-normative-snippet',
  'superseded-with-current-rule-and-source',
  'not-implementation',
])

const SHA1_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const BLOCK_ID_PATTERN = /^main:(.+)#fence:(\d+)$/

/**
 * Parse every CommonMark fenced code block in `text`.
 *
 * Implements the subset of the CommonMark fenced-code-block rules that the pinned
 * baseline assets exercise: backtick or tilde fences of three or more characters,
 * an opening indent of up to three spaces, a backtick info string that may not
 * contain a backtick, and a closing fence that uses the same character, is at
 * least as long as the opening fence, and carries nothing but whitespace after it.
 * A fence character that differs from the open fence is content, so a backtick
 * fence nested inside a tilde block is never mistaken for a block of its own.
 */
export function parseFences(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let open = null
  let heading = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (open === null) {
      const atx = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
      if (atx) {
        heading = atx[2]
        continue
      }
      if (!fence) continue
      const info = fence[3]
      if (fence[2][0] === '`' && info.includes('`')) continue
      open = {
        fenceChar: fence[2][0],
        fenceLength: fence[2].length,
        indent: fence[1].length,
        openingLine: line,
        info: info.trim(),
        heading,
        startLine: index + 1,
        contentLines: [],
      }
      continue
    }
    if (
      fence
      && fence[2][0] === open.fenceChar
      && fence[2].length >= open.fenceLength
      && fence[3].trim() === ''
    ) {
      blocks.push(finalizeBlock(open, index + 1, false))
      open = null
      continue
    }
    open.contentLines.push(line)
  }
  if (open !== null) blocks.push(finalizeBlock(open, lines.length, true))
  return blocks.map((block, position) => ({ ...block, ordinal: position + 1 }))
}

function finalizeBlock(open, endLine, unclosed) {
  const content = open.contentLines.join('\n')
  return {
    heading: open.heading,
    openingLine: open.openingLine,
    info: open.info,
    startLine: open.startLine,
    endLine,
    unclosed,
    contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
  }
}

export function blockId(asset, ordinal) {
  return `main:${asset}#fence:${ordinal}`
}

const fetchedPinnedCommits = new Set()

/**
 * Make the pinned baseline commit readable, fetching it once when the local
 * object store does not have it.
 *
 * CI checks out with `actions/checkout`'s default `fetch-depth: 1`, so the
 * clone holds exactly one commit and every `git cat-file blob <pinned>:<path>`
 * fails — with git's "exists on disk, but not in <rev>" message, which reads
 * like a stale pin rather than a missing object. A full clone (any ordinary
 * developer checkout) already has the commit and never reaches the fetch.
 */
function ensurePinnedCommit(root, sha) {
  const runGit = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  try {
    runGit(['cat-file', '-e', `${sha}^{commit}`])
    return
  } catch {
    // Not in the object store yet — fall through to the fetch.
  }
  if (fetchedPinnedCommits.has(sha)) {
    throw new Error(
      `Pinned baseline commit ${sha} is not available in this checkout and could not be fetched from origin.`,
    )
  }
  fetchedPinnedCommits.add(sha)
  try {
    runGit(['fetch', '--no-tags', '--depth=1', 'origin', sha])
  } catch (error) {
    throw new Error(
      `Pinned baseline commit ${sha} is missing from this checkout (a shallow clone does not carry it) and `
        + `fetching it from origin failed. Run \`git fetch --no-tags --depth=1 origin ${sha}\` and retry. `
        + `Cause: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function readPinnedBlob(root, sha, relativePath) {
  ensurePinnedCommit(root, sha)
  return execFileSync('git', ['cat-file', 'blob', `${sha}:${relativePath}`], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  })
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
}

// Directories the template copier drops on its way into a scaffolded app (index.ts SKIP_DIRS).
const NON_EMITTED_TREE_SEGMENTS = new Set(['__tests__', '__integration__'])
// Emitted paths produced at generation time from installed packages, absent from this repository.
const GENERATED_EMITTED_PREFIXES = ['.ai/guides/modules/', '.ai/guides/upstream/', '.ai/framework-context/', '.mercato/']

/** Where an emitted app-relative path is authored inside `packages/create-app`. */
export function authoringPathOfEmittedPath(appRelativePath) {
  if (appRelativePath === 'AGENTS.md') return 'agentic/shared/AGENTS.md.template'
  if (appRelativePath.startsWith('.ai/guides/')) return `agentic/guides/${appRelativePath.slice('.ai/guides/'.length)}`
  if (appRelativePath.startsWith('.ai/')) return `agentic/shared/ai/${appRelativePath.slice('.ai/'.length)}`
  if (appRelativePath.startsWith('src/')) return `template/${appRelativePath}`
  return null
}

/** Every emitted Markdown knowledge owner, as its app-relative path. */
export function emittedMarkdownOwners(packageRoot) {
  const owners = ['AGENTS.md']
  const walk = (absoluteDir, emittedPrefix) => {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const absolute = path.join(absoluteDir, entry.name)
      const emitted = `${emittedPrefix}${entry.name}`
      if (entry.isDirectory()) walk(absolute, `${emitted}/`)
      else if (entry.name.endsWith('.md')) owners.push(emitted)
    }
  }
  walk(path.join(packageRoot, 'agentic/guides'), '.ai/guides/')
  walk(path.join(packageRoot, 'agentic/shared/ai/skills'), '.ai/skills/')
  return owners.sort()
}

/** Raw relative Markdown link destinations in `source`; anchors and external schemes dropped. */
export function relativeMarkdownLinkHrefs(source) {
  const hrefs = []
  for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
    const raw = match[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#') || raw.startsWith('/')) continue
    hrefs.push(raw)
  }
  return hrefs
}

/** The owner slug half of a derived topic ID. */
export function ownerSlug(owner) {
  if (owner === 'AGENTS.md') return 'root'
  if (owner.startsWith('.ai/guides/')) return `guides/${owner.slice('.ai/guides/'.length, -'.md'.length)}`
  const match = /^\.ai\/skills\/([^/]+)\/(?:references\/)?(.+)\.md$/.exec(owner)
  if (!match) return null
  return match[2] === 'SKILL' ? match[1] : `${match[1]}/${match[2]}`
}

const EXAMPLE_ROOT = 'src/modules/example/'

/** A source-required topic ID is derived from its owner and its resolved target, never authored. */
export function deriveTopicId(owner, resolvedPath) {
  const slug = ownerSlug(owner)
  if (slug === null) return null
  const key = resolvedPath.startsWith(EXAMPLE_ROOT) ? resolvedPath.slice(EXAMPLE_ROOT.length) : resolvedPath
  return `${slug}:${key}`
}

/**
 * Validate the topic registry that `targetTopicIds` and `topicIds` resolve against.
 *
 * The registry is a checked contract rather than a second authority: every
 * `source-required` topic is one rendered exact-file link in one emitted owner, and the
 * registry must cover those links in both directions, so the derived source-link
 * inventory can later assert that its topic set equals this one exactly.
 */
export function validateTopicRegistry({ registry, packageRoot }) {
  const errors = []
  if (!isPlainObject(registry)) return { errors: ['topic registry must be a JSON object'], topics: new Map() }
  if (!Array.isArray(registry.topics) || registry.topics.length === 0) {
    return { errors: ['topic registry must declare a non-empty "topics" array'], topics: new Map() }
  }

  const ownerSources = new Map()
  const readOwner = (owner) => {
    if (ownerSources.has(owner)) return ownerSources.get(owner)
    const authoring = authoringPathOfEmittedPath(owner)
    let source = null
    if (authoring !== null) {
      const absolute = path.join(packageRoot, authoring)
      try {
        if (fs.statSync(absolute).isFile()) source = fs.readFileSync(absolute, 'utf8')
      } catch { source = null }
    }
    ownerSources.set(owner, source)
    return source
  }

  const topics = new Map()
  const declaredLinks = new Set()
  for (const topic of registry.topics) {
    if (!isPlainObject(topic)) {
      errors.push('every topic record must be an object')
      continue
    }
    const { topicId, owner, requirement, href, evidence } = topic
    if (typeof topicId !== 'string' || topicId.length === 0) {
      errors.push('every topic record must declare a non-empty topicId')
      continue
    }
    if (topics.has(topicId)) errors.push(`duplicate topicId "${topicId}"`)
    if (!REQUIREMENT_CLASSES.includes(requirement)) {
      errors.push(`topic "${topicId}" has invalid requirement "${String(requirement)}"`)
    }
    topics.set(topicId, topic)

    if (typeof owner !== 'string' || owner.length === 0) {
      errors.push(`topic "${topicId}" must declare a non-empty owner`)
      continue
    }
    const source = readOwner(owner)
    if (source === null) {
      errors.push(`topic "${topicId}" declares owner "${owner}", which is not an emitted Markdown owner in this repository`)
      continue
    }

    if (requirement !== 'source-required') {
      if (href !== undefined) errors.push(`topic "${topicId}" is ${requirement} and must not declare an href`)
      if (typeof evidence !== 'string' || evidence.length === 0) {
        errors.push(`topic "${topicId}" is ${requirement} and must declare the literal evidence its owner retains`)
      } else if (!source.includes(evidence)) {
        errors.push(`topic "${topicId}" declares evidence its owner "${owner}" no longer contains: ${JSON.stringify(evidence)}`)
      }
      continue
    }

    if (typeof href !== 'string' || href.length === 0) {
      errors.push(`source-required topic "${topicId}" must declare the exact href its owner renders`)
      continue
    }
    if (evidence !== undefined) errors.push(`topic "${topicId}" is source-required and must not declare evidence`)
    if (!source.includes(`](${href})`)) {
      errors.push(`source-required topic "${topicId}" declares href "${href}", which owner "${owner}" does not render`)
      continue
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(owner), decodeURIComponent(href.split('#')[0])))
    if (topic.resolvedPath !== resolved) {
      errors.push(`topic "${topicId}" records resolvedPath "${String(topic.resolvedPath)}", not "${resolved}"`)
    }
    const derived = deriveTopicId(owner, resolved)
    if (derived !== topicId) {
      errors.push(`topic "${topicId}" does not match its derived ID "${String(derived)}"`)
    }
    for (const error of targetResolutionErrors(packageRoot, owner, href, resolved)) errors.push(`topic "${topicId}": ${error}`)
    declaredLinks.add(`${owner} ${resolved}`)
  }

  for (const owner of emittedMarkdownOwners(packageRoot)) {
    const source = readOwner(owner)
    if (source === null) continue
    for (const href of relativeMarkdownLinkHrefs(source)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(owner), decodeURIComponent(href.split('#')[0])))
      if (!declaredLinks.has(`${owner} ${resolved}`)) {
        errors.push(`owner "${owner}" renders an undeclared source link to "${resolved}"`)
      }
    }
  }

  return { errors, topics }
}

function targetResolutionErrors(packageRoot, owner, href, resolved) {
  const errors = []
  if (resolved.startsWith('..')) return [`link "${href}" escapes the generated app root`]
  for (const prefix of GENERATED_EMITTED_PREFIXES) {
    if (resolved.startsWith(prefix)) return [`link "${href}" hard-links into generation-time output`]
  }
  if (resolved.split('/').some((segment) => NON_EMITTED_TREE_SEGMENTS.has(segment))) {
    return [`link "${href}" targets a path the scaffolder never copies into a generated app`]
  }
  const authoring = authoringPathOfEmittedPath(resolved)
  if (authoring === null) return [`link "${href}" resolves to an unrecognized app path "${resolved}"`]
  const absolute = path.join(packageRoot, authoring)
  try {
    if (!fs.statSync(absolute).isFile()) errors.push(`link "${href}" resolves to "${resolved}", which is not a regular file`)
  } catch {
    errors.push(`link "${href}" resolves to "${resolved}", which a generated app does not contain`)
  }
  return errors
}

export function validateBaseline({ baseline, registry, loadAsset, packageRoot }) {
  if (!isPlainObject(baseline)) return { ok: false, errors: ['baseline must be a JSON object'], derived: null }

  const registryResult = validateTopicRegistry({ registry, packageRoot })
  const errors = registryResult.errors.map((message) => `topics: ${message}`)
  const knownTopics = registryResult.topics

  if (typeof baseline.baselineSha !== 'string' || !SHA1_PATTERN.test(baseline.baselineSha)) {
    errors.push('baselineSha must be an exact 40-hex commit SHA')
  }
  if (!Array.isArray(baseline.baselineAssets) || baseline.baselineAssets.length === 0) {
    return { ok: false, errors: [...errors, 'baselineAssets must be a non-empty array'], derived: null }
  }
  if (!Array.isArray(baseline.blocks)) {
    return { ok: false, errors: [...errors, 'blocks must be an array'], derived: null }
  }

  const expectedByAsset = new Map()
  for (const asset of baseline.baselineAssets) {
    if (!isPlainObject(asset) || typeof asset.path !== 'string' || asset.path.length === 0) {
      errors.push('every baselineAssets record must declare a non-empty path')
      continue
    }
    if (expectedByAsset.has(asset.path)) errors.push(`duplicate baseline asset "${asset.path}"`)
    if (typeof asset.sha256 !== 'string' || !SHA256_PATTERN.test(asset.sha256)) {
      errors.push(`asset "${asset.path}" must declare a 64-hex sha256`)
    }
    if (!Number.isInteger(asset.expectedFenceCount) || asset.expectedFenceCount < 0) {
      errors.push(`asset "${asset.path}" must declare a non-negative integer expectedFenceCount`)
    }
    expectedByAsset.set(asset.path, asset)
  }

  const observed = new Map()
  let derivedFenceTotal = 0
  for (const asset of expectedByAsset.values()) {
    let blob
    try {
      blob = loadAsset(asset.path)
    } catch (error) {
      errors.push(`asset "${asset.path}" could not be read at ${baseline.baselineSha}: ${error.message}`)
      continue
    }
    const actualSha = sha256(blob)
    if (actualSha !== asset.sha256) {
      errors.push(`asset "${asset.path}" hashes ${actualSha} at ${baseline.baselineSha}, not the pinned ${asset.sha256}`)
      continue
    }
    const fences = parseFences(blob.toString('utf8'))
    if (fences.length !== asset.expectedFenceCount) {
      errors.push(`asset "${asset.path}" parses ${fences.length} fences, not the pinned ${asset.expectedFenceCount}`)
    }
    derivedFenceTotal += fences.length
    observed.set(asset.path, fences)
  }

  const seenIds = new Set()
  const claimedByAsset = new Map()
  for (const record of baseline.blocks) {
    if (!isPlainObject(record)) {
      errors.push('every block record must be an object')
      continue
    }
    const { id, asset, ordinal, disposition } = record
    if (typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id)) {
      errors.push(`block id "${String(id)}" must match main:<asset>#fence:<ordinal>`)
      continue
    }
    if (seenIds.has(id)) errors.push(`duplicate block id "${id}"`)
    seenIds.add(id)
    if (typeof asset !== 'string' || !expectedByAsset.has(asset)) {
      errors.push(`block "${id}" names asset "${String(asset)}" which is not a pinned baseline asset`)
      continue
    }
    if (id !== blockId(asset, ordinal)) {
      errors.push(`block "${id}" does not match its own asset/ordinal pair`)
      continue
    }
    const claimed = claimedByAsset.get(asset) ?? new Set()
    if (claimed.has(ordinal)) errors.push(`asset "${asset}" has more than one record for fence ${ordinal}`)
    claimed.add(ordinal)
    claimedByAsset.set(asset, claimed)

    const fences = observed.get(asset)
    if (!fences) continue
    const fence = fences[ordinal - 1]
    if (!fence) {
      errors.push(`block "${id}" has no matching fence in the pinned asset`)
      continue
    }
    if (record.openingLine !== fence.openingLine) {
      errors.push(`block "${id}" records opening line ${JSON.stringify(record.openingLine)}, not ${JSON.stringify(fence.openingLine)}`)
    }
    if ((record.info ?? '') !== fence.info) {
      errors.push(`block "${id}" records info string ${JSON.stringify(record.info ?? '')}, not ${JSON.stringify(fence.info)}`)
    }
    if (record.heading !== (fence.heading ?? null)) {
      errors.push(`block "${id}" records heading ${JSON.stringify(record.heading)}, not ${JSON.stringify(fence.heading ?? null)}`)
    }
    if (record.contentSha256 !== fence.contentSha256) {
      errors.push(`block "${id}" records content hash ${String(record.contentSha256)}, not ${fence.contentSha256}`)
    }

    if (!DISPOSITIONS.includes(disposition)) {
      errors.push(`block "${id}" has invalid disposition "${String(disposition)}"`)
      continue
    }
    if (disposition === 'not-implementation') {
      if (!Array.isArray(record.topicIds) || record.topicIds.length !== 0) {
        errors.push(`block "${id}" is not-implementation and must carry an empty topicIds array`)
      }
    } else if (!isNonEmptyStringArray(record.topicIds)) {
      errors.push(`block "${id}" must carry a non-empty topicIds array`)
    }
    for (const topicId of Array.isArray(record.topicIds) ? record.topicIds : []) {
      if (!knownTopics.has(topicId)) errors.push(`block "${id}" cites unresolved topic "${topicId}"`)
    }
    if (DISPOSITIONS_REQUIRING_TARGETS.includes(disposition)) {
      if (!isNonEmptyStringArray(record.targetTopicIds)) {
        errors.push(`block "${id}" is ${disposition} and must carry a non-empty targetTopicIds array`)
      } else {
        for (const topicId of record.targetTopicIds) {
          if (!knownTopics.has(topicId)) errors.push(`block "${id}" cites unresolved target topic "${topicId}"`)
          else if (knownTopics.get(topicId).requirement !== 'source-required') {
            errors.push(`block "${id}" targets topic "${topicId}" whose requirement is not source-required`)
          }
        }
      }
    } else if (record.targetTopicIds !== undefined && record.targetTopicIds.length !== 0) {
      errors.push(`block "${id}" is ${disposition} and must not carry targetTopicIds`)
    }
    if (DISPOSITIONS_REQUIRING_RATIONALE.includes(disposition)) {
      if (typeof record.rationale !== 'string' || record.rationale.trim().length === 0) {
        errors.push(`block "${id}" is ${disposition} and must carry a non-empty rationale`)
      }
    }
  }

  for (const [assetPath, fences] of observed) {
    const claimed = claimedByAsset.get(assetPath) ?? new Set()
    for (let ordinal = 1; ordinal <= fences.length; ordinal += 1) {
      if (!claimed.has(ordinal)) errors.push(`asset "${assetPath}" fence ${ordinal} has no block record`)
    }
  }

  const expectedTotal = baseline.baselineAssets.reduce(
    (total, asset) => total + (Number.isInteger(asset?.expectedFenceCount) ? asset.expectedFenceCount : 0),
    0,
  )
  if (baseline.blocks.length !== expectedTotal) {
    errors.push(`baseline declares ${baseline.blocks.length} block records for ${expectedTotal} pinned fences`)
  }

  return {
    ok: errors.length === 0,
    errors,
    derived: {
      assetCount: expectedByAsset.size,
      expectedFenceTotal: expectedTotal,
      parsedFenceTotal: derivedFenceTotal,
      blockCount: baseline.blocks.length,
      topicCount: knownTopics.size,
    },
  }
}

function repoRoot(startDir) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: startDir, encoding: 'utf8' }).trim()
}

export function main(argv = process.argv.slice(2)) {
  let root
  try {
    root = argv.includes('--root')
      ? path.resolve(argv[argv.indexOf('--root') + 1])
      : repoRoot(fileURLToPath(new URL('.', import.meta.url)))
  } catch (error) {
    console.error(`source-links: cannot resolve repository root: ${error.message}`)
    return EXIT_INVALID
  }

  let baseline
  let registry
  try {
    baseline = JSON.parse(fs.readFileSync(path.join(root, BASELINE_RELATIVE_PATH), 'utf8'))
    registry = JSON.parse(fs.readFileSync(path.join(root, TOPICS_RELATIVE_PATH), 'utf8'))
  } catch (error) {
    console.error(`source-links: cannot load checked assets: ${error.message}`)
    return EXIT_INVALID
  }

  const result = validateBaseline({
    baseline,
    registry,
    packageRoot: path.join(root, 'packages', 'create-app'),
    loadAsset: (relativePath) => readPinnedBlob(root, baseline.baselineSha, relativePath),
  })

  for (const error of result.errors) console.error(`source-links: ${error}`)
  if (result.derived) {
    console.log(
      `${result.ok ? 'PASS' : 'FAIL'} source-links — ${result.derived.assetCount} pinned assets, `
      + `${result.derived.blockCount}/${result.derived.expectedFenceTotal} dispositions, `
      + `${result.derived.topicCount} topics`,
    )
  } else {
    console.log('FAIL source-links')
  }
  return result.ok ? EXIT_PASS : EXIT_FAILURE
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main()
}
