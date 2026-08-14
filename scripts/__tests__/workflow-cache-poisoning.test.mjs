import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

// CodeQL rule `actions/cache-poisoning/direct-cache` (high severity), reproduced as a
// unit test so the alert cannot come back without a red check first.
//
// A workflow triggered only by `schedule`/`workflow_dispatch`/`push` always runs in the
// *default branch's* privileged context and writes to the default branch's cache scope.
// When such a workflow also checks out some *other* explicit ref, whatever it produces
// from that ref lands under a cache key any workflow on any branch can restore — the
// poisoning path. Restoring is fine; only saving is the sink.
//
// Workflows that also accept `pull_request` are deliberately out of scope: GitHub
// isolates a pull request's cache writes to that PR's own scope, so the same shape is
// not the same risk (see the `mutate` job in mutation-tests.yml).

const WORKFLOWS_DIR = path.resolve('.github/workflows')
const PRIVILEGED_TRIGGERS = new Set(['schedule', 'workflow_dispatch', 'push'])
// Any vendor's cache action, not just `actions/cache`: the runner fleets this repo uses
// ship drop-in replacements (`useblacksmith/cache`, `runs-on/cache`) that write to the
// same Actions cache scope, so matching only the GitHub-published action would let a
// one-word swap slip the guard.
const CACHE_WRITING_ACTIONS = [/^[\w.-]+\/cache@/, /^[\w.-]+\/cache\/save@/]

function listWorkflows() {
  return fs
    .readdirSync(WORKFLOWS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => path.join(WORKFLOWS_DIR, entry.name))
}

function triggerNames(workflow) {
  // `on` is parsed as the boolean `true` by YAML 1.1-style keys; the `yaml` package
  // keeps it as the string 'on', but accept both so a reformat cannot silently
  // disable this guard.
  const triggers = workflow?.on ?? workflow?.true
  if (typeof triggers === 'string') return [triggers]
  if (Array.isArray(triggers)) return triggers
  return Object.keys(triggers ?? {})
}

function runsOnlyInPrivilegedContext(workflow) {
  const triggers = triggerNames(workflow)
  return triggers.length > 0 && triggers.every((trigger) => PRIVILEGED_TRIGGERS.has(trigger))
}

function explicitCheckoutRefs(job) {
  return (job?.steps ?? [])
    .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout@'))
    .map((step) => step?.with?.ref)
    .filter((ref) => typeof ref === 'string' && ref.length > 0)
}

function cacheWritingSteps(job) {
  return (job?.steps ?? [])
    .map((step) => step?.uses)
    .filter((uses) => typeof uses === 'string' && CACHE_WRITING_ACTIONS.some((pattern) => pattern.test(uses)))
}

test('privileged-context workflows never write an Actions cache from a non-default checkout', () => {
  const offenders = []
  let inspectedJobs = 0

  for (const workflowPath of listWorkflows()) {
    const workflow = parse(fs.readFileSync(workflowPath, 'utf8'))
    if (!runsOnlyInPrivilegedContext(workflow)) continue

    for (const [jobId, job] of Object.entries(workflow?.jobs ?? {})) {
      inspectedJobs += 1
      const refs = explicitCheckoutRefs(job)
      const writes = cacheWritingSteps(job)
      if (refs.length === 0 || writes.length === 0) continue
      offenders.push(`${path.basename(workflowPath)} › ${jobId}: checks out ${refs.join(', ')} and saves a cache via ${writes.join(', ')}`)
    }
  }

  assert.ok(
    inspectedJobs > 0,
    'No workflow was classified as privileged-context-only — the trigger parsing has drifted and this guard is inspecting nothing',
  )
  assert.deepEqual(
    offenders,
    [],
    `Use actions/cache/restore@… instead — saving here poisons the default branch's cache scope:\n  ${offenders.join('\n  ')}`,
  )
})

test('the scheduled dependency audit restores its Yarn cache without saving one', () => {
  const auditWorkflow = fs.readFileSync(path.join(WORKFLOWS_DIR, 'audit.yml'), 'utf8')

  assert.match(auditWorkflow, /uses: actions\/cache\/restore@/, 'The audit should still restore package downloads')
  assert.doesNotMatch(
    auditWorkflow,
    /uses: actions\/cache@/,
    'The audit checks out develop and main from the default branch context, so it must never save a cache',
  )
})
