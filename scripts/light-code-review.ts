import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnvFile } from 'dotenv'
import { generateObject } from 'ai'
import { z } from 'zod'

type Scope = 'staged' | 'push'
type FindingCategory = 'secret' | 'pii' | 'language'
type ProviderId = 'anthropic' | 'openai'

type DiffLine = {
  filePath: string
  lineNumber: number
  text: string
}

type ReviewFinding = {
  category: FindingCategory
  filePath: string
  lineNumber: number
  reason: string
  excerpt: string
}

type ReviewChunk = {
  index: number
  content: string
}

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')
const REVIEW_MODEL_ENV = 'OM_AI_LIGHT_REVIEW_MODEL'
const AUTOMATIC_ENV_KEYS = ['OM_AI_LIGHT_REVIEW_AUTOMATIC', 'OM_AI_LIGH_REVIEW_AUTOMATIC'] as const
const PROVIDER_PREFERENCE = ['anthropic', 'openai'] as const
const PATH_SKIP_PATTERNS = [
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)\.turbo\//,
  /(^|\/)\.mercato\/generated\//,
  /(^|\/)node_modules\//,
  /(^|\/)__snapshots__\//,
  /(^|\/)playwright-report\//,
  /(^|\/)test-results\//,
  /(^|\/)yarn\.lock$/,
]
const MAX_CHARS_PER_CHUNK = 12000
const REVIEW_OUTPUT_SCHEMA = z.object({
  findings: z.array(
    z.object({
      category: z.enum(['secret', 'pii', 'language']),
      filePath: z.string().min(1),
      lineNumber: z.number().int().positive(),
      reason: z.string().min(1),
      excerpt: z.string().min(1),
    }),
  ),
})

const PROVIDERS: Record<
  ProviderId,
  {
    envKeys: readonly string[]
    defaultModel: string
    createModel: (apiKey: string, modelId: string) => Promise<Parameters<typeof generateObject>[0]['model']>
  }
> = {
  anthropic: {
    envKeys: ['ANTHROPIC_API_KEY', 'OPENCODE_ANTHROPIC_API_KEY'],
    defaultModel: 'claude-haiku-4-5-20251001',
    createModel: async (apiKey, modelId) => {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey })(modelId) as Parameters<typeof generateObject>[0]['model']
    },
  },
  openai: {
    envKeys: ['OPENAI_API_KEY', 'OPENCODE_OPENAI_API_KEY'],
    defaultModel: 'gpt-4o-mini',
    createModel: async (apiKey, modelId) => {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey })(modelId) as Parameters<typeof generateObject>[0]['model']
    },
  },
}

const red = (value: string) => `\x1b[31m${value}\x1b[0m`
const yellow = (value: string) => `\x1b[33m${value}\x1b[0m`
const green = (value: string) => `\x1b[32m${value}\x1b[0m`
const cyan = (value: string) => `\x1b[36m${value}\x1b[0m`
const dim = (value: string) => `\x1b[2m${value}\x1b[0m`

function loadReviewEnv() {
  const envCandidates = [
    path.join(ROOT, '.env'),
    path.join(ROOT, '.env.local'),
    path.join(ROOT, 'apps/mercato/.env'),
    path.join(ROOT, 'apps/mercato/.env.local'),
  ]

  for (const filePath of envCandidates) {
    if (!fs.existsSync(filePath)) continue
    loadEnvFile({ path: filePath, override: false, quiet: true })
  }
}

function parseArgs() {
  const scopeArg = process.argv.find(arg => arg.startsWith('--scope='))?.slice('--scope='.length) ?? 'staged'
  const baseArg = process.argv.find(arg => arg.startsWith('--base='))?.slice('--base='.length)
  const withTypecheck = process.argv.includes('--typecheck')

  if (scopeArg !== 'staged' && scopeArg !== 'push') {
    console.error(red(`Unsupported scope: ${scopeArg}`))
    process.exit(1)
  }

  return {
    scope: scopeArg as Scope,
    baseArg,
    withTypecheck,
  }
}

function runGit(args: string[]) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

function tryRunGit(args: string[]) {
  try {
    return runGit(args)
  } catch {
    return null
  }
}

function shouldSkipFile(filePath: string) {
  return PATH_SKIP_PATTERNS.some(pattern => pattern.test(filePath))
}

function resolvePushBase(baseArg?: string) {
  if (baseArg) {
    return { label: baseArg, range: `${baseArg}...HEAD` }
  }

  const upstream = tryRunGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  if (upstream) {
    return { label: upstream, range: `${upstream}...HEAD` }
  }

  for (const candidate of ['origin/develop', 'origin/main']) {
    const resolved = tryRunGit(['rev-parse', '--verify', candidate])
    if (resolved) {
      return { label: candidate, range: `${candidate}...HEAD` }
    }
  }

  const previousCommit = tryRunGit(['rev-parse', 'HEAD^'])
  if (previousCommit) {
    return { label: 'HEAD^', range: 'HEAD^..HEAD' }
  }

  const emptyTree = runGit(['hash-object', '-t', 'tree', '/dev/null'])
  return { label: '<empty-tree>', range: `${emptyTree}..HEAD` }
}

