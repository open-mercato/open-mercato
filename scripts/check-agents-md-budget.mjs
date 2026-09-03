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
 * This script BLOCKS on two things (exit 1):
 *   1. A hard limit on the root `AGENTS.md` (budget minus a reserve for nested files).
 *   2. A ratchet on the representative root-to-module chains recorded in the baseline: when a
 *      chain already exceeds the budget, the nested (non-root) part of it may only shrink, so
 *      existing overflow cannot get worse. Chains still inside the budget are free to grow, and
 *      the root file is governed by rule 1 alone so ordinary root edits never trip the ratchet.
 *
 * It also reports ADVISORY findings, which print on every run but leave the exit code alone
 * unless `--strict` is passed:
 *   3. Headroom — the root file has reached `warnAtPercent` of its hard limit, so the next
 *      addition is likely to fail rule 1. (Without this the check is a cliff, not a gradient.)
 *   4. Per-file size — any single `AGENTS.md` in the repo has reached `warnAtPercent` of a limit
 *      in the baseline's `tools` table, whether or not it belongs to a ratcheted chain.
 *   5. Coverage — a workspace package or module directory that has no `AGENTS.md` and no entry
 *      in scripts/agents-md-coverage-allowlist.json.
 *
 * Usage:
 *   node scripts/check-agents-md-budget.mjs               # check (exit 1 on a blocking failure)
 *   node scripts/check-agents-md-budget.mjs --strict      # advisory findings fail too
 *   node scripts/check-agents-md-budget.mjs --json        # machine-readable report
 *   node scripts/check-agents-md-budget.mjs --update-baseline
 *   node scripts/check-agents-md-budget.mjs --root <dir>  # check another checkout
 *
 * Yarn shortcuts: `yarn agents:check-budget`, `yarn agents:check-budget:ci` (--strict)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')
const BASELINE_RELATIVE_PATH = 'scripts/agents-md-budget.baseline.json'
const INSTRUCTION_FILE = 'AGENTS.md'
const DEFAULT_WARN_AT_PERCENT = 90
const TOKEN_UNITS = new Set(['bytes', 'tokens'])

/**
 * Bytes per token. A deliberate estimate, not a tokenizer: every other scanner under
 * `scripts/` is dependency-free and deterministic, and a token figure is only ever used to
 * raise a warning, never to fail the build. Anything derived from this is labelled "est.".
 */
const ESTIMATED_BYTES_PER_TOKEN = 4

export function estimateTokens(bytes) {
  return Math.ceil(bytes / ESTIMATED_BYTES_PER_TOKEN)
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, updateBaseline: false, json: false, strict: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--update-baseline') options.updateBaseline = true
    else if (arg === '--json') options.json = true
    else if (arg === '--strict') options.strict = true
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
  validateWarnAtPercent(baseline)
  validateTools(baseline)
  return { baseline, baselinePath }
}

/**
 * `warnAtPercent` and `tools` are optional so a baseline written before advisory warnings
 * existed still loads: an absent `tools` table simply yields no tool evaluations, and the
 * blocking rules keep working untouched.
 */
function validateWarnAtPercent(baseline) {
  if (baseline.warnAtPercent === undefined) return
  const percent = baseline.warnAtPercent
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new Error(`${BASELINE_RELATIVE_PATH} warnAtPercent must be a number in (0, 100]`)
  }
}

function validateTools(baseline) {
  if (baseline.tools === undefined) return
  if (typeof baseline.tools !== 'object' || baseline.tools === null || Array.isArray(baseline.tools)) {
    throw new Error(`${BASELINE_RELATIVE_PATH} tools must be an object keyed by tool name`)
  }
  for (const [name, tool] of Object.entries(baseline.tools)) {
    if (typeof tool !== 'object' || tool === null) {
      throw new Error(`${BASELINE_RELATIVE_PATH} tools.${name} must be an object`)
    }
    if (!TOKEN_UNITS.has(tool.unit)) {
      throw new Error(`${BASELINE_RELATIVE_PATH} tools.${name}.unit must be "bytes" or "tokens"`)
    }
    if (typeof tool.limit !== 'number' || !Number.isFinite(tool.limit) || tool.limit <= 0) {
      throw new Error(`${BASELINE_RELATIVE_PATH} tools.${name}.limit must be a positive number`)
    }
    if (typeof tool.source !== 'string' || tool.source.trim() === '') {
      throw new Error(
        `${BASELINE_RELATIVE_PATH} tools.${name}.source must cite where the limit comes from ` +
          '(a vendor doc, or an explicit note that it is a project policy budget)',
      )
    }
  }
}

