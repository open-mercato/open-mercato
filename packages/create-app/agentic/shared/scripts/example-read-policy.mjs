import fs from 'node:fs'
import path from 'node:path'

export const EXAMPLE_READ_POLICY_LIMITS = Object.freeze({
  maxRoots: 8,
  maxEntrypoints: 16,
  maxCapabilityIds: 32,
  rootMaxFiles: 16,
  rootMaxBytes: 262_144,
  fallbackMaxFiles: 4,
  fallbackMaxBytes: 65_536,
})

export const INSTALLED_VERSION_FALLBACK_REASONS = Object.freeze([
  'LOCAL_EXAMPLE_MISSING_VERSIONED_CONTRACT',
])

const FORBIDDEN_SEGMENTS = new Set([
  '.git', '.next', '.cache', '.mercato', '.turbo', 'build', 'coverage', 'dist',
  'generated', 'node_modules', 'test-results',
])
const LOCAL_OPS_PREFIXES = ['.ai/analysis/', '.ai/harness/results/', '.ai/reports/', '.ai/runs/', '.ai/tmp/']
const CAPABILITY_ID = /^[a-z][a-z0-9.-]+$/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasDecodedTraversal(value) {
  let current = value
  for (let depth = 0; depth < 4; depth += 1) {
    let decoded
    try { decoded = decodeURIComponent(current) } catch { return true }
    if (decoded === current) return false
    const slashPath = decoded.replaceAll('\\', '/')
    if (/^[A-Za-z]:\//.test(slashPath) || slashPath.startsWith('/') || slashPath.split('/').includes('..') || /[\0\r\n]/.test(decoded)) return true
    current = decoded
  }
  return current !== value
}

function forbiddenPathReason(normalized) {
  const lower = normalized.toLowerCase()
  const segments = lower.split('/')
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) return 'generated, dependency, cache, or build output is forbidden'
  if (LOCAL_OPS_PREFIXES.some((prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix))) return 'local operations paths are forbidden'
  const basename = segments.at(-1) ?? ''
  if (basename === '.env' || basename.startsWith('.env.') || ['.npmrc', '.yarnrc', 'auth.json', '.credentials.json'].includes(basename)) return 'credential files are forbidden'
  if (/(?:^|[._-])(?:credential|credentials|secret|secrets)(?:[._-]|$)/.test(basename)) return 'credential or secret files are forbidden'
  if (/^(?:id_rsa|id_ed25519)$/.test(basename) || /\.(?:key|pem|p12|pfx)$/.test(basename)) return 'private key files are forbidden'
  if (basename.includes('.local.') || basename === 'docker-compose.override.yml') return 'local operations files are forbidden'
  return null
}

export function normalizeExampleReadPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) throw new Error('example path must be a non-empty bounded string')
  if (/[\0\r\n]/.test(value)) throw new Error('example path contains a control character')
  if (/^[A-Za-z]:/.test(value) || value.startsWith('\\\\') || value.startsWith('//') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw new Error('example path must be relative')
  if (hasDecodedTraversal(value)) throw new Error('example path contains encoded traversal')
  if (/[*?\[\]{}!]/.test(value)) throw new Error('example path must name an exact path, not a glob')
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) throw new Error('example path contains traversal')
  const forbidden = forbiddenPathReason(normalized)
  if (forbidden) throw new Error(forbidden)
  return normalized
}

function isContained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

export function resolveExistingExamplePath(caseRoot, relativePath) {
  if (typeof caseRoot !== 'string' || !path.isAbsolute(caseRoot)) throw new Error('case root must be absolute')
  const normalized = normalizeExampleReadPath(relativePath)
  const realRoot = fs.realpathSync(caseRoot)
  const lexical = path.resolve(realRoot, ...normalized.split('/'))
  if (!isContained(realRoot, lexical)) throw new Error('example path escapes the case root')
  const realPath = fs.realpathSync(lexical)
  if (!isContained(realRoot, realPath)) throw new Error('example path resolves through a symlink outside the case root')
  return { relativePath: normalized, realPath }
}

function validateBudget(label, maxFiles, maxBytes, limits, errors) {
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > limits.maxFiles) errors.push(`${label}.maxFiles must be 1..${limits.maxFiles}`)
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > limits.maxBytes) errors.push(`${label}.maxBytes must be 1..${limits.maxBytes}`)
}

