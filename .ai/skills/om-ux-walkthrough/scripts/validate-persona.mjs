#!/usr/bin/env node
// Persona frontmatter validator for om-ux-walkthrough.
// Usage:
//   node .ai/skills/om-ux-walkthrough/scripts/validate-persona.mjs <persona-id|path> [...]
//   node .ai/skills/om-ux-walkthrough/scripts/validate-persona.mjs --all
//   node .ai/skills/om-ux-walkthrough/scripts/validate-persona.mjs --self-test
// Exits non-zero on the first invalid persona so the skill aborts before the env boots.
//
// Parsing choices (deliberate, documented):
// - A leading UTF-8 BOM is stripped before frontmatter detection.
// - Duplicate frontmatter keys are an error (the key is named in the message).
// - Inline ` # ` comments in values ARE supported outside quotes (the schema examples in
//   .ai/qa/personas/AGENTS.md use them); a `#` inside a quoted string is content, not a comment.
// - Passing a directory is rejected with a clean message (no raw EISDIR stack).

import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const GLOBAL_HARD_CAP = 40
const TECH_FLUENCY = ['low', 'medium', 'high']
const REQUIRED_KEYS = ['id', 'name', 'age_band', 'tech_fluency', 'domain_knowledge', 'patience_budget', 'vocabulary']
const OPTIONAL_KEYS = ['goal_template']
const SYNTHETIC_FOOTER = 'Synthetic persona'

function repoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch {
    return process.cwd()
  }
}

function personasDir() {
  return join(repoRoot(), '.ai', 'qa', 'personas')
}

function parseScalar(raw) {
  const noComment = stripComment(raw).trim()
  if (
    (noComment.startsWith('"') && noComment.endsWith('"') && noComment.length >= 2) ||
    (noComment.startsWith("'") && noComment.endsWith("'") && noComment.length >= 2)
  ) {
    return noComment.slice(1, -1)
  }
  return noComment
}

function stripComment(raw) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i)
    }
  }
  return raw
}

function parseFrontmatter(content, errors) {
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1) // strip UTF-8 BOM before detection
  const lines = content.split(/\r?\n/)
  if (lines[0] !== '---') {
    errors.push('missing frontmatter: file must start with "---"')
    return { data: null, body: '' }
  }
  const end = lines.indexOf('---', 1)
  if (end === -1) {
    errors.push('unterminated frontmatter: closing "---" not found')
    return { data: null, body: '' }
  }
  const data = {}
  let currentListKey = null
  for (const line of lines.slice(1, end)) {
    if (stripComment(line).trim() === '') continue
    const listMatch = line.match(/^\s+-\s+(.*)$/)
    if (listMatch && currentListKey) {
      data[currentListKey].push(parseScalar(listMatch[1]))
      continue
    }
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (!kvMatch) {
      errors.push(`unparseable frontmatter line: ${JSON.stringify(line)}`)
      currentListKey = null
      continue
    }
    const [, key, rawValue] = kvMatch
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`duplicate frontmatter key: ${key}`)
      currentListKey = null
      continue
    }
    if (stripComment(rawValue).trim() === '') {
      data[key] = []
      currentListKey = key
    } else {
      data[key] = parseScalar(rawValue)
      currentListKey = null
    }
  }
  return { data, body: lines.slice(end + 1).join('\n') }
}

function validatePersonaFile(filePath) {
  const errors = []
  const warnings = []
  const fileName = basename(filePath)
  if (statSync(filePath).isDirectory()) {
    errors.push(`is a directory, not a persona file: ${filePath} (pass a persona id or a persona .md file path)`)
    return { errors, warnings }
  }
  const content = readFileSync(filePath, 'utf8')
  const { data, body } = parseFrontmatter(content, errors)
  if (!data) return { errors, warnings }

  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) errors.push(`missing required frontmatter key: ${key}`)
  }
  for (const key of Object.keys(data)) {
    if (!REQUIRED_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key)) {
      errors.push(`unknown frontmatter key: ${key} (allowed: ${[...REQUIRED_KEYS, ...OPTIONAL_KEYS].join(', ')})`)
    }
  }

  if (typeof data.id === 'string') {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.id)) {
      errors.push(`id must be kebab-case, got: ${JSON.stringify(data.id)}`)
    }
    if (fileName !== `${data.id}.md`) {
      errors.push(`id "${data.id}" must match filename "${fileName}" (expected ${data.id}.md)`)
    }
  }

  if ('tech_fluency' in data && !TECH_FLUENCY.includes(data.tech_fluency)) {
    errors.push(`tech_fluency must be one of ${TECH_FLUENCY.join(' | ')}, got: ${JSON.stringify(data.tech_fluency)}`)
  }

  if ('patience_budget' in data) {
    const budget = Number(data.patience_budget)
    if (!Number.isInteger(budget) || budget < 1) {
      errors.push(`patience_budget must be a positive integer, got: ${JSON.stringify(data.patience_budget)}`)
    } else if (budget > GLOBAL_HARD_CAP) {
      warnings.push(`patience_budget ${budget} exceeds the global hard cap (${GLOBAL_HARD_CAP} steps/run) and will be truncated by it`)
    }
  }

  for (const key of ['name', 'age_band', 'domain_knowledge']) {
    if (key in data && (typeof data[key] !== 'string' || data[key].trim() === '')) {
      errors.push(`${key} must be a non-empty string`)
    }
  }

  if ('vocabulary' in data) {
    if (!Array.isArray(data.vocabulary) || data.vocabulary.length === 0) {
      errors.push('vocabulary must be a non-empty list of strings')
    } else if (data.vocabulary.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
      errors.push('vocabulary entries must be non-empty strings')
    }
  }

  const bodyLines = body.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (bodyLines.length === 0) {
    errors.push('missing prose behavior brief (empty body after frontmatter)')
  }
  if (!body.includes(SYNTHETIC_FOOTER)) {
    errors.push('missing the standard synthetic-persona footer (see .ai/qa/personas/AGENTS.md)')
  }

  return { errors, warnings }
}