function getDiff(scope: Scope, baseArg?: string) {
  if (scope === 'staged') {
    return {
      label: 'staged changes',
      diff: runGit(['diff', '--cached', '--unified=0', '--no-color', '--diff-filter=ACMR']),
    }
  }

  const base = resolvePushBase(baseArg)
  return {
    label: `outbound changes against ${base.label}`,
    diff: runGit(['diff', '--unified=0', '--no-color', base.range, '--diff-filter=ACMR']),
  }
}

function parseAddedLines(diffText: string) {
  const lines = diffText.split('\n')
  const addedLines: DiffLine[] = []
  let currentFile = ''
  let currentLine = 0

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length)
      continue
    }

    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)(?:,(\d+))?/)
      if (match) currentLine = Number(match[1])
      continue
    }

    if (!currentFile || shouldSkipFile(currentFile)) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push({
        filePath: currentFile,
        lineNumber: currentLine,
        text: line.slice(1),
      })
      currentLine += 1
      continue
    }

    if (line.startsWith(' ')) {
      currentLine += 1
    }
  }

  return addedLines
}

function parseBoolean(value: string | undefined) {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function isAutomaticReviewEnabled() {
  return AUTOMATIC_ENV_KEYS.some(key => parseBoolean(process.env[key]))
}

function parseModelOverride(token: string | undefined) {
  if (!token) return null
  const normalized = token.trim()
  if (!normalized) return null

  const slashIndex = normalized.indexOf('/')
  if (slashIndex <= 0) {
    return {
      providerId: null,
      modelId: normalized,
    }
  }

  const providerCandidate = normalized.slice(0, slashIndex).trim().toLowerCase()
  if (providerCandidate !== 'anthropic' && providerCandidate !== 'openai') {
    throw new Error(`Unsupported provider in ${REVIEW_MODEL_ENV}: ${providerCandidate}`)
  }

  return {
    providerId: providerCandidate as ProviderId,
    modelId: normalized.slice(slashIndex + 1).trim(),
  }
}

function getProviderApiKey(providerId: ProviderId) {
  for (const envKey of PROVIDERS[providerId].envKeys) {
    const value = process.env[envKey]?.trim()
    if (value) {
      return { apiKey: value, envKey }
    }
  }

  return null
}

function resolveProvider() {
  const modelOverride = parseModelOverride(process.env[REVIEW_MODEL_ENV])
  if (modelOverride?.providerId) {
    const configuredKey = getProviderApiKey(modelOverride.providerId)
    if (!configuredKey) {
      throw new Error(`Missing API key for ${modelOverride.providerId}. Expected one of: ${PROVIDERS[modelOverride.providerId].envKeys.join(', ')}`)
    }

    return {
      providerId: modelOverride.providerId,
      apiKey: configuredKey.apiKey,
      apiKeyEnv: configuredKey.envKey,
      modelId: modelOverride.modelId,
    }
  }

  const preferredProvider = process.env.OPENCODE_PROVIDER?.trim().toLowerCase()
  if ((preferredProvider === 'anthropic' || preferredProvider === 'openai')) {
    const configuredKey = getProviderApiKey(preferredProvider)
    if (configuredKey) {
      return {
        providerId: preferredProvider,
        apiKey: configuredKey.apiKey,
        apiKeyEnv: configuredKey.envKey,
        modelId: modelOverride?.modelId ?? PROVIDERS[preferredProvider].defaultModel,
      }
    }
  }

  for (const providerId of PROVIDER_PREFERENCE) {
    const configuredKey = getProviderApiKey(providerId)
    if (!configuredKey) continue
    return {
      providerId,
      apiKey: configuredKey.apiKey,
      apiKeyEnv: configuredKey.envKey,
      modelId: modelOverride?.modelId ?? PROVIDERS[providerId].defaultModel,
    }
  }

  throw new Error(
    `AI light review requires one configured provider key. Supported env keys: ${Object.values(PROVIDERS).flatMap(provider => provider.envKeys).join(', ')}`,
  )
}

function buildChunks(addedLines: DiffLine[]) {
  const sortedLines = [...addedLines].sort((left, right) => {
    const fileOrder = left.filePath.localeCompare(right.filePath)
    return fileOrder !== 0 ? fileOrder : left.lineNumber - right.lineNumber
  })

  const chunks: ReviewChunk[] = []
  let currentChunk = ''

  for (const line of sortedLines) {
    const serialized = `${line.filePath}:${line.lineNumber} | ${line.text}\n`
    if (currentChunk.length > 0 && currentChunk.length + serialized.length > MAX_CHARS_PER_CHUNK) {
      chunks.push({
        index: chunks.length + 1,
        content: currentChunk.trimEnd(),
      })
      currentChunk = ''
    }

    currentChunk += serialized
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      index: chunks.length + 1,
      content: currentChunk.trimEnd(),
    })
  }

  return chunks
}

