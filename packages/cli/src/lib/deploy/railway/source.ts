import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RailwaySource, RailwaySourceMode } from './types'

type CommandRunner = (command: string, args: string[], cwd: string) => string

const defaultRunner: CommandRunner = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function tryRun(runner: CommandRunner, command: string, args: string[], cwd: string): string | null {
  try {
    return runner(command, args, cwd)
  } catch {
    return null
  }
}

export function normalizeGitRepository(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '')
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+)$/)
  if (sshMatch) return sshMatch[1] ?? null
  try {
    const parsed = new URL(trimmed)
    if (parsed.hostname !== 'github.com') return null
    return parsed.pathname.replace(/^\/+/, '') || null
  } catch {
    return null
  }
}

export function inspectGitSource(cwd: string, runner: CommandRunner = defaultRunner): RailwaySource | null {
  const branch = tryRun(runner, 'git', ['branch', '--show-current'], cwd)
  const remoteUrl = tryRun(runner, 'git', ['remote', 'get-url', 'origin'], cwd)
  if (!branch || !remoteUrl) return null
  const repo = normalizeGitRepository(remoteUrl)
  if (!repo) return null
  const commitSha = tryRun(runner, 'git', ['rev-parse', 'HEAD'], cwd) ?? undefined
  return {
    mode: 'git',
    reason: `GitHub remote origin and branch ${branch} detected`,
    repo,
    branch,
    commitSha,
  }
}

export function assertGitDeployReady(cwd: string, runner: CommandRunner = defaultRunner): void {
  const status = tryRun(runner, 'git', ['status', '--porcelain'], cwd)
  if (status === null) throw new Error('Git is required for --source git.')
  if (status.length > 0) throw new Error('Git-backed deploy requires a clean working tree.')
  const upstream = tryRun(runner, 'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
  if (!upstream) throw new Error('The current branch has no upstream. Push it before a Git-backed deploy.')
  const ahead = tryRun(runner, 'git', ['rev-list', '--count', '@{u}..HEAD'], cwd)
  if (ahead === null || Number.parseInt(ahead, 10) > 0) {
    throw new Error('The current branch has local commits that are not pushed to its upstream.')
  }
  const behind = tryRun(runner, 'git', ['rev-list', '--count', 'HEAD..@{u}'], cwd)
  if (behind === null || Number.parseInt(behind, 10) > 0) {
    throw new Error('The current branch is behind its upstream. Pull the latest commits before a Git-backed deploy.')
  }
}

export function isRailwayCliAvailable(cwd: string, runner: CommandRunner = defaultRunner): boolean {
  return tryRun(runner, 'railway', ['--version'], cwd) !== null
}

export function resolveRailwaySource(
  mode: RailwaySourceMode,
  cwd: string,
  runner: CommandRunner = defaultRunner,
): RailwaySource {
  const gitSource = inspectGitSource(cwd, runner)
  if (mode === 'git') {
    if (!gitSource) {
      throw new Error('--source git requires a GitHub origin remote and a current branch.')
    }
    assertGitDeployReady(cwd, runner)
    return gitSource
  }
  if (mode === 'local') {
    if (!isRailwayCliAvailable(cwd, runner)) {
      throw new Error('--source local requires the Railway CLI. Install it from https://docs.railway.com/reference/cli-api.')
    }
    return { mode: 'local', reason: 'Local upload explicitly requested' }
  }
  if (gitSource) {
    try {
      assertGitDeployReady(cwd, runner)
      return gitSource
    } catch (error) {
      if (!isRailwayCliAvailable(cwd, runner)) throw error
      const reason = error instanceof Error ? error.message : 'Git source is not deployable'
      return {
        mode: 'local',
        reason: `${reason} Falling back to railway up.`,
      }
    }
  }
  if (!isRailwayCliAvailable(cwd, runner)) {
    throw new Error('No usable GitHub remote found and the Railway CLI is unavailable for local upload.')
  }
  return { mode: 'local', reason: 'No usable GitHub remote found; falling back to railway up' }
}

const REQUIRED_IGNORE_ENTRIES = [
  { label: '.env', matches: (line: string) => line === '.env' || line === '.env*' },
  { label: '.env.*', matches: (line: string) => line === '.env.*' || line === '.env*' },
  { label: '*.pem', matches: (line: string) => line === '*.pem' },
  { label: '*.key', matches: (line: string) => line === '*.key' },
  { label: 'id_rsa', matches: (line: string) => line === 'id_*' || line === 'id_rsa' },
  { label: 'id_ed25519', matches: (line: string) => line === 'id_*' || line === 'id_ed25519' },
  { label: '.git', matches: (line: string) => line === '.git' },
  { label: '.railway', matches: (line: string) => line === '.railway' },
  { label: 'node_modules', matches: (line: string) => line === 'node_modules' },
  { label: '.yarn/cache', matches: (line: string) => line === '.yarn/cache' },
  { label: '.next', matches: (line: string) => line === '.next' },
  { label: '.turbo', matches: (line: string) => line === '.turbo' },
  { label: '*.db', matches: (line: string) => line === '*.db' },
  { label: '*.sqlite', matches: (line: string) => line === '*.sqlite' || line === '*.sqlite*' },
  { label: '*.sqlite3', matches: (line: string) => line === '*.sqlite3' || line === '*.sqlite*' },
  { label: '.mercato/railway.json', matches: (line: string) =>
    line === '.mercato/railway.json' || line === '.mercato/railway.json*' },
  { label: '.mercato/railway.json.local', matches: (line: string) =>
    line === '.mercato/railway.json.local' || line === '.mercato/railway.json*' },
]

export function assertLocalUploadSafe(cwd: string): void {
  const ignorePath = resolve(cwd, '.railwayignore')
  if (!existsSync(ignorePath)) {
    throw new Error('Local Railway upload requires a .railwayignore file.')
  }
  const entries = readFileSync(ignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\/+|\/+$/g, ''))
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
  const missing = REQUIRED_IGNORE_ENTRIES
    .filter((requirement) => !entries.some(requirement.matches))
    .map((requirement) => requirement.label)
  if (missing.length > 0) {
    throw new Error(`.railwayignore is missing required safety entries: ${missing.join(', ')}`)
  }
}
