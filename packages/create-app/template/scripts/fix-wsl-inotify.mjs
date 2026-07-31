#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import {
  DEFAULT_INOTIFY_LIMITS,
  buildPersistentSysctlConfig,
  buildSysctlAssignments,
  buildManualInotifyFix,
  detectWsl,
  findInotifyLimitIssues,
  mergeVsCodeWatcherExcludes,
  readCurrentInotifyLimits,
} from './dev-inotify-limits.mjs'

const PERSIST_PATH = '/etc/sysctl.d/99-open-mercato-inotify.conf'
const noPersist = process.argv.includes('--no-persist')
const assumeYes = process.argv.includes('--yes') || process.argv.includes('-y')
const applyVsCode = process.argv.includes('--vscode')
const skipVsCode = process.argv.includes('--no-vscode')

async function confirm(question, { defaultYes = false } = {}) {
  if (assumeYes) return true
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] '
    const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase()
    if (!answer) return defaultYes
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function maybeUpdateVsCodeSettings() {
  if (skipVsCode) return

  const shouldApply = applyVsCode || (!assumeYes && await confirm(
    'Optionally update .vscode/settings.json to exclude generated/cache/worktree folders from VS Code file watching? This modifies a tracked workspace file.',
  ))
  if (!shouldApply) return

  const settingsPath = path.join(process.cwd(), '.vscode', 'settings.json')
  let settings = {}
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    } catch (error) {
      console.warn(`Could not parse ${settingsPath}; leaving VS Code settings unchanged: ${error?.message ?? error}`)
      return
    }
  }

  const { settings: nextSettings, changed } = mergeVsCodeWatcherExcludes(settings)
  if (!changed) {
    console.log('VS Code watcher excludes already include the recommended Open Mercato patterns.')
    return
  }

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 4)}\n`)
  console.log(`Updated ${settingsPath}. Reload the WSL VS Code window so existing watcher handles are released.`)
}

function printCurrent(prefix) {
  const { values } = readCurrentInotifyLimits()
  console.log(`${prefix} ${JSON.stringify(values)}`)
  return values
}

if (process.platform !== 'linux') {
  console.log('Linux inotify limits do not apply on this platform; no sysctl changes are needed.')
  process.exit(0)
}

const current = printCurrent('Current inotify limits:')
const issues = findInotifyLimitIssues(current)

if (issues.length === 0) {
  console.log('Inotify limits already satisfy Open Mercato dev requirements.')
  await maybeUpdateVsCodeSettings()
  process.exit(0)
}

if (detectWsl()) {
  console.log('WSL detected; raising Linux inotify limits for Turbopack.')
} else {
  console.log('Raising Linux inotify limits for Turbopack.')
}

for (const command of buildManualInotifyFix()) {
  console.log(`  ${command}`)
}

if (!await confirm('Apply these sysctl changes now?', { defaultYes: true })) {
  console.log('No changes applied.')
  process.exit(1)
}

run('sudo', ['sysctl', '-w', ...buildSysctlAssignments(issues)])

if (!noPersist) {
  run('sudo', ['tee', PERSIST_PATH], {
    input: buildPersistentSysctlConfig(DEFAULT_INOTIFY_LIMITS),
  })
  run('sudo', ['sysctl', '--system'])
}

printCurrent('Updated inotify limits:')
await maybeUpdateVsCodeSettings()
