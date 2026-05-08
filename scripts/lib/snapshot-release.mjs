import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

function normalizePrereleaseIdentifier(value, fallback, { prefixIfNumeric = '' } = {}) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')

  if (!normalized) {
    return fallback
  }

  if (/^\d+$/.test(normalized)) {
    if (prefixIfNumeric) {
      return `${prefixIfNumeric}${normalized}`
    }

    if (normalized.length > 1 && normalized.startsWith('0')) {
      return `n${normalized}`
    }
  }

  return normalized
}

export function normalizeStableVersion(currentVersion) {
  const normalized = String(currentVersion ?? '').trim().split('-')[0] ?? ''

  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Invalid version: ${currentVersion}`)
  }

  return normalized
}

export function getNextPatchVersion(currentVersion) {
  const [major, minor, patch] = normalizeStableVersion(currentVersion).split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

export function buildSnapshotVersion({ currentVersion, channel, buildId, commitSha }) {
  const nextVersion = getNextPatchVersion(currentVersion)
  const normalizedChannel = normalizePrereleaseIdentifier(channel, 'snapshot')
  const normalizedBuildId = normalizePrereleaseIdentifier(buildId, '0')
  const normalizedCommitSha = normalizePrereleaseIdentifier(commitSha, 'local', { prefixIfNumeric: 'g' })

  return `${nextVersion}-${normalizedChannel}.${normalizedBuildId}.${normalizedCommitSha}`
}

export function resolveSnapshotPublishConfig({ eventName, refName }) {
  if (eventName === 'pull_request') {
    return {
      channel: 'canary',
      publishTag: 'canary',
      movingInstallTarget: '',
      releaseKind: 'pr_preview',
    }
  }

  if (eventName === 'push' && refName === 'develop') {
    return {
      channel: 'develop',
      publishTag: 'develop',
      movingInstallTarget: '@open-mercato/*@develop',
      releaseKind: 'develop_snapshot',
    }
  }

  throw new Error(`Unsupported snapshot release context: ${eventName}:${refName}`)
}

function parseArgs(argv) {
  const options = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`)
    }

    const key = arg.slice(2)
    const value = argv[index + 1]

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }

    options[key] = value
    index += 1
  }

  return options
}

function requireOption(options, key) {
  const value = options[key]

  if (!value) {
    throw new Error(`Missing required option --${key}`)
  }

  return value
}

function runCli() {
  const [command, ...rest] = process.argv.slice(2)
  const options = parseArgs(rest)

  if (command === 'version') {
    const version = buildSnapshotVersion({
      currentVersion: requireOption(options, 'current-version'),
      channel: requireOption(options, 'channel'),
      buildId: requireOption(options, 'build-id'),
      commitSha: requireOption(options, 'commit-sha'),
    })

    process.stdout.write(`${version}\n`)
    return
  }

  if (command === 'config') {
    const config = resolveSnapshotPublishConfig({
      eventName: requireOption(options, 'event-name'),
      refName: options['ref-name'] ?? '',
    })

    process.stdout.write(`${JSON.stringify(config)}\n`)
    return
  }

  throw new Error('Usage: snapshot-release.mjs <version|config> [options]')
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  try {
    runCli()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  }
}
