import fs from 'node:fs'
import { spawnSync as defaultSpawnSync } from 'node:child_process'

export const DEFAULT_INOTIFY_LIMITS = {
  max_user_watches: 4194304,
  max_user_instances: 4096,
  max_queued_events: 65536,
}

const INOTIFY_PROC_DIR = '/proc/sys/fs/inotify'
const WSL_MARKER_PATHS = [
  '/proc/sys/kernel/osrelease',
  '/proc/version',
]

export const VSCODE_WATCHER_EXCLUDES = {
  '**/.git/**': true,
  '**/.turbo/**': true,
  '**/dist/**': true,
  '**/node_modules/**': true,
  '.ai/tmp/**': true,
  '.claude/**': true,
  '.mercato/**': true,
  'apps/mercato/.mercato/**': true,
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isInteger(parsed) ? parsed : null
}

export function detectWsl({
  platform = process.platform,
  readFileSync = fs.readFileSync,
} = {}) {
  if (platform !== 'linux') return false

  for (const markerPath of WSL_MARKER_PATHS) {
    try {
      const marker = String(readFileSync(markerPath, 'utf8')).toLowerCase()
      if (marker.includes('microsoft') || marker.includes('wsl')) {
        return true
      }
    } catch {
      // Non-WSL Linux images may not expose both marker files.
    }
  }

  return false
}

export function readCurrentInotifyLimits({
  readFileSync = fs.readFileSync,
} = {}) {
  const values = {}
  const errors = {}

  for (const name of Object.keys(DEFAULT_INOTIFY_LIMITS)) {
    const filePath = `${INOTIFY_PROC_DIR}/${name}`
    try {
      const value = parseInteger(readFileSync(filePath, 'utf8'))
      if (value === null) {
        errors[name] = `invalid value in ${filePath}`
      } else {
        values[name] = value
      }
    } catch (error) {
      errors[name] = error?.message ?? String(error)
    }
  }

  return { values, errors }
}

export function findInotifyLimitIssues(current, required = DEFAULT_INOTIFY_LIMITS) {
  const issues = []

  for (const [name, minimum] of Object.entries(required)) {
    const currentValue = current?.[name]
    if (typeof currentValue !== 'number') continue
    if (currentValue < minimum) {
      issues.push({ name, current: currentValue, required: minimum })
    }
  }

  return issues
}

export function buildSysctlAssignments(
  issues,
  required = DEFAULT_INOTIFY_LIMITS,
) {
  return issues.map((issue) => `fs.inotify.${issue.name}=${required[issue.name]}`)
}

export function buildPersistentSysctlConfig(required = DEFAULT_INOTIFY_LIMITS) {
  return [
    '# Open Mercato dev server file-watch limits',
    ...Object.entries(required).map(([name, value]) => `fs.inotify.${name}=${value}`),
    '',
  ].join('\n')
}

export function buildManualInotifyFix({ required = DEFAULT_INOTIFY_LIMITS } = {}) {
  const assignments = Object.entries(required)
    .map(([name, value]) => `fs.inotify.${name}=${value}`)
    .join(' ')
  const config = buildPersistentSysctlConfig(required).replace(/\n/g, '\\n')

  return [
    `sudo sysctl -w ${assignments}`,
    `printf '${config}' | sudo tee /etc/sysctl.d/99-open-mercato-inotify.conf >/dev/null`,
    'sudo sysctl --system',
  ]
}

export function mergeVsCodeWatcherExcludes(settings, excludes = VSCODE_WATCHER_EXCLUDES) {
  const next = {
    ...(settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}),
  }
  let changed = false

  for (const key of ['files.watcherExclude', 'search.exclude']) {
    const current = next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])
      ? next[key]
      : {}
    const merged = { ...current }

    for (const [pattern, value] of Object.entries(excludes)) {
      if (merged[pattern] !== value) {
        merged[pattern] = value
        changed = true
      }
    }

    if (next[key] !== merged) {
      next[key] = merged
    }
  }

  return { settings: next, changed }
}

function resolveSysctlCommand({ getuid = process.getuid?.bind(process), nonInteractive = true } = {}) {
  if (typeof getuid === 'function' && getuid() === 0) {
    return { command: 'sysctl', args: ['-w'] }
  }

  return {
    command: 'sudo',
    args: [nonInteractive ? '-n' : null, 'sysctl', '-w'].filter(Boolean),
  }
}

export function applyInotifyLimits({
  issues,
  required = DEFAULT_INOTIFY_LIMITS,
  spawnSync = defaultSpawnSync,
  getuid = process.getuid?.bind(process),
  nonInteractive = true,
  stdio = 'pipe',
} = {}) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return { ok: true, skipped: true }
  }

  const { command, args } = resolveSysctlCommand({ getuid, nonInteractive })
  const assignments = buildSysctlAssignments(issues, required)
  const result = spawnSync(command, [...args, ...assignments], {
    encoding: 'utf8',
    stdio,
  })

  return {
    ok: result.status === 0,
    command,
    args: [...args, ...assignments],
    status: result.status,
    error: result.error,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}

export function formatInotifyLimitFailure({
  current,
  issues,
  manualCommands = buildManualInotifyFix(),
  isWsl = false,
} = {}) {
  const location = isWsl ? 'WSL2/Linux' : 'Linux'
  const issueLines = issues.map((issue) =>
    `  fs.inotify.${issue.name}: ${issue.current} < ${issue.required}`,
  )

  return [
    `❌ ${location} file-watch limits are too low for Turbopack.`,
    'Turbopack will panic with "OS file watch limit reached" unless these sysctl values are raised.',
    '',
    ...issueLines,
    '',
    'Run this once in your WSL/Linux terminal:',
    ...manualCommands.map((line) => `  ${line}`),
    '',
    `Current values: ${JSON.stringify(current)}`,
  ].join('\n')
}

export function ensureDevInotifyLimits({
  env = process.env,
  platform = process.platform,
  readFileSync = fs.readFileSync,
  spawnSync = defaultSpawnSync,
  getuid = process.getuid?.bind(process),
  required = DEFAULT_INOTIFY_LIMITS,
} = {}) {
  const rawMode = String(env.OM_DEV_INOTIFY_CHECK ?? '').trim().toLowerCase()
  if (['0', 'false', 'off', 'skip'].includes(rawMode)) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }

  if (platform !== 'linux') {
    return { ok: true, skipped: true, reason: 'non-linux' }
  }

  const isWsl = detectWsl({ platform, readFileSync })
  const { values, errors } = readCurrentInotifyLimits({ readFileSync })
  const issues = findInotifyLimitIssues(values, required)

  if (issues.length === 0) {
    return { ok: true, current: values, isWsl }
  }

  const applyResult = applyInotifyLimits({
    issues,
    required,
    spawnSync,
    getuid,
    nonInteractive: true,
    stdio: 'pipe',
  })

  if (applyResult.ok) {
    return {
      ok: true,
      fixed: true,
      current: values,
      issues,
      isWsl,
      applyResult,
    }
  }

  const manualCommands = buildManualInotifyFix({ required })
  return {
    ok: false,
    current: values,
    errors,
    issues,
    isWsl,
    applyResult,
    manualCommands,
    message: formatInotifyLimitFailure({
      current: values,
      issues,
      manualCommands,
      isWsl,
    }),
  }
}