function normalizeInventory(capabilityInventory, errors) {
  const normalized = new Map()
  const entries = Array.isArray(capabilityInventory)
    ? capabilityInventory.map((entry) => [entry?.capabilityId, entry?.paths])
    : isPlainObject(capabilityInventory)
      ? Object.entries(capabilityInventory)
      : null
  if (!entries) {
    errors.push('capability inventory must contain capabilityId/path entries')
    return normalized
  }
  for (const [capabilityId, paths] of entries) {
    if (typeof capabilityId !== 'string') {
      errors.push('capability inventory entry is missing capabilityId')
      continue
    }
    if (normalized.has(capabilityId)) errors.push(`capability inventory ID is duplicated: ${capabilityId}`)
    if (!CAPABILITY_ID.test(capabilityId)) errors.push(`capability inventory ID is invalid: ${capabilityId}`)
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((entry) => typeof entry !== 'string') || new Set(paths).size !== paths.length) {
      errors.push(`capability inventory paths are invalid: ${capabilityId}`)
      continue
    }
    const exactPaths = []
    for (const candidate of paths) {
      try { exactPaths.push(normalizeExampleReadPath(candidate)) } catch (error) { errors.push(`${capabilityId}: ${error.message}`) }
    }
    normalized.set(capabilityId, exactPaths)
  }
  return normalized
}

export function loadExampleReadPolicy(caseRoot, context) {
  if (!Array.isArray(context?.exampleRoots) || context.exampleRoots.length === 0) return null
  const inventoryEntries = []
  for (const root of context.exampleRoots) {
    const normalizedRoot = normalizeExampleReadPath(root.root)
    const inventoryRelative = `${normalizedRoot}/references/surface-inventory.json`
    const inventoryFile = resolveExistingExamplePath(caseRoot, inventoryRelative)
    const inventoryStat = fs.statSync(inventoryFile.realPath)
    if (!inventoryStat.isFile()) throw new Error(`example capability inventory must be a file: ${inventoryRelative}`)
    let parsed
    try { parsed = JSON.parse(fs.readFileSync(inventoryFile.realPath, 'utf8')) } catch { throw new Error(`example capability inventory is invalid JSON: ${inventoryRelative}`) }
    if (!Array.isArray(parsed)) throw new Error(`example capability inventory must be an array: ${inventoryRelative}`)
    inventoryEntries.push(...parsed)
  }
  const validation = validateExampleReadPolicy(context, inventoryEntries, { caseRoot })
  if (!validation.ok) throw new Error(validation.errors.join('; '))
  const inventory = normalizeInventory(inventoryEntries, [])
  return {
    version: 1,
    exampleRoots: validation.policy.exampleRoots.map((root) => {
      const entrypoints = root.entrypoints.map((entrypoint) => `${root.root}/${entrypoint}`)
      const capabilities = []
      for (const capabilityId of root.allowedCapabilityIds) {
        for (const exactPath of inventory.get(capabilityId) ?? []) {
          if (!exactPath.startsWith(`${root.root}/`)) continue
          const resolved = resolveExistingExamplePath(caseRoot, exactPath)
          if (!fs.statSync(resolved.realPath).isFile()) throw new Error(`example capability must resolve to a file: ${exactPath}`)
          capabilities.push({ capabilityId, path: exactPath })
        }
      }
      return {
        root: root.root,
        entrypoints,
        capabilities,
        maxFiles: root.maxFiles,
        maxBytes: root.maxBytes,
      }
    }),
  }
}

export function validateCumulativeExampleBudget(usage, budget) {
  const errors = []
  if (!isPlainObject(usage) || !Number.isInteger(usage.fileCount) || usage.fileCount < 0) errors.push('usage.fileCount must be a non-negative integer')
  if (!isPlainObject(usage) || !Number.isInteger(usage.totalBytes) || usage.totalBytes < 0) errors.push('usage.totalBytes must be a non-negative integer')
  if (!isPlainObject(budget) || !Number.isInteger(budget.maxFiles) || budget.maxFiles < 1) errors.push('budget.maxFiles must be a positive integer')
  if (!isPlainObject(budget) || !Number.isInteger(budget.maxBytes) || budget.maxBytes < 1) errors.push('budget.maxBytes must be a positive integer')
  if (errors.length === 0) {
    if (usage.fileCount > budget.maxFiles) errors.push(`cumulative example file budget exceeded: ${usage.fileCount}/${budget.maxFiles}`)
    if (usage.totalBytes > budget.maxBytes) errors.push(`cumulative example byte budget exceeded: ${usage.totalBytes}/${budget.maxBytes}`)
  }
  return errors
}

