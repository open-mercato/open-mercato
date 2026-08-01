#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  EXAMPLE_READ_POLICY_LIMITS,
  INSTALLED_VERSION_FALLBACK_REASONS,
  normalizeExampleReadPath,
} from './example-read-policy.mjs'

const MAX_READ_BYTES = 256 * 1024
const MAX_WRITE_BYTES = 256 * 1024
const SAFE_TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.graphql', '.html', '.js', '.json', '.jsx', '.md', '.mdx',
  '.mjs', '.prisma', '.sql', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])
const FORBIDDEN_SEGMENTS = new Set([
  '.git', '.docker', '.kube', '.aws', '.ssh', '.codex', '.claude', '.next',
  '.cache', '.mercato', '.turbo', 'build', 'coverage', 'dist', 'generated', 'test-results',
])
const FORBIDDEN_BASENAMES = new Set([
  '.npmrc', '.netrc', '.pypirc', '.git-credentials', 'secrets.json', 'credentials.json',
  'service-account-credentials.json',
])
const FORBIDDEN_SECRET_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx'])

function fail(message) {
  process.stderr.write(`agent-harness-tool-server: ${message}\n`)
  process.exit(2)
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function isInstalledSourcePath(value, allowPatterns) {
  const normalized = value.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (segments.length < 5 || segments[0] !== 'node_modules' || segments[1] !== '@open-mercato' || segments[3] !== 'src') return false
  if (!segments[2] || segments.slice(4).some((entry) => !entry)) return false
  return allowPatterns || !normalized.includes('*') && !normalized.includes('?')
}

function safeRelative(value, { allowInstalledSourcePatterns = false } = {}) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)) return false
  const normalized = value.replaceAll('\\', '/')
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return false
  const segments = normalized.split('/')
  const basename = segments.at(-1) ?? ''
  const installedSource = segments.includes('node_modules')
  if (installedSource && !isInstalledSourcePath(normalized, allowInstalledSourcePatterns)) return false
  if ((installedSource ? segments.slice(4) : segments).some((entry) => FORBIDDEN_SEGMENTS.has(entry))) return false
  if (normalized === '.ai/harness' || normalized.startsWith('.ai/harness/')) return false
  if (basename === '.env' || basename.startsWith('.env.') || FORBIDDEN_BASENAMES.has(basename)) return false
  if (/(?:^|[._-])(?:credential|credentials|secret|secrets)(?:[._-]|$)/.test(basename)) return false
  return !FORBIDDEN_SECRET_EXTENSIONS.has(path.extname(basename).toLowerCase())
}

function globToRegExp(pattern) {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') { source += '.*'; index += 1 }
    else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

const rootArg = process.argv[2]
const mode = process.argv[3]
let allowedReads
let allowedWrites
let exampleReadPolicy
try { allowedReads = JSON.parse(process.argv[4] ?? '[]') } catch { fail('allowed read set is invalid JSON') }
try { allowedWrites = JSON.parse(process.argv[5] ?? '[]') } catch { fail('allowed write set is invalid JSON') }
try { exampleReadPolicy = process.argv[6] ? JSON.parse(process.argv[6]) : null } catch { fail('example read policy is invalid JSON') }
if (!path.isAbsolute(rootArg ?? '')) fail('root must be absolute')
if (!['read-only', 'writable'].includes(mode)) fail('mode must be read-only or writable')
if (!Array.isArray(allowedReads) || allowedReads.some((entry) => !safeRelative(entry, { allowInstalledSourcePatterns: true }) || ['*', '**'].includes(entry))) fail('allowed read set is invalid')
if (!Array.isArray(allowedWrites) || allowedWrites.some((entry) => !safeRelative(entry))) fail('allowed write set is invalid')
const root = fs.realpathSync(rootArg)
const readMatchers = allowedReads.map(globToRegExp)
const writeMatchers = allowedWrites.map(globToRegExp)

function prepareExampleReadPolicy(policy) {
  if (policy === null) return []
  if (!policy || policy.version !== 1 || !Array.isArray(policy.exampleRoots)) fail('example read policy has an invalid shape')
  return policy.exampleRoots.map((entry) => {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.entrypoints) || !Array.isArray(entry.capabilities)
      || !Number.isInteger(entry.maxFiles) || entry.maxFiles < 1 || !Number.isInteger(entry.maxBytes) || entry.maxBytes < 1) {
      fail('example read policy root has an invalid shape')
    }
    let normalizedRoot
    try { normalizedRoot = normalizeExampleReadPath(entry.root) } catch (error) { fail(`example read policy root is unsafe: ${error.message}`) }
    const entrypoints = new Set()
    const capabilities = new Map()
    for (const candidate of entry.entrypoints) {
      let normalized
      try { normalized = normalizeExampleReadPath(candidate) } catch (error) { fail(`example entrypoint is unsafe: ${error.message}`) }
      if (!normalized.startsWith(`${normalizedRoot}/`)) fail('example entrypoint is outside its root')
      entrypoints.add(normalized)
    }
    for (const capability of entry.capabilities) {
      if (!capability || typeof capability.capabilityId !== 'string') fail('example capability has an invalid shape')
      let normalized
      try { normalized = normalizeExampleReadPath(capability.path) } catch (error) { fail(`example capability path is unsafe: ${error.message}`) }
      if (!normalized.startsWith(`${normalizedRoot}/`) || entrypoints.has(normalized) || capabilities.has(normalized)) fail('example capability path is invalid or duplicated')
      capabilities.set(normalized, capability.capabilityId)
    }
    return {
      root: normalizedRoot,
      entrypoints,
      capabilities,
      maxFiles: entry.maxFiles,
      maxBytes: entry.maxBytes,
      entrypointRead: false,
      distinctPaths: new Set(),
      totalBytes: 0,
    }
  })
}

