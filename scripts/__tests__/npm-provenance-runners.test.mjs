import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

// npm verifies a sigstore provenance bundle against the runner that produced it and
// accepts only GitHub-hosted runners:
//
//   422 Unprocessable Entity — Error verifying sigstore provenance bundle:
//   Unsupported GitHub Actions runner environment: "self-hosted".
//   Only "github-hosted" runners are supported when publishing with provenance.
//
// Third-party runner fleets (Blacksmith, Namespace, Warpbuild, self-hosted metal) all
// register as `self-hosted`, so moving a publishing job onto one silently breaks every
// release until someone reads the log — which is what #5244 did to `Publish Snapshot`.
// This guard makes that a red unit test instead.

const WORKFLOWS_DIR = path.resolve('.github/workflows')
const SCRIPTS_DIR = path.resolve('scripts')
const GITHUB_HOSTED_RUNNER = /^(ubuntu|macos|windows)-/

function listFiles(dir, extensions) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
    .map((entry) => path.join(dir, entry.name))
}

/**
 * Scripts that reach `npm publish --provenance`, directly or by calling another script
 * that does. Resolved transitively so a new release wrapper is covered the day it is
 * added, without anyone remembering to update this list.
 */
function collectProvenancePublishers() {
  const scripts = listFiles(SCRIPTS_DIR, ['.sh', '.mjs', '.ts'])
  const sources = new Map(scripts.map((file) => [path.basename(file), fs.readFileSync(file, 'utf8')]))
  const publishers = new Set(
    [...sources].filter(([, source]) => /npm publish[^\n]*--provenance/.test(source)).map(([name]) => name),
  )

  for (;;) {
    const before = publishers.size
    for (const [name, source] of sources) {
      if (publishers.has(name)) continue
      if ([...publishers].some((publisher) => source.includes(publisher))) publishers.add(name)
    }
    if (publishers.size === before) return publishers
  }
}

function jobRunnerLabels(job) {
  const runsOn = job?.['runs-on']
  if (typeof runsOn === 'string') return [runsOn]
  if (Array.isArray(runsOn)) return runsOn.filter((label) => typeof label === 'string')
  return []
}

function jobRunsAnyOf(job, scriptNames) {
  return (job?.steps ?? []).some(
    (step) => typeof step?.run === 'string' && [...scriptNames].some((name) => step.run.includes(name)),
  )
}

test('every workflow job that publishes with provenance runs on a GitHub-hosted runner', () => {
  const publishers = collectProvenancePublishers()
  assert.ok(
    publishers.has('publish-packages.sh'),
    'Expected scripts/publish-packages.sh to be detected as a provenance publisher — the detection heuristic has drifted',
  )

  const offenders = []
  let publishingJobs = 0

  for (const workflowPath of listFiles(WORKFLOWS_DIR, ['.yml', '.yaml'])) {
    const workflow = parse(fs.readFileSync(workflowPath, 'utf8'))
    for (const [jobId, job] of Object.entries(workflow?.jobs ?? {})) {
      if (!jobRunsAnyOf(job, publishers)) continue
      publishingJobs += 1
      const labels = jobRunnerLabels(job)
      if (labels.length > 0 && labels.every((label) => GITHUB_HOSTED_RUNNER.test(label))) continue
      offenders.push(`${path.basename(workflowPath)} › ${jobId} (runs-on: ${labels.join(', ') || '<unset>'})`)
    }
  }

  assert.ok(publishingJobs > 0, 'Expected at least one workflow job to publish packages')
  assert.deepEqual(
    offenders,
    [],
    `npm rejects provenance from non-GitHub-hosted runners, so these publishing jobs would fail with a 422:\n  ${offenders.join('\n  ')}`,
  )
})

test('the publish script still requests provenance', () => {
  const publishScript = fs.readFileSync(path.join(SCRIPTS_DIR, 'publish-packages.sh'), 'utf8')

  assert.match(
    publishScript,
    /npm publish[^\n]*--provenance/,
    'Provenance is a supply-chain integrity control: fix the runner, never drop the flag',
  )
})