function resolveTarget(arg) {
  if (existsSync(arg)) return resolve(arg)
  const candidate = join(personasDir(), `${arg}.md`)
  if (existsSync(candidate)) return candidate
  return null
}

function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'validate-persona-selftest-'))
  const footer = '\n> Synthetic persona — an authored hypothesis about a user archetype, not a record of any real\n> person and not a substitute for real user research.\n'
  const validBody = (id, extraFm = '') => `---
id: ${id}                # inline comment: supported outside quotes
name: "Maria #1, staff accountant"
age_band: "45-55"
tech_fluency: low
domain_knowledge: "Accounting terms yes; this system: never seen it before."
${extraFm}patience_budget: 25
vocabulary:
  - "Says 'book an invoice', never 'create a sales document'."
---
Scans the left nav top to bottom before trying search.
${footer}`
  const cases = []
  const check = (name, fn) => cases.push({ name, fn })

  check('valid persona with inline comments and quoted # passes', () => {
    const p = join(dir, 'fixture-valid.md')
    writeFileSync(p, validBody('fixture-valid'))
    const { errors } = validatePersonaFile(p)
    return errors.length === 0 || `unexpected errors: ${errors.join('; ')}`
  })
  check('leading BOM is stripped before frontmatter detection', () => {
    const p = join(dir, 'fixture-bom.md')
    writeFileSync(p, '\ufeff' + validBody('fixture-bom'))
    const { errors } = validatePersonaFile(p)
    return errors.length === 0 || `unexpected errors: ${errors.join('; ')}`
  })
  check('duplicate frontmatter key is rejected and named', () => {
    const p = join(dir, 'fixture-dup.md')
    writeFileSync(p, validBody('fixture-dup', 'tech_fluency: high\n'))
    const { errors } = validatePersonaFile(p)
    return errors.some((e) => e.includes('duplicate frontmatter key: tech_fluency')) ||
      `expected a duplicate-key error naming tech_fluency, got: ${errors.join('; ') || '(none)'}`
  })
  check('directory argument fails with a clean message (no EISDIR throw)', () => {
    const p = join(dir, 'fixture-dir.md')
    mkdirSync(p)
    try {
      const { errors } = validatePersonaFile(p)
      return errors.some((e) => e.includes('is a directory')) ||
        `expected an is-a-directory error, got: ${errors.join('; ') || '(none)'}`
    } catch (err) {
      return `threw instead of reporting cleanly: ${err.message}`
    }
  })
  check('missing patience_budget is rejected', () => {
    const p = join(dir, 'fixture-nobudget.md')
    writeFileSync(p, validBody('fixture-nobudget').replace(/^patience_budget:.*\n/m, ''))
    const { errors } = validatePersonaFile(p)
    return errors.some((e) => e.includes('patience_budget')) ||
      `expected a missing patience_budget error, got: ${errors.join('; ') || '(none)'}`
  })

  let failed = false
  for (const { name, fn } of cases) {
    const result = fn()
    if (result === true) console.log(`PASS ${name}`)
    else {
      failed = true
      console.error(`FAIL ${name}: ${result}`)
    }
  }
  rmSync(dir, { recursive: true, force: true })
  if (failed) {
    console.error('validate-persona: self-test failed.')
    process.exit(1)
  }
  console.log('validate-persona: self-test passed.')
  process.exit(0)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: validate-persona.mjs <persona-id|path> [...] | --all | --self-test')
  process.exit(2)
}
if (args.includes('--self-test')) runSelfTest()

let targets = []
if (args.includes('--all')) {
  const dir = personasDir()
  if (!existsSync(dir)) {
    console.error(`validate-persona: personas directory not found: ${dir}`)
    process.exit(2)
  }
  targets = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'AGENTS.md')
    .map((name) => join(dir, name))
} else {
  for (const arg of args) {
    const target = resolveTarget(arg)
    if (!target) {
      console.error(`validate-persona: persona not found: ${arg} (looked for a file path and ${join(personasDir(), `${arg}.md`)})`)
      process.exit(1)
    }
    targets.push(target)
  }
}

const seenIds = new Set()
let failed = false
for (const target of targets) {
  const { errors, warnings } = validatePersonaFile(target)
  const id = basename(target, '.md')
  if (seenIds.has(id)) errors.push(`duplicate persona id: ${id}`)
  seenIds.add(id)
  for (const warning of warnings) console.warn(`WARN ${id}: ${warning}`)
  if (errors.length > 0) {
    failed = true
    for (const error of errors) console.error(`FAIL ${id}: ${error}`)
  } else {
    console.log(`OK   ${id}`)
  }
}

if (failed) {
  console.error('validate-persona: validation failed — the walkthrough must abort before the environment boots.')
  process.exit(1)
}