const exampleRoots = prepareExampleReadPolicy(exampleReadPolicy)
const fallbackPolicy = exampleReadPolicy?.installedVersionFallback ?? null
if (fallbackPolicy && (fallbackPolicy.allowed !== true
  || !Array.isArray(fallbackPolicy.reasonCodes) || fallbackPolicy.reasonCodes.length === 0
  || new Set(fallbackPolicy.reasonCodes).size !== fallbackPolicy.reasonCodes.length
  || fallbackPolicy.reasonCodes.some((reason) => typeof reason !== 'string')
  || fallbackPolicy.reasonCodes.some((reason) => !INSTALLED_VERSION_FALLBACK_REASONS.includes(reason))
  || !Number.isInteger(fallbackPolicy.maxFiles) || fallbackPolicy.maxFiles < 1 || fallbackPolicy.maxFiles > EXAMPLE_READ_POLICY_LIMITS.fallbackMaxFiles
  || !Number.isInteger(fallbackPolicy.maxBytes) || fallbackPolicy.maxBytes < 1 || fallbackPolicy.maxBytes > EXAMPLE_READ_POLICY_LIMITS.fallbackMaxBytes)) {
  fail('installed-version fallback policy has an invalid shape')
}
const fallbackState = fallbackPolicy ? {
  reason: null,
  distinctPaths: new Set(),
  totalBytes: 0,
} : null

function authorizeExampleRead(normalized, stat) {
  const exampleRoot = exampleRoots.find((entry) => normalized.startsWith(`${entry.root}/`))
  if (!exampleRoot) return () => {}
  const isEntrypoint = exampleRoot.entrypoints.has(normalized)
  const capabilityId = exampleRoot.capabilities.get(normalized)
  if (!isEntrypoint && !capabilityId) throw new Error('path is not an allowed example capability file')
  if (!isEntrypoint && !exampleRoot.entrypointRead) throw new Error('read a declared example entrypoint before capability files')
  let nextBytes = exampleRoot.totalBytes
  if (!exampleRoot.distinctPaths.has(normalized)) {
    const nextFiles = exampleRoot.distinctPaths.size + 1
    nextBytes += stat.size
    if (nextFiles > exampleRoot.maxFiles) throw new Error(`cumulative example file budget exceeded: ${nextFiles}/${exampleRoot.maxFiles}`)
    if (nextBytes > exampleRoot.maxBytes) throw new Error(`cumulative example byte budget exceeded: ${nextBytes}/${exampleRoot.maxBytes}`)
  }
  return () => {
    if (!exampleRoot.distinctPaths.has(normalized)) {
      exampleRoot.distinctPaths.add(normalized)
      exampleRoot.totalBytes = nextBytes
    }
    if (isEntrypoint) exampleRoot.entrypointRead = true
  }
}

function authorizeInstalledFallback(normalized, stat, fallbackReason) {
  if (!fallbackPolicy || !fallbackState) {
    if (fallbackReason !== undefined) throw new Error('installed-version fallback is not allowed for this case')
    return () => {}
  }
  if (!isInstalledSourcePath(normalized, false)) {
    if (fallbackReason !== undefined) throw new Error('installed-version fallback reason is valid only for protected package source reads')
    return () => {}
  }
  if (!exampleRoots.some((entry) => entry.entrypointRead)) throw new Error('inspect a declared local example entrypoint before installed-version fallback')
  if (fallbackState.reason === null) {
    if (typeof fallbackReason !== 'string') throw new Error('the first installed-version fallback read requires an allowed reason code')
    if (!fallbackPolicy.reasonCodes.includes(fallbackReason)) throw new Error(`installed-version fallback reason is not allowed: ${fallbackReason}`)
  } else if (fallbackReason !== undefined && fallbackReason !== fallbackState.reason) {
    throw new Error(`installed-version fallback reason does not match the active reason: ${fallbackReason}`)
  }
  let nextBytes = fallbackState.totalBytes
  if (!fallbackState.distinctPaths.has(normalized)) {
    const nextFiles = fallbackState.distinctPaths.size + 1
    nextBytes += stat.size
    if (nextFiles > fallbackPolicy.maxFiles) throw new Error(`cumulative installed-version fallback file budget exceeded: ${nextFiles}/${fallbackPolicy.maxFiles}`)
    if (nextBytes > fallbackPolicy.maxBytes) throw new Error(`cumulative installed-version fallback byte budget exceeded: ${nextBytes}/${fallbackPolicy.maxBytes}`)
  }
  return () => {
    if (fallbackState.reason === null) fallbackState.reason = fallbackReason
    if (!fallbackState.distinctPaths.has(normalized)) {
      fallbackState.distinctPaths.add(normalized)
      fallbackState.totalBytes = nextBytes
    }
  }
}

