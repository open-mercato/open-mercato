#!/usr/bin/env node
/**
 * Agent instruction-budget checker.
 *
 * Coding agents concatenate `AGENTS.md` from the repository root down to the working
 * directory and stop once the COMBINED size reaches their project-instruction budget
 * (Codex: `project_doc_max_bytes`, default 32,768 bytes). Everything past that byte offset
 * is dropped silently, so an oversized root file hides the tail of the harness from every
 * agent and starves the nested files of budget.
 *
 * This script enforces two things:
 *   1. A hard limit on the root `AGENTS.md` (budget minus a reserve for nested files).
 *   2. A ratchet on the representative root-to-module chains recorded in the baseline: when a
 *      chain already exceeds the budget, the nested (non-root) part of it may only shrink, so
 *      existing overflow cannot get worse. Chains still inside the budget are free to grow, and
 *      the root file is governed by rule 1 alone so ordinary root edits never trip the ratchet.
 *
 * Usage:
 *   node scripts/check-agents-md-budget.mjs               # check (exit 1 on failure)
 *   node scripts/check-agents-md-budget.mjs --json        # machine-readable report
 *   node scripts/check-agents-md-budget.mjs --update-baseline
 *   node scripts/check-agents-md-budget.mjs --root <dir>  # check another checkout
 *
 * Yarn shortcut: `yarn agents:check-budget`
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')
const BASELINE_RELATIVE_PATH = 'scripts/agents-md-budget.baseline.json'
const INSTRUCTION_FILE = 'AGENTS.md'

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, updateBaseline: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--update-baseline') options.updateBaseline = true
    else if (arg === '--json') options.json = true
    else if (arg === '--root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--root requires a directory path')
      options.root = path.resolve(value)
      index += 1
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function readBaseline(root) {
  const baselinePath = path.join(root, BASELINE_RELATIVE_PATH)
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Missing baseline file: ${BASELINE_RELATIVE_PATH}`)
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  if (typeof baseline.budgetBytes !== 'number' || typeof baseline.rootMaxBytes !== 'number') {
    throw new Error(`${BASELINE_RELATIVE_PATH} must define numeric budgetBytes and rootMaxBytes`)
  }
  if (!baseline.chains || typeof baseline.chains !== 'object') {
    throw new Error(`${BASELINE_RELATIVE_PATH} must define a chains object`)
  }
  return { baseline, baselinePath }
}

function fileBytes(absolutePath) {
  if (!fs.existsSync(absolutePath)) return null
  return fs.statSync(absolutePath).size
}

/**
 * The instruction files an agent started in `chainDir` loads, root-first.
 */
export function collectChainFiles(root, chainDir) {
  const segments = chainDir === '.' ? [] : chainDir.split('/').filter(Boolean)
  const files = []
  for (let depth = 0; depth <= segments.length; depth += 1) {
    const relativeDir = segments.slice(0, depth).join('/')
    const relativePath = relativeDir ? `${relativeDir}/${INSTRUCTION_FILE}` : INSTRUCTION_FILE
    const bytes = fileBytes(path.join(root, relativePath))
    if (bytes !== null) files.push({ path: relativePath, bytes })
  }
  return files
}

export function analyze(root, baseline) {
  const rootBytes = fileBytes(path.join(root, INSTRUCTION_FILE))
  if (rootBytes === null) throw new Error(`Missing ${INSTRUCTION_FILE} in ${root}`)

  const chains = Object.keys(baseline.chains)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((chainDir) => {
      const files = collectChainFiles(root, chainDir)
      const bytes = files.reduce((total, file) => total + file.bytes, 0)
      const nestedBytes = bytes - rootBytes
      const baselineNestedBytes = baseline.chains[chainDir]
      return {
        chainDir,
        files,
        bytes,
        nestedBytes,
        baselineNestedBytes,
        overflowBytes: Math.max(0, bytes - baseline.budgetBytes),
        grewBy: typeof baselineNestedBytes === 'number' ? nestedBytes - baselineNestedBytes : 0,
      }
    })

  const failures = []
  if (rootBytes > baseline.rootMaxBytes) {
    failures.push(
      `${INSTRUCTION_FILE} is ${rootBytes} bytes — over the ${baseline.rootMaxBytes}-byte root limit ` +
        `(${baseline.budgetBytes}-byte agent budget minus the reserve for nested AGENTS.md files). ` +
        'Move long-form procedure into a referenced doc (.ai/docs/*) and link to it.',
    )
  }
  for (const chain of chains) {
    if (chain.overflowBytes > 0 && chain.grewBy > 0) {
      failures.push(
        `Instruction chain for ${chain.chainDir} is already ${chain.overflowBytes} bytes over the ` +
          `${baseline.budgetBytes}-byte agent budget, and its nested AGENTS.md files grew to ` +
          `${chain.nestedBytes} bytes (baseline ${chain.baselineNestedBytes}, +${chain.grewBy}). ` +
          'An over-budget chain may only shrink: ' +
          'move detail out of the files in the chain, or re-record deliberately with ' +
          '`yarn agents:check-budget --update-baseline` and explain it in the PR.',
      )
    }
  }

  return { rootBytes, chains, failures }
}

