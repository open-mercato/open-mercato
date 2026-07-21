#!/usr/bin/env node
// Persona frontmatter validator for om-ux-walkthrough.
// Usage:
//   node .ai/skills/om-ux-walkthrough/scripts/validate-persona.mjs <persona-id|path> [...]
//   node .ai/skills/om-ux-walkthrough/scripts/validate-persona.mjs --all
// Exits non-zero on the first invalid persona so the skill aborts before the env boots.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
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

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: validate-persona.mjs <persona-id|path> [...] | --all')
  process.exit(2)
}

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