export function validateExampleReadPolicy(context, capabilityInventory, options = {}) {
  const errors = []
  const inventory = normalizeInventory(capabilityInventory, errors)
  const exampleRoots = context?.exampleRoots
  const fallback = context?.installedVersionFallback
  if (exampleRoots === undefined && fallback === undefined) return { ok: errors.length === 0, errors, policy: { exampleRoots: [], installedVersionFallback: null } }
  if (!Array.isArray(exampleRoots) || exampleRoots.length === 0 || exampleRoots.length > EXAMPLE_READ_POLICY_LIMITS.maxRoots) {
    errors.push(`context.exampleRoots must contain 1..${EXAMPLE_READ_POLICY_LIMITS.maxRoots} roots`)
  }
  const normalizedRoots = []
  const seenRoots = new Set()
  for (const [index, root] of (Array.isArray(exampleRoots) ? exampleRoots : []).entries()) {
    const label = `context.exampleRoots[${index}]`
    const allowedKeys = ['root', 'entrypoints', 'allowedCapabilityIds', 'maxFiles', 'maxBytes']
    if (!isPlainObject(root) || Object.keys(root).some((key) => !allowedKeys.includes(key))) {
      errors.push(`${label} has an invalid shape`)
      continue
    }
    let normalizedRoot
    try {
      normalizedRoot = normalizeExampleReadPath(root.root)
      if (seenRoots.has(normalizedRoot)) errors.push(`${label}.root is duplicated`)
      seenRoots.add(normalizedRoot)
      if (options.caseRoot) {
        const resolvedRoot = resolveExistingExamplePath(options.caseRoot, normalizedRoot)
        if (!fs.statSync(resolvedRoot.realPath).isDirectory()) errors.push(`${label}.root must resolve to a directory`)
      }
    } catch (error) { errors.push(`${label}.root: ${error.message}`) }
    const entrypoints = root.entrypoints
    if (!Array.isArray(entrypoints) || entrypoints.length === 0 || entrypoints.length > EXAMPLE_READ_POLICY_LIMITS.maxEntrypoints || new Set(entrypoints).size !== entrypoints.length) {
      errors.push(`${label}.entrypoints must contain unique entries`)
    }
    const normalizedEntrypoints = []
    for (const entrypoint of Array.isArray(entrypoints) ? entrypoints : []) {
      try {
        const normalized = normalizeExampleReadPath(entrypoint)
        normalizedEntrypoints.push(normalized)
        if (options.caseRoot && normalizedRoot) {
          const resolved = resolveExistingExamplePath(options.caseRoot, `${normalizedRoot}/${normalized}`)
          if (!fs.statSync(resolved.realPath).isFile()) errors.push(`${label}.entrypoint must resolve to a file: ${entrypoint}`)
        }
      } catch (error) { errors.push(`${label}.entrypoint ${String(entrypoint)}: ${error.message}`) }
    }
    const capabilityIds = root.allowedCapabilityIds
    if (!Array.isArray(capabilityIds) || capabilityIds.length === 0 || capabilityIds.length > EXAMPLE_READ_POLICY_LIMITS.maxCapabilityIds || new Set(capabilityIds).size !== capabilityIds.length) {
      errors.push(`${label}.allowedCapabilityIds must contain unique IDs`)
    }
    for (const capabilityId of Array.isArray(capabilityIds) ? capabilityIds : []) {
      const exactPaths = inventory.get(capabilityId)
      if (!exactPaths) errors.push(`${label} references unknown capability ID ${capabilityId}`)
      else if (normalizedRoot && !exactPaths.some((exactPath) => exactPath.startsWith(`${normalizedRoot}/`))) errors.push(`${label} capability ${capabilityId} has no exact path under its root`)
    }
    validateBudget(label, root.maxFiles, root.maxBytes, { maxFiles: EXAMPLE_READ_POLICY_LIMITS.rootMaxFiles, maxBytes: EXAMPLE_READ_POLICY_LIMITS.rootMaxBytes }, errors)
    if (normalizedRoot) normalizedRoots.push({ ...root, root: normalizedRoot, entrypoints: normalizedEntrypoints })
  }
  let normalizedFallback = null
  if (fallback !== undefined) {
    const allowedKeys = ['allowed', 'reasonCodes', 'maxFiles', 'maxBytes']
    if (!isPlainObject(fallback) || Object.keys(fallback).some((key) => !allowedKeys.includes(key))) errors.push('context.installedVersionFallback has an invalid shape')
    else {
      if (fallback.allowed !== true) errors.push('context.installedVersionFallback.allowed must be true')
      if (!Array.isArray(fallback.reasonCodes) || fallback.reasonCodes.length === 0 || new Set(fallback.reasonCodes).size !== fallback.reasonCodes.length) errors.push('context.installedVersionFallback.reasonCodes must contain unique values')
      else for (const reason of fallback.reasonCodes) if (!INSTALLED_VERSION_FALLBACK_REASONS.includes(reason)) errors.push(`unknown installed-version fallback reason: ${reason}`)
      validateBudget('context.installedVersionFallback', fallback.maxFiles, fallback.maxBytes, { maxFiles: EXAMPLE_READ_POLICY_LIMITS.fallbackMaxFiles, maxBytes: EXAMPLE_READ_POLICY_LIMITS.fallbackMaxBytes }, errors)
      normalizedFallback = { ...fallback }
    }
  }
  return { ok: errors.length === 0, errors, policy: { exampleRoots: normalizedRoots, installedVersionFallback: normalizedFallback } }
}