function formatReport(baseline, result) {
  const lines = []
  const headroom = baseline.rootMaxBytes - result.rootBytes
  lines.push(
    `${INSTRUCTION_FILE}: ${result.rootBytes} bytes / ${baseline.rootMaxBytes} limit ` +
      `(${headroom >= 0 ? `${headroom} bytes free` : `${-headroom} bytes over`}; agent budget ${baseline.budgetBytes}).`,
  )
  for (const chain of result.chains) {
    const status = chain.overflowBytes > 0 ? `OVER by ${chain.overflowBytes} bytes` : 'within budget'
    const drift = chain.grewBy === 0 ? '' : chain.grewBy > 0 ? ` +${chain.grewBy} vs baseline` : ` ${chain.grewBy} vs baseline`
    lines.push(
      `  chain ${chain.chainDir}: ${chain.bytes} bytes across ${chain.files.length} file(s) — ${status}${drift}`,
    )
    if (chain.overflowBytes > 0) {
      const last = chain.files[chain.files.length - 1]
      lines.push(
        `    → an agent started here loses the last ${chain.overflowBytes} bytes of the chain (tail of ${last.path}).`,
      )
    }
  }
  return lines.join('\n')
}

function writeBaseline(baselinePath, baseline, result) {
  const chains = {}
  for (const chain of result.chains) chains[chain.chainDir] = chain.nestedBytes
  const next = { ...baseline, chains }
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(String(error.message ?? error))
    process.exit(2)
  }

  if (options.help) {
    console.log('Usage: node scripts/check-agents-md-budget.mjs [--update-baseline] [--json] [--root <dir>]')
    return
  }

  let baseline
  let baselinePath
  let result
  try {
    ;({ baseline, baselinePath } = readBaseline(options.root))
    result = analyze(options.root, baseline)
  } catch (error) {
    console.error(`agents:check-budget failed: ${String(error.message ?? error)}`)
    process.exit(2)
  }

  if (options.updateBaseline) {
    writeBaseline(baselinePath, baseline, result)
    console.log(formatReport(baseline, result))
    console.log(`Baseline re-recorded in ${BASELINE_RELATIVE_PATH}.`)
    if (result.rootBytes > baseline.rootMaxBytes) {
      console.error(`Root ${INSTRUCTION_FILE} is still over the hard limit — the baseline does not waive it.`)
      process.exit(1)
    }
    return
  }

  if (options.json) {
    console.log(JSON.stringify({ ...result, budgetBytes: baseline.budgetBytes, rootMaxBytes: baseline.rootMaxBytes }, null, 2))
  } else {
    console.log(formatReport(baseline, result))
  }

  if (result.failures.length > 0) {
    console.error('\nAgent instruction budget check failed:')
    for (const failure of result.failures) console.error(`  - ${failure}`)
    console.error('\nWhy this matters: .ai/docs/agent-instructions.md')
    process.exit(1)
  }

  const shrunk = result.chains.filter((chain) => chain.grewBy < 0 && chain.overflowBytes > 0)
  if (shrunk.length > 0) {
    console.log(
      `\n${shrunk.length} chain(s) are now smaller than the baseline. Run ` +
        '`yarn agents:check-budget --update-baseline` to tighten the ratchet.',
    )
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