function resolveRead(relative, fallbackReason) {
  if (!safeRelative(relative)) throw new Error('path is outside the allowed app context')
  const normalized = relative.replaceAll('\\', '/')
  if (!readMatchers.some((matcher) => matcher.test(normalized))) throw new Error('path is outside the case read allowlist')
  const lexical = path.resolve(root, relative)
  if (!isInside(root, lexical)) throw new Error('path escapes the app root')
  const real = fs.realpathSync(lexical)
  if (isInstalledSourcePath(normalized, false)) {
    const dependencyRoot = fs.realpathSync(path.join(root, 'node_modules'))
    if (!isInside(dependencyRoot, real)) throw new Error('installed source resolves outside the protected dependency root')
  } else if (!isInside(root, real)) throw new Error('path resolves outside the app root')
  const stat = fs.statSync(real)
  if (!stat.isFile() || stat.size > MAX_READ_BYTES) throw new Error('path must be a bounded regular file')
  if (!SAFE_TEXT_EXTENSIONS.has(path.extname(real).toLowerCase()) && path.basename(real) !== 'AGENTS.md') throw new Error('path is not an allowed text file')
  const commitExampleRead = authorizeExampleRead(normalized, stat)
  const commitInstalledFallback = authorizeInstalledFallback(normalized, stat, fallbackReason)
  return { real, stat, commitExampleRead, commitInstalledFallback }
}

function resolveWrite(relative) {
  if (mode !== 'writable') throw new Error('writes are disabled for this evaluation')
  if (!safeRelative(relative) || !writeMatchers.some((matcher) => matcher.test(relative.replaceAll('\\', '/')))) throw new Error('path is outside the case write allowlist')
  const lexical = path.resolve(root, relative)
  if (!isInside(root, lexical)) throw new Error('path escapes the app root')
  let cursor = path.dirname(lexical)
  const missing = []
  while (cursor !== root && !fs.existsSync(cursor)) { missing.push(cursor); cursor = path.dirname(cursor) }
  if (!isInside(root, cursor)) throw new Error('write ancestor escapes the app root')
  for (let current = cursor; current !== root; current = path.dirname(current)) {
    const stat = fs.lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('write ancestor must be a regular directory')
  }
  if (fs.existsSync(lexical)) {
    const stat = fs.lstatSync(lexical)
    if (!stat.isFile() || stat.isSymbolicLink() || !isInside(root, fs.realpathSync(lexical))) throw new Error('write target must be a contained regular file')
  }
  for (const directory of missing.reverse()) fs.mkdirSync(directory, { mode: 0o700 })
  return lexical
}

const tools = [
  {
    name: 'read',
    description: 'Read one exact app-relative instruction, fact, source, or allowed target file. Fact-linked @open-mercato package source reads are allowed; absolute paths, discovery, credentials, dependency writes, Git, and harness internals are rejected.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string' },
        ...(fallbackPolicy ? { fallbackReason: { type: 'string' } } : {}),
      },
    },
  },
  ...(mode === 'writable' ? [{
    name: 'write',
    description: 'Replace one exact app-relative file declared in the current case write allowlist. The content must be the complete file.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
  }] : []),
]

function result(id, value) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: value })}\n`)
}

function toolResult(id, text, isError = false) {
  result(id, { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })
}

function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return
  if (message.method === 'initialize') {
    result(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'open-mercato-agent-harness', version: '1.0.0' },
    })
    return
  }
  if (message.method === 'ping') { result(message.id, {}); return }
  if (message.method === 'tools/list') { result(message.id, { tools }); return }
  if (message.method !== 'tools/call') return
  try {
    const name = message.params?.name
    const input = message.params?.arguments ?? {}
    if (name === 'read') {
      const { real, commitExampleRead, commitInstalledFallback } = resolveRead(input.path, input.fallbackReason)
      const content = fs.readFileSync(real, 'utf8')
      commitExampleRead()
      commitInstalledFallback()
      toolResult(message.id, content)
      return
    }
    if (name === 'write') {
      if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > MAX_WRITE_BYTES) throw new Error('content must be a bounded string')
      const target = resolveWrite(input.path)
      const temporary = `${target}.om-harness-${process.pid}.tmp`
      fs.writeFileSync(temporary, input.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, target)
      toolResult(message.id, `wrote ${input.path}`)
      return
    }
    throw new Error('unknown tool')
  } catch (error) {
    toolResult(message.id, error instanceof Error ? error.message : String(error), true)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  while (true) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).replace(/\r$/, '')
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    try { handle(JSON.parse(line)) } catch (error) {
      process.stderr.write(`agent-harness-tool-server: invalid request: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
})
