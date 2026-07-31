#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { TextDecoder } from 'node:util'

const MAX_SESSION_BYTES = 20 * 1024 * 1024
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024
const MAX_PUBLIC_ARTIFACT_BYTES = 25 * 1024 * 1024
const MAX_ARCHIVE_BYTES = MAX_PUBLIC_ARTIFACT_BYTES
const MAX_PUBLIC_BUNDLE_BYTES = 30 * 1024 * 1024
const SHARE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/
const textDecoder = new TextDecoder('utf-8', { fatal: true })

const sensitiveValueKeyPattern = /^(authorization|cookie|set-cookie|password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i
const pseudonymKeyPattern = /^(session[_-]?id|thread[_-]?id|user[_-]?id|account[_-]?id|organization[_-]?id|tenant[_-]?id|git[_-]?branch)$/i
const pathKeyPattern = /^(cwd|file|filePath|file_path|filename|path)$/i
const commandKeyPattern = /^(command|cmd|shell)$/i
const dangerousPathPattern = /(^|\/)(\.env(?:\.[^/]*)?|\.ssh|\.aws|\.gcloud|\.kube|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|service-account(?:\.json)?|\.npmrc|\.pypirc)(\/|$)|\.(?:pem|key|p12|pfx|keystore)$/i
const completeRedactionMarkerPattern = /^«redacted:[a-z0-9-]+(?::[a-f0-9]{12})?»$/

function fail(message) {
  throw new Error(message)
}

function parseArguments(argv) {
  const allowed = new Set(['name', 'session', 'project-root', 'files', 'out', 'redact-list'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) fail('Every argument must use a named --flag.')
    const key = argument.slice(2)
    if (!allowed.has(key)) fail(`Unknown argument: --${key}`)
    if (values.has(key)) fail(`Duplicate argument: --${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}.`)
    values.set(key, value)
    index += 1
  }

  for (const required of ['name', 'session', 'project-root', 'files', 'out']) {
    if (!values.has(required)) fail(`Missing required argument: --${required}.`)
  }
  return Object.fromEntries(values)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function pseudonym(value, label) {
  return `«redacted:${label}:${sha256(value).slice(0, 12)}»`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSlashes(value) {
  return value.replaceAll('\\', '/')
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== '' && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot)
}

function isDangerousPath(value) {
  const normalized = value.replaceAll('\\', '/')
  return dangerousPathPattern.test(normalized)
}

function countReplacement(state, category) {
  state.redactions[category] += 1
}

function replaceMatches(value, pattern, replacement, state, category) {
  return value.replace(pattern, (...match) => {
    countReplacement(state, category)
    return typeof replacement === 'function' ? replacement(...match) : replacement
  })
}

function shannonEntropy(value) {
  const frequencies = new Map()
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1)
  let entropy = 0
  for (const count of frequencies.values()) {
    const probability = count / value.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy
}

function redactHighEntropy(value, state) {
  return value.replace(/[A-Za-z0-9+/_=-]{32,}/g, (candidate) => {
    if (/^[a-f0-9]+$/i.test(candidate) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(candidate)) return candidate
    if (!/[A-Za-z]/.test(candidate) || !/[0-9]/.test(candidate) || shannonEntropy(candidate) < 4.1) return candidate
    countReplacement(state, 'secrets')
    return '«redacted:high-entropy»'
  })
}

function sanitizeString(input, key, state) {
  if (completeRedactionMarkerPattern.test(input)) return input
  if (sensitiveValueKeyPattern.test(key) && input.length > 0) {
    countReplacement(state, 'secrets')
    return '«redacted:secret-value»'
  }
  if (pseudonymKeyPattern.test(key) && input.length > 0) {
    countReplacement(state, 'identifiers')
    return pseudonym(input, 'identifier')
  }
  if (commandKeyPattern.test(key) && isDangerousPath(input)) {
    countReplacement(state, 'dangerous')
    return '«redacted:dangerous-file-command»'
  }

  let value = input
  if (state.projectRootPattern) {
    value = replaceMatches(value, state.projectRootPattern, '<project-root>', state, 'paths')
  }
  if (state.homePattern) {
    value = replaceMatches(value, state.homePattern, '~', state, 'paths')
  }
  value = replaceMatches(value, /(?:\/Users|\/home)\/[^/\s"']+/g, '~', state, 'paths')
  value = replaceMatches(value, /[A-Za-z]:\\Users\\[^\\\s"']+/g, '~', state, 'paths')

  for (const literal of state.customLiterals) {
    const pattern = new RegExp(escapeRegExp(literal), 'g')
    value = replaceMatches(value, pattern, '«redacted:custom-literal»', state, 'custom')
  }

  value = replaceMatches(
    value,
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '«redacted:private-key»',
    state,
    'secrets',
  )
  value = replaceMatches(value, /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '«redacted:credential»', state, 'secrets')
  value = replaceMatches(value, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '«redacted:jwt»', state, 'secrets')
  value = replaceMatches(value, /\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}\b/gi, (_match, scheme) => `${scheme} «redacted:authorization»`, state, 'secrets')
  value = replaceMatches(value, /\b(Authorization\s*:\s*)[^\s,;]+/gi, (_match, prefix) => `${prefix}«redacted:authorization»`, state, 'secrets')
  value = replaceMatches(value, /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, (_match, prefix) => `${prefix}«redacted:credential»@`, state, 'secrets')
  value = replaceMatches(value, /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|client[_-]?secret)\s*[:=]\s*)[^\s,;"']+/gi, (_match, prefix) => `${prefix}«redacted:secret»`, state, 'secrets')
  value = redactHighEntropy(value, state)

  value = replaceMatches(value, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '«redacted:email»', state, 'pii')
  value = replaceMatches(value, /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '«redacted:ip»', state, 'pii')
  value = replaceMatches(value, /\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi, '«redacted:ip»', state, 'pii')
  value = replaceMatches(value, /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '«redacted:identifier»', state, 'identifiers')
  value = replaceMatches(value, /\b[0-9a-f]{64,}\b/gi, '«redacted:hex-secret»', state, 'secrets')
  value = value.replace(/\+?\d[\d ()-]{7,}\d/g, (candidate) => {
    const digits = candidate.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 15) return candidate
    countReplacement(state, 'pii')
    return '«redacted:phone»'
  })

  return value
}

function sanitizeNode(value, key, state) {
  if (typeof value === 'string') return sanitizeString(value, key, state)
  if (Array.isArray(value)) return value.map((item) => sanitizeNode(item, '', state))
  if (!value || typeof value !== 'object') return value

  for (const [candidateKey, candidateValue] of Object.entries(value)) {
    if (pathKeyPattern.test(candidateKey) && typeof candidateValue === 'string' && isDangerousPath(candidateValue)) {
      countReplacement(state, 'dangerous')
      return { redacted: 'dangerous-file-reference' }
    }
  }

  const output = Object.create(null)
  for (const [childKey, childValue] of Object.entries(value)) {
    const sanitizedKey = sanitizeString(childKey, 'object-key', state)
    if (Object.hasOwn(output, sanitizedKey)) fail('Sanitization produced duplicate object keys.')
    output[sanitizedKey] = sanitizeNode(childValue, childKey, state)
  }
  return output
}

function inferRole(value) {
  if (!value || typeof value !== 'object') return null
  for (const candidate of [value.type, value.role, value.message?.role]) {
    if (candidate === 'user' || candidate === 'assistant') return candidate
  }
  return null
}

function analyzeSession(session) {
  let entries
  let collectionName
  if (Array.isArray(session)) {
    entries = session
    collectionName = 'root'
  } else if (session && typeof session === 'object') {
    for (const key of ['turns', 'messages', 'events', 'conversation']) {
      if (Array.isArray(session[key])) {
        entries = session[key]
        collectionName = key
        break
      }
    }
  }
  if (!entries) fail('Session JSON has no recognizable turn/event collection.')

  const roles = entries.map(inferRole).filter(Boolean)
  const userTurns = roles.filter((role) => role === 'user').length
  const assistantTurns = roles.filter((role) => role === 'assistant').length
  if (userTurns === 0 || assistantTurns === 0) {
    fail('Session JSON must contain at least one recognizable user turn and one assistant turn.')
  }
  return {
    collection: collectionName,
    entries: entries.length,
    recognizedTurns: roles.length,
    userTurns,
    assistantTurns,
    firstRecognizedRole: roles[0],
    lastRecognizedRole: roles.at(-1),
  }
}

function readUtf8File(path, maxBytes, label) {
  const stat = lstatSync(path)
  if (!stat.isFile()) fail(`${label} must be a regular file.`)
  if (stat.isSymbolicLink()) fail(`${label} must not be a symlink.`)
  if (stat.size > maxBytes) fail(`${label} exceeds the allowed size.`)
  const buffer = readFileSync(path)
  if (buffer.includes(0)) fail(`${label} contains binary data.`)
  try {
    return { content: textDecoder.decode(buffer), stat }
  } catch {
    fail(`${label} is not valid UTF-8 text.`)
  }
}

function loadCustomLiterals(path) {
  if (!path) return []
  const { content } = readUtf8File(resolve(path), 1024 * 1024, 'Redaction list')
  const literals = [...new Set(content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
  for (const literal of literals) {
    if (literal.length < 4) fail('Every custom redaction literal must contain at least four characters.')
  }
  return literals.sort((left, right) => right.length - left.length)
}

function validateRelativePath(value) {
  if (value.includes('\0') || isAbsolute(value)) fail('Generated-file paths must be relative and contain no NUL bytes.')
  const withSlashes = normalizeSlashes(value)
  if (withSlashes.startsWith('../') || withSlashes.includes('/../')) {
    fail('Generated-file paths must stay below the project root.')
  }
  const normalized = posix.normalize(withSlashes.replace(/^\.\//, ''))
  if (!normalized || normalized === '.' || normalized.startsWith('../')) fail('Generated-file paths must stay below the project root.')
  if (isDangerousPath(normalized)) fail(`Dangerous generated-file path rejected: ${normalized}`)
  if (/@|(?:\/Users|\/home)\//i.test(normalized)) fail(`Potentially identifying generated-file path rejected: ${normalized}`)
  return normalized
}

function loadGeneratedFiles(manifestPath, projectRoot, state) {
  const { content } = readUtf8File(manifestPath, 1024 * 1024, 'Files manifest')
  const relativePaths = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  if (relativePaths.length === 0) fail('Files manifest must name at least one generated or modified file.')
  if (new Set(relativePaths).size !== relativePaths.length) fail('Files manifest contains duplicate paths.')
  const safePaths = relativePaths.map(validateRelativePath)
  if (new Set(safePaths).size !== safePaths.length) fail('Files manifest contains paths that resolve to the same normalized path.')

  let totalBytes = 0
  return safePaths.map((safePath) => {
    const resolvedPath = resolve(projectRoot, safePath)
    if (!existsSync(resolvedPath)) fail(`Generated file does not exist: ${safePath}`)
    const stat = lstatSync(resolvedPath)
    if (stat.isSymbolicLink()) fail(`Generated file must not be a symlink: ${safePath}`)
    const realPath = realpathSync(resolvedPath)
    if (!isWithin(projectRoot, realPath)) fail(`Generated file escapes the project root: ${safePath}`)
    const { content: sourceContent } = readUtf8File(realPath, MAX_FILE_BYTES, `Generated file ${safePath}`)
    totalBytes += stat.size
    if (totalBytes > MAX_TOTAL_FILE_BYTES) fail('Generated files exceed the total allowed size.')
    const sanitizedContent = sanitizeString(sourceContent, 'file-content', state)
    return {
      relativePath: safePath,
      mode: stat.mode & 0o777,
      originalBytes: stat.size,
      sanitizedContent,
      sanitizedBytes: Buffer.byteLength(sanitizedContent),
      sha256: sha256(sanitizedContent),
    }
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function createResidualScanState(state) {
  return {
    customLiterals: state.customLiterals,
    projectRootPattern: state.projectRootPattern,
    homePattern: state.homePattern,
    redactions: { secrets: 0, pii: 0, paths: 0, dangerous: 0, identifiers: 0, custom: 0 },
  }
}

function verifyResidualScan(sanitizedSession, files, state) {
  const scanState = createResidualScanState(state)
  if (JSON.stringify(sanitizeNode(sanitizedSession, '', scanState)) !== JSON.stringify(sanitizedSession)) {
    fail('Residual privacy scan found sensitive session content after sanitization.')
  }
  for (const file of files) {
    if (sanitizeString(file.relativePath, 'generated-file-path', scanState) !== file.relativePath) {
      fail('Residual privacy scan found a sensitive generated-file path after sanitization.')
    }
    if (sanitizeString(file.sanitizedContent, 'file-content', scanState) !== file.sanitizedContent) {
      fail('Residual privacy scan found sensitive generated-file content after sanitization.')
    }
  }
}

function runGit(argumentsList, cwd) {
  const result = spawnSync('git', argumentsList, { cwd, encoding: 'utf8' })
  if (result.status !== 0) fail('Git could not create the generated-files ZIP archive.')
}

function createArchive(files, sourceDirectory, archivePath) {
  for (const file of files) {
    const destination = join(sourceDirectory, ...file.relativePath.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, file.sanitizedContent, 'utf8')
    chmodSync(destination, file.mode)
  }
  runGit(['init', '--quiet'], sourceDirectory)
  runGit(['add', '--all'], sourceDirectory)
  runGit(['-c', 'user.name=Session Share', '-c', 'user.email=session-share.invalid', 'commit', '--quiet', '--message', 'session share bundle'], sourceDirectory)
  runGit(['archive', '--format=zip', `--output=${archivePath}`, 'HEAD'], sourceDirectory)
  const archive = readFileSync(archivePath)
  if (archive.length > MAX_ARCHIVE_BYTES) fail('Generated-files ZIP exceeds the allowed size.')
  return archive
}

function main() {
  const args = parseArguments(process.argv.slice(2))
  if (!SHARE_NAME_PATTERN.test(args.name)) fail('Share name must be a 3–48 character kebab-case slug.')

  const sessionPath = resolve(args.session)
  const manifestPath = resolve(args.files)
  const projectRoot = realpathSync(resolve(args['project-root']))
  const outputPath = resolve(args.out)
  if (existsSync(outputPath)) fail('Output path already exists; use a new temporary location.')

  const outputParent = dirname(outputPath)
  mkdirSync(outputParent, { recursive: true })
  const stagingDirectory = mkdtempSync(join(outputParent, `.${basename(outputPath)}-preparing-`))
  const bundleDirectory = join(stagingDirectory, 'bundle')
  const archiveSourceDirectory = join(stagingDirectory, 'archive-source')
  mkdirSync(bundleDirectory)
  mkdirSync(archiveSourceDirectory)

  try {
    const homeDirectory = process.env.HOME ? resolve(process.env.HOME) : null
    const state = {
      customLiterals: loadCustomLiterals(args['redact-list']),
      projectRootPattern: new RegExp(escapeRegExp(projectRoot), 'g'),
      homePattern: homeDirectory ? new RegExp(escapeRegExp(homeDirectory), 'g') : null,
      redactions: { secrets: 0, pii: 0, paths: 0, dangerous: 0, identifiers: 0, custom: 0 },
    }

    const { content: sessionSource } = readUtf8File(sessionPath, MAX_SESSION_BYTES, 'Session export')
    let session
    try {
      session = JSON.parse(sessionSource)
    } catch {
      fail('Session export is not valid JSON.')
    }
    const sessionSummary = analyzeSession(session)
    const sanitizedSession = sanitizeNode(session, '', state)
    const sanitizedSessionText = `${JSON.stringify(sanitizedSession, null, 2)}\n`
    const sessionOutputPath = join(bundleDirectory, 'session.json')
    writeFileSync(sessionOutputPath, sanitizedSessionText, 'utf8')

    const files = loadGeneratedFiles(manifestPath, projectRoot, state)
    verifyResidualScan(sanitizedSession, files, state)
    const archivePath = join(bundleDirectory, 'generated-files.zip')
    const archive = createArchive(files, archiveSourceDirectory, archivePath)

    const reviewDirectory = join(bundleDirectory, 'review', 'generated-files')
    mkdirSync(reviewDirectory, { recursive: true })
    for (const file of files) {
      const source = join(archiveSourceDirectory, ...file.relativePath.split('/'))
      const destination = join(reviewDirectory, ...file.relativePath.split('/'))
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      chmodSync(destination, file.mode)
    }

    const privacyReport = {
      version: 1,
      automatedScan: 'pass',
      semanticReview: 'required',
      guarantee: 'Automated scanning cannot prove that contextual personal or confidential data is absent.',
      redactions: state.redactions,
      rejectedInputClasses: ['dangerous paths', 'symlinks', 'binary or invalid UTF-8 files', 'out-of-root files', 'oversized inputs'],
    }
    const privacyReportText = `${JSON.stringify(privacyReport, null, 2)}\n`
    const privacyReportPath = join(bundleDirectory, 'privacy-report.json')
    writeFileSync(privacyReportPath, privacyReportText, 'utf8')

    const manifest = {
      version: 1,
      shareName: args.name,
      createdAt: new Date().toISOString(),
      session: {
        ...sessionSummary,
        bytes: Buffer.byteLength(sanitizedSessionText),
        sha256: sha256(sanitizedSessionText),
      },
      generatedFiles: files.map(({ relativePath, mode, originalBytes, sanitizedBytes, sha256: fileHash }) => ({
        path: relativePath,
        mode: mode.toString(8).padStart(3, '0'),
        originalBytes,
        sanitizedBytes,
        sha256: fileHash,
      })),
      artifacts: {
        'generated-files.zip': { bytes: archive.length, sha256: sha256(archive) },
        'privacy-report.json': { bytes: Buffer.byteLength(privacyReportText), sha256: sha256(privacyReportText) },
      },
    }
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
    const publishedArtifactSizes = [
      Buffer.byteLength(sanitizedSessionText),
      archive.length,
      Buffer.byteLength(manifestText),
      Buffer.byteLength(privacyReportText),
    ]
    if (publishedArtifactSizes.some((size) => size > MAX_PUBLIC_ARTIFACT_BYTES)) {
      fail('A public session-share artifact exceeds the provider size limit.')
    }
    if (publishedArtifactSizes.reduce((total, size) => total + size, 0) > MAX_PUBLIC_BUNDLE_BYTES) {
      fail('Public session-share artifacts exceed the provider total size limit.')
    }
    writeFileSync(join(bundleDirectory, 'manifest.json'), manifestText, 'utf8')

    renameSync(bundleDirectory, outputPath)
    rmSync(stagingDirectory, { recursive: true, force: true })
    process.stdout.write(`${JSON.stringify({
      status: 'prepared',
      entries: sessionSummary.entries,
      userTurns: sessionSummary.userTurns,
      assistantTurns: sessionSummary.assistantTurns,
      generatedFiles: files.length,
      archiveBytes: archive.length,
      redactions: state.redactions,
      semanticReview: 'required',
    })}\n`)
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown bundle-preparation failure.'
  process.stderr.write(`Session share bundle was not prepared: ${message}\n`)
  process.exitCode = 1
}
