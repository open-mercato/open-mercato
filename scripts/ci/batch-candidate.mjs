#!/usr/bin/env node
// Decides whether a pull request into `main` is a batch candidate: a PR that only
// ever reaches `main` through a daily batch branch, so `ci.yml` runs the fast gate
// for it instead of the full suite. Routing rules live in .github/batch-candidates.json;
// the process is described in .ai/docs/batch-branches.md.
//
//   classify      used by ci.yml → outputs candidate, force_full
//   label-change  used by ci-label-rerun.yml → outputs rerun (a label change turned a
//                 candidate into a full-suite PR, so its last ci.yml run must be redone)
//
// Inputs come from the environment so the workflows stay free of routing logic.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/batch-candidates.json')

export function loadConfig(configPath = defaultConfigPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

const defaultWorkflowPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/ci.yml')

export function readFullSuitePattern(workflowPath = defaultWorkflowPath) {
  const match = fs.readFileSync(workflowPath, 'utf8').match(/^  FULL_SUITE_PATTERN: '(.*)'$/m)
  if (!match) throw new Error(`[internal] FULL_SUITE_PATTERN not found in ${workflowPath}`)
  return match[1].replaceAll("''", "'")
}

function sameLogin(left, right) {
  return left.toLowerCase() === right.toLowerCase()
}

export function classify({
  config,
  eventName,
  baseRef,
  author = '',
  sameRepo,
  labels = [],
  changedFiles = [],
  fullSuitePattern = '',
  forceFullSuite = false,
}) {
  const isPullRequest = eventName === 'pull_request'
  const forceFull = forceFullSuite || (isPullRequest && sameRepo && labels.includes(config.forceFullLabel))
  const decide = (candidate, reason) => ({ candidate, forceFull, reason })

  if (!isPullRequest) return decide(false, `event ${eventName} always runs the full workflow`)
  if (forceFull) return decide(false, 'full suite forced (ci-full label, stabilize/ or batch/ head)')
  if (baseRef !== config.baseBranch) return decide(false, `base ${baseRef} is not ${config.baseBranch}`)
  if (!sameRepo) return decide(false, 'fork pull requests are never batch candidates')

  if (config.candidateLabel) {
    if (!labels.includes(config.candidateLabel)) return decide(false, `no ${config.candidateLabel} label`)
  } else if (!config.authors.some((login) => sameLogin(login, author))) {
    return decide(false, `author ${author} is not a batch-candidate author`)
  }

  const excludedLabel = labels.find((label) => config.excludedLabels.includes(label))
  if (excludedLabel) return decide(false, `excluded label ${excludedLabel}`)

  const pathPatterns = [fullSuitePattern, ...config.excludedPathPatterns].filter(Boolean).map((pattern) => new RegExp(pattern))
  const excludedFile = changedFiles.find((file) => pathPatterns.some((pattern) => pattern.test(file)))
  if (excludedFile) return decide(false, `touches full-suite path ${excludedFile}`)

  return decide(true, 'batch candidate: fast gate only while it targets main')
}

// Only upgrades trigger a rerun (candidate → full suite). A downgrade would replace
// existing full-suite results with skipped checks, which branch protection reads as
// passing; it takes effect on the next push instead.
export function shouldRerunAfterLabelChange({ action, label, labels = [], ...input }) {
  const before = action === 'labeled'
    ? labels.filter((name) => name !== label)
    : [...labels.filter((name) => name !== label), label]
  const previous = classify({ ...input, labels: before })
  const current = classify({ ...input, labels })
  return { rerun: previous.candidate && !current.candidate, previous, current }
}

function readList(value) {
  return (value ?? '').split('\n').map((entry) => entry.trim()).filter(Boolean)
}

function inputFromEnv(env) {
  return {
    config: loadConfig(env.BATCH_CANDIDATES_CONFIG || defaultConfigPath),
    eventName: env.EVENT_NAME ?? '',
    baseRef: env.BASE_REF ?? '',
    author: env.PR_AUTHOR ?? '',
    sameRepo: env.SAME_REPO === 'true',
    labels: readList(env.PR_LABELS),
    changedFiles: env.CHANGED_FILES_PATH ? readList(fs.readFileSync(env.CHANGED_FILES_PATH, 'utf8')) : [],
    fullSuitePattern: env.FULL_SUITE_PATTERN || readFullSuitePattern(),
    forceFullSuite: env.FORCE_FULL_SUITE === 'true',
  }
}

function writeOutputs(env, outputs) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n')
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${lines}\n`)
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const mode = argv[0]
  const input = inputFromEnv(env)
  if (mode === 'classify') {
    const result = classify(input)
    console.log(`candidate=${result.candidate} force_full=${result.forceFull}: ${result.reason}`)
    writeOutputs(env, { candidate: result.candidate, force_full: result.forceFull })
    return result
  }
  if (mode === 'label-change') {
    const result = shouldRerunAfterLabelChange({ ...input, action: env.LABEL_ACTION, label: env.LABEL_NAME })
    console.log(`before: ${result.previous.reason}\nafter: ${result.current.reason}\nrerun=${result.rerun}`)
    writeOutputs(env, { rerun: result.rerun })
    return result
  }
  throw new Error(`[internal] unknown mode ${mode}; expected classify or label-change`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
