#!/usr/bin/env node
import { parseFlags } from './lib/context.mjs'
import { build, down, initSecrets, lint, status, up } from './commands/stack.mjs'
import { restore, seed, snapshot, tenant, users } from './commands/data.mjs'
import { compare, report, run } from './commands/run.mjs'

const BOOLEAN_FLAGS = ['background', 'resume', 'force', 'volumes', 'purge-secrets', 'build', 'skip-fulltext', 'skip-query-index', 'yes-this-is-a-perf-target']

const USAGE = `Usage: perf/bin/perf <command> [options]

  init-secrets                     create perf/config/sut.local.env with generated secrets (never overwrites)
  build                            build the app image on the SUT (compose build app)
  up [--build]                     start the SUT stack and wait for /api/healthz through TLS
  down [--volumes] [--purge-secrets]
  status                           target, containers and state summary
  tenant [--email E]               create the measured tenant (mercato auth setup --json)
  users [--count 200 --admins 20]  provision staff users + team members through the API
  seed --tier T [--background] [--seed N] [--anchor YYYY-MM-DD] [--resume] [--partitions N] [--skip-query-index] [--skip-fulltext]
  snapshot --tier T                Postgres template + Meilisearch volume copy
  restore --tier T                 restore the snapshot before every load phase
  run <scenario> [--tier T] [--profile P] [--label L] [--samples N] [--knee N]
                                   scenarios: smoke baseline step stress soak interference browser
  report <run-dir> [--prom URL]
  compare <run-dir-a> <run-dir-b> [--force] [--out file.md]
  lint                             k6 inspect every scenario with the pinned image

The first command that touches a new target needs --yes-this-is-a-perf-target.
Runbook: perf/README.md`

const COMMANDS = {
  'init-secrets': () => initSecrets(),
  build: () => build(),
  up: (positional, flags) => up(flags),
  down: (positional, flags) => down(flags),
  status: () => status(),
  tenant: (positional, flags) => tenant(flags),
  users: (positional, flags) => users(flags),
  seed: (positional, flags) => seed(flags),
  snapshot: (positional, flags) => snapshot(flags),
  restore: (positional, flags) => restore(flags),
  run: (positional, flags) => run(positional, flags),
  report: (positional, flags) => report(positional, flags),
  compare: (positional, flags) => compare(positional, flags),
  lint: () => lint(),
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const handler = COMMANDS[command]
  if (!handler) {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}\n`)
    return 2
  }
  const { flags, positional } = parseFlags(rest, BOOLEAN_FLAGS)
  const result = await handler(positional, flags)
  return typeof result === 'number' ? result : 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(error.exitCode ?? 1)
  },
)
