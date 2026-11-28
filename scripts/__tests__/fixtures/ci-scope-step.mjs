import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

export const REPOSITORY = 'open-mercato/open-mercato'
export const FULL_SHARDS = Array.from({ length: 15 }, (_, index) => `${index + 1}/15`)

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const workflow = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8'))
export const scopeStep = workflow.jobs.prepare.steps.find((step) => step.id === 'integration-scope')

const STUBS = String.raw`
git() {
  printf 'git %s\n' "$*" >> "$STUB_CALLS"
  case "$1" in
    diff)
      if [ "$STUB_DIFF_FAILS" = "true" ]; then return 99; fi
      printf '%s\n' "$STUB_CHANGED"
      ;;
    cat-file)
      case "$3" in
        *:*) [ "$STUB_SCOPE_RULES_AT_BASE" = "true" ] ;;
        *'^{commit}') [ "$STUB_BASE_COMMIT_PRESENT" = "true" ] ;;
        *) return 97 ;;
      esac
      ;;
    fetch) [ "$STUB_FETCH_FAILS" != "true" ] || return 128 ;;
    rev-parse) echo default-branch-tip ;;
    show) cat "$STUB_REPO_ROOT/$(printf '%s' "$2" | cut -d: -f2-)" ;;
    *) return 98 ;;
  esac
}
gh() {
  printf 'gh %s\n' "$*" >> "$STUB_CALLS"
  printf '%s\n' "$STUB_LABELS"
}
`

function readKeyValues(file) {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

export function runCiScopeStep({
  eventName = 'pull_request',
  changedFiles = [],
  labels = [],
  headRef = 'fix/example',
  baseRef = 'main',
  headRepo = REPOSITORY,
  scopeRulesAtBase = true,
  baseCommitPresent = true,
  fetchFails = false,
  diffFails = false,
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-scope-step-'))
  try {
    const runnerTemp = path.join(directory, 'runner-temp')
    fs.mkdirSync(runnerTemp)
    const output = path.join(directory, 'output')
    const summary = path.join(directory, 'summary')
    const calls = path.join(directory, 'calls')
    fs.writeFileSync(calls, '')
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', `${STUBS}\n${scopeStep.run}`], {
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        EVENT_NAME: eventName,
        GH_TOKEN: 'test-token',
        REPOSITORY,
        DEFAULT_BRANCH: 'main',
        PR_NUMBER: eventName === 'pull_request' ? '4242' : '',
        BASE_SHA: eventName === 'pull_request' ? 'base-sha' : '',
        BASE_REF: eventName === 'pull_request' ? baseRef : '',
        HEAD_REF: eventName === 'pull_request' ? headRef : '',
        HEAD_REPO: eventName === 'pull_request' ? headRepo : '',
        STUB_CALLS: calls,
        STUB_CHANGED: changedFiles.join('\n'),
        STUB_LABELS: labels.join('\n'),
        STUB_SCOPE_RULES_AT_BASE: String(scopeRulesAtBase),
        STUB_DIFF_FAILS: String(diffFails),
        STUB_BASE_COMMIT_PRESENT: String(baseCommitPresent),
        STUB_FETCH_FAILS: String(fetchFails),
        STUB_REPO_ROOT: repoRoot,
      },
      encoding: 'utf8',
      timeout: 20000,
    })
    const values = readKeyValues(output)
    const full = values.shard_matrix !== undefined && JSON.stringify(JSON.parse(values.shard_matrix)) === JSON.stringify(FULL_SHARDS)
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      values,
      full,
      summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '',
      calls: fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