export function warnAtPercentOf(baseline) {
  return baseline.warnAtPercent ?? DEFAULT_WARN_AT_PERCENT
}

function fileBytes(absolutePath) {
  if (!fs.existsSync(absolutePath)) return null
  return fs.statSync(absolutePath).size
}

/**
 * Directories that never hold first-party instruction files: dependency and build output, plus
 * the official-modules submodule (its own repository, with its own guidance) and the create-app
 * template root (governed by packages/create-app/src/lib/agent-instruction-budget.test.ts).
 */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', '.next', '.mercato', '.turbo'])
const SKIPPED_RELATIVE_PATHS = new Set(['external', 'packages/create-app/template'])

function isSkippedDirectory(name, relativePath) {
  return SKIPPED_DIRECTORIES.has(name) || SKIPPED_RELATIVE_PATHS.has(relativePath)
}

/**
 * Every first-party AGENTS.md in the checkout, sorted by path. The root file is excluded: it has
 * its own hard limit and its own dedicated headroom warning, so including it here would report
 * the same file twice.
 */
export function collectInstructionFiles(root) {
  const found = []
  const walk = (absoluteDir, relativeDir) => {
    let entries
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (isSkippedDirectory(entry.name, relativePath)) continue
        walk(path.join(absoluteDir, entry.name), relativePath)
      } else if (entry.isFile() && entry.name === INSTRUCTION_FILE && relativeDir) {
        found.push({ path: relativePath, bytes: fileBytes(path.join(absoluteDir, entry.name)) })
      }
    }
  }
  walk(root, '')
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * Measure `bytes` against every configured tool limit. Token limits are compared against an
 * estimate (see ESTIMATED_BYTES_PER_TOKEN), which is why the result carries the unit.
 */
export function evaluateAgainstTools(baseline, bytes) {
  const tools = baseline.tools ?? {}
  return Object.keys(tools)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => {
      const tool = tools[name]
      const value = tool.unit === 'tokens' ? estimateTokens(bytes) : bytes
      return {
        tool: name,
        unit: tool.unit,
        limit: tool.limit,
        enforced: tool.enforced === true,
        value,
        percent: Math.round((value / tool.limit) * 100),
      }
    })
}

function describeUsage(evaluation) {
  const estimate = evaluation.unit === 'tokens' ? ' est.' : ''
  const singularUnit = evaluation.unit === 'tokens' ? 'token' : 'byte'
  const kind = evaluation.enforced ? 'hard limit' : 'policy budget'
  return (
    `${evaluation.value}${estimate} ${evaluation.unit} = ${evaluation.percent}% of ${evaluation.tool}'s ` +
    `${evaluation.limit}-${singularUnit} ${kind}`
  )
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

  const warnAtPercent = warnAtPercentOf(baseline)
  const files = collectInstructionFiles(root).map((file) => ({
    ...file,
    evaluations: evaluateAgainstTools(baseline, file.bytes),
  }))
  const warnings = [
    ...collectRootHeadroomWarnings(baseline, rootBytes, warnAtPercent),
    ...collectFileSizeWarnings(files, warnAtPercent),
  ]

  return { rootBytes, chains, files, warnings, warnAtPercent, failures }
}

/**
 * The root file is governed by `rootMaxBytes`, so its headroom is measured against that limit
 * rather than the tools table — this is the warning that fires before a root edit turns CI red.
 */