function excerptMap(addedLines: DiffLine[]) {
  return new Map(addedLines.map(line => [`${line.filePath}:${line.lineNumber}`, line.text]))
}

async function reviewChunk(input: {
  chunk: ReviewChunk
  providerId: ProviderId
  apiKey: string
  modelId: string
}) {
  const model = await PROVIDERS[input.providerId].createModel(input.apiKey, input.modelId)
  const result = await generateObject({
    model,
    schema: REVIEW_OUTPUT_SCHEMA,
    temperature: 0,
    system: [
      'You are reviewing only the added lines from a git diff before commit.',
      'Report only high-confidence issues in these categories: secret, pii, language.',
      'secret means likely real credentials, API keys, tokens, private keys, passwords, or other sensitive secrets.',
      'pii means likely real personal data such as private emails, phone numbers, SSNs, card numbers, or sensitive identifiers.',
      'language means clearly unprofessional, abusive, insulting, or curse-heavy human-facing text, comments, notes, or log/error copy.',
      'Do not flag placeholders, examples, mocks, fake data, test fixtures, or environment-variable references unless the line still appears to expose a real secret or real personal data.',
      'Do not flag generic code identifiers like password, token, or secret unless the actual value looks sensitive.',
      'Do not invent issues. If unsure, return no finding.',
      'Use the exact filePath and lineNumber from the input prefixes.',
    ].join(' '),
    prompt: [
      `Review chunk ${input.chunk.index}.`,
      'Each line below is prefixed as "filePath:lineNumber | content".',
      'Return findings only for the listed lines.',
      '',
      input.chunk.content,
    ].join('\n'),
  })

  return result.object.findings
}

async function reviewWithLlm(addedLines: DiffLine[]) {
  const provider = resolveProvider()
  const chunks = buildChunks(addedLines)
  const linesByLocation = excerptMap(addedLines)
  const findings = new Map<string, ReviewFinding>()

  console.log(cyan(`Using ${provider.providerId}/${provider.modelId} via ${provider.apiKeyEnv}.`))
  console.log(dim(`Reviewing ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} with the LLM.`))

  for (const chunk of chunks) {
    const chunkFindings = await reviewChunk({
      chunk,
      providerId: provider.providerId,
      apiKey: provider.apiKey,
      modelId: provider.modelId,
    })

    for (const finding of chunkFindings) {
      const key = `${finding.category}:${finding.filePath}:${finding.lineNumber}:${finding.reason}`
      if (findings.has(key)) continue

      findings.set(key, {
        category: finding.category,
        filePath: finding.filePath,
        lineNumber: finding.lineNumber,
        reason: finding.reason,
        excerpt: linesByLocation.get(`${finding.filePath}:${finding.lineNumber}`) ?? finding.excerpt,
      })
    }
  }

  return [...findings.values()]
}

function printFinding(finding: ReviewFinding) {
  const label =
    finding.category === 'secret'
      ? red('secret')
      : finding.category === 'pii'
        ? yellow('pii')
        : cyan('language')

  console.log(`${label} ${finding.filePath}:${finding.lineNumber} ${finding.reason}`)
  console.log(dim(`  ${finding.excerpt.trim()}`))
}

function runTypecheck() {
  console.log(cyan('\nRunning typecheck...\n'))
  const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
  const result = spawnSync(command, ['typecheck'], {
    cwd: ROOT,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function main() {
  loadReviewEnv()

  const { scope, baseArg, withTypecheck } = parseArgs()
  const { label, diff } = getDiff(scope, baseArg)
  const addedLines = parseAddedLines(diff)
  const scannedFiles = new Set(addedLines.map(line => line.filePath))

  console.log(cyan(`Light review: ${label}`))
  console.log(dim(`Scanned ${addedLines.length} added lines across ${scannedFiles.size} files.`))

  if (addedLines.length === 0) {
    console.log(green('\nNo added lines to review.'))
    if (withTypecheck) {
      runTypecheck()
      console.log(green('\nTypecheck passed.'))
    }
    return
  }

  const findings = await reviewWithLlm(addedLines)

  if (findings.length > 0) {
    console.log(red(`\nFound ${findings.length} issue${findings.length === 1 ? '' : 's'}:\n`))
    for (const finding of findings) {
      printFinding(finding)
    }
    process.exit(1)
  }

  console.log(green('\nNo lightweight review findings.'))

  if (withTypecheck) {
    runTypecheck()
    console.log(green('\nTypecheck passed.'))
  }
}

if (process.argv.includes('--automatic-check')) {
  loadReviewEnv()
  process.exit(isAutomaticReviewEnabled() ? 0 : 1)
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(red(`\nLight review failed: ${message}`))
  process.exit(1)
})
