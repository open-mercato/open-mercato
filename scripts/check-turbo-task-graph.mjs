/**
 * Turbo Task-Graph Guard
 *
 * `turbo run <task> [filters]` exits 0 when the resolved graph contains no
 * runnable script, so a filter or a renamed script can silently turn a CI gate
 * into a no-op. That is how the `lint` job stopped running ESLint entirely
 * (issue #4472): `--filter=!@open-mercato/app` excluded the only workspace that
 * defines a `lint` script, leaving 23 `<NONEXISTENT>` commands and a green job.
 *
 * This guard asks turbo for the dry-run graph and fails when the task resolves
 * to zero executable commands.
 *
 * Usage:
 *   node scripts/check-turbo-task-graph.mjs lint
 *   node scripts/check-turbo-task-graph.mjs test --filter=./packages/*
 *
 * Exit code: 0 when at least one workspace runs a real command, 1 otherwise
 * (or when turbo itself fails).
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProjectBinary, resolveSpawnCommand } from './dev-spawn-utils.mjs'

export const NONEXISTENT_COMMAND = '<NONEXISTENT>'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function parseTurboDryRun(stdout) {
  const text = String(stdout ?? '')
  const start = text.indexOf('{')
  if (start === -1) {
    throw new Error('Turbo dry-run produced no JSON output.')
  }

  return JSON.parse(text.slice(start))
}

export function collectExecutableTasks(dryRun) {
  const tasks = Array.isArray(dryRun?.tasks) ? dryRun.tasks : []

  return tasks.filter((task) => {
    const command = typeof task?.command === 'string' ? task.command.trim() : ''
    return command !== '' && command !== NONEXISTENT_COMMAND
  })
}

function runTurboDryRun(turboArgs) {
  const turboBinary = resolveProjectBinary('turbo', { cwd: ROOT })
  const resolvedSpawn = resolveSpawnCommand(turboBinary, [...turboArgs, '--dry=json'])

  return spawnSync(resolvedSpawn.command, resolvedSpawn.args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...resolvedSpawn.spawnOptions,
  })
}

function main() {
  const [task, ...passthroughArgs] = process.argv.slice(2)
  if (!task) {
    console.error('Usage: node scripts/check-turbo-task-graph.mjs <task> [turbo args...]')
    process.exit(1)
  }

  const turboArgs = ['run', task, ...passthroughArgs]
  const printableCommand = `turbo ${turboArgs.join(' ')}`
  const result = runTurboDryRun(turboArgs)

  if (result.error) {
    console.error(`Failed to run \`${printableCommand} --dry=json\`: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`\`${printableCommand} --dry=json\` exited with code ${result.status}.`)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  let dryRun
  try {
    dryRun = parseTurboDryRun(result.stdout)
  } catch (error) {
    console.error(`Could not read the task graph of \`${printableCommand}\`: ${error.message}`)
    process.exit(1)
  }

  const executableTasks = collectExecutableTasks(dryRun)
  if (executableTasks.length === 0) {
    const scopedPackages = Array.isArray(dryRun?.packages) ? dryRun.packages.length : 0
    console.error(`\`${printableCommand}\` resolves to zero executable commands.`)
    console.error(
      `${scopedPackages} package(s) are in scope but none of them defines a \`${task}\` script, so the command would exit 0 without doing any work.`,
    )
    console.error(`Add a \`${task}\` script to the packages that should run it, or fix the turbo filters.`)
    process.exit(1)
  }

  const taskIds = executableTasks.map((entry) => entry.taskId ?? `${entry.package}#${entry.task}`)
  console.log(`\`${printableCommand}\` runs ${executableTasks.length} command(s): ${taskIds.join(', ')}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main()
}