function collectRootHeadroomWarnings(baseline, rootBytes, warnAtPercent) {
  if (rootBytes > baseline.rootMaxBytes) return []
  const percent = Math.round((rootBytes / baseline.rootMaxBytes) * 100)
  if (percent < warnAtPercent) return []
  return [
    {
      kind: 'root-headroom',
      subject: INSTRUCTION_FILE,
      message:
        `${INSTRUCTION_FILE} is ${rootBytes} bytes — ${percent}% of its ${baseline.rootMaxBytes}-byte limit, ` +
        `with only ${baseline.rootMaxBytes - rootBytes} bytes free. The next addition is likely to fail the ` +
        'hard limit: move long-form prose into a referenced doc (.ai/docs/*) before adding to it.',
    },
  ]
}

/**
 * A single nested file large enough to eat most of an agent's whole budget starves everything
 * loaded after it, even when the chain it belongs to is not one of the ratcheted ones.
 */
function collectFileSizeWarnings(files, warnAtPercent) {
  const warnings = []
  for (const file of files) {
    for (const evaluation of file.evaluations) {
      if (evaluation.percent < warnAtPercent) continue
      warnings.push({
        kind: 'file-size',
        subject: file.path,
        message:
          `${file.path} is ${file.bytes} bytes — ${describeUsage(evaluation)}. ` +
          'A single instruction file this large crowds out everything loaded after it; split the ' +
          'long-form parts into a referenced doc.',
      })
    }
  }
  return warnings
}

function formatReport(baseline, result) {
  const lines = []
  const headroom = baseline.rootMaxBytes - result.rootBytes
  lines.push(
    `${INSTRUCTION_FILE}: ${result.rootBytes} bytes / ${baseline.rootMaxBytes} limit ` +
      `(${headroom >= 0 ? `${headroom} bytes free` : `${-headroom} bytes over`}; agent budget ${baseline.budgetBytes}; ` +
      `~${estimateTokens(result.rootBytes)} est. tokens).`,
  )
  for (const chain of result.chains) {
    const status = chain.overflowBytes > 0 ? `OVER by ${chain.overflowBytes} bytes` : 'within budget'
    const drift = chain.grewBy === 0 ? '' : chain.grewBy > 0 ? ` +${chain.grewBy} vs baseline` : ` ${chain.grewBy} vs baseline`
    lines.push(
      `  chain ${chain.chainDir}: ${chain.bytes} bytes across ${chain.files.length} file(s) ` +
        `(~${estimateTokens(chain.bytes)} est. tokens) — ${status}${drift}`,
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

/**
 * Advisory findings print on every run but only change the exit code under `--strict`, so the
 * new checks can be adopted before they start blocking. See .ai/docs/agent-instructions.md.
 */
function formatWarnings(result, strict) {
  if (result.warnings.length === 0) return ''
  const lines = ['', `Advisory findings (${result.warnings.length}), at or above ${result.warnAtPercent}% of a limit:`]
  for (const warning of result.warnings) lines.push(`  - [${warning.kind}] ${warning.message}`)
  lines.push(
    strict
      ? 'Strict mode: advisory findings fail the run.'
      : 'Advisory only — exit code unchanged. Run with --strict (yarn agents:check-budget:ci) to fail on these.',
  )
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
    console.log('Usage: node scripts/check-agents-md-budget.mjs [--strict] [--update-baseline] [--json] [--root <dir>]')
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
    const warningReport = formatWarnings(result, options.strict)
    if (warningReport) console.log(warningReport)
  }

  if (result.failures.length > 0) {
    console.error('\nAgent instruction budget check failed:')
    for (const failure of result.failures) console.error(`  - ${failure}`)
    console.error('\nWhy this matters: .ai/docs/agent-instructions.md')
    process.exit(1)
  }

  if (options.strict && result.warnings.length > 0) {
    console.error(`\nAgent instruction budget check failed in strict mode: ${result.warnings.length} advisory finding(s).`)
    for (const warning of result.warnings) console.error(`  - [${warning.kind}] ${warning.message}`)
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
