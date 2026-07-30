/**
 * `yarn ds:mockups:promote <slug> [--entity <name>] [--module <id>] [--execute]`
 * — bridges a REVIEWED mockup into `mercato module scaffold --with-ui`
 * input (spec `.ai/specs/2026-07-05-ds-live-mockup-composer.md`, Phase 3).
 *
 * Prints the complete derived scaffold command (the tested contract). It
 * EXECUTES the command only when `--execute` is passed AND the `module
 * scaffold` subcommand actually exists in this checkout — the subcommand
 * ships with the module-scaffold PR (#4303) on a separate branch, so absent
 * availability the command is printed with a note instead.
 *
 * Drafts are refused (exit 1): promotion accepts only reviewed, finalized
 * documents — never auto-final.
 */
import { spawnSync } from 'node:child_process'
import { findRepoRoot, getMockupBySlug } from '../packages/core/src/modules/design_system/mockups/loader'
import {
  derivePromotion,
  scaffoldAvailableFromHelp,
} from '../packages/core/src/modules/design_system/mockups/promote'

function fail(message: string): never {
  console.error(`ds:mockups:promote: ${message}`)
  process.exit(1)
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('-')) fail(`${flag} requires a value`)
  return value
}

const args = process.argv.slice(2)
const slug = args.find((arg) => !arg.startsWith('-'))
if (!slug) fail('usage: yarn ds:mockups:promote <slug> [--entity <name>] [--module <id>] [--execute]')

const entity = flagValue(args, '--entity')
const moduleId = flagValue(args, '--module')
const execute = args.includes('--execute')

const repoRoot = findRepoRoot(__dirname)
if (!repoRoot) fail('could not locate the repo root (yarn.lock not found)')

const mockup = getMockupBySlug(slug, repoRoot)
if (!mockup) fail(`no mockup with slug "${slug}" — check .ai/mockups and module mockups folders`)
if (!mockup.document) {
  for (const issue of mockup.issues ?? []) console.error(`  ${issue.path}: ${issue.message}`)
  fail(`mockup "${slug}" fails schema validation — fix it before promoting`)
}

const result = derivePromotion(mockup.document, { entity, module: moduleId })
if (!result.ok) fail(result.error)

const { derivation } = result
console.log(`Promotion derived from mockup "${derivation.slug}":`)
console.log(`  entity: ${derivation.entity}`)
console.log(`  module: ${derivation.module}`)
console.log(`  fields: ${derivation.fields.length}`)
for (const field of derivation.fields) {
  console.log(
    `    - ${field.name} (${field.type}${field.required ? ', required' : ''}) from block "${field.blockId}"`,
  )
}
if (derivation.skippedFields.length > 0) {
  console.log('  skipped fields:')
  for (const skipped of derivation.skippedFields) {
    console.log(`    - ${skipped.name} (block "${skipped.blockId}"): ${skipped.reason}`)
  }
}
if (derivation.mergedDuplicates.length > 0) {
  console.log('  merged duplicates:')
  for (const dup of derivation.mergedDuplicates) {
    console.log(`    - ${dup.name} (block "${dup.blockId}") folded into the first occurrence`)
  }
}
if (derivation.unmapped.length > 0) {
  console.log('  not scaffolded, implement manually:')
  for (const block of derivation.unmapped) {
    console.log(`    - ${block.id} (${block.label}): ${block.reason}`)
  }
}
console.log('')
console.log('Scaffold command:')
console.log(`  ${derivation.command}`)

if (!execute) {
  console.log('')
  console.log('Dry run (default): pass --execute to run the scaffold command.')
  process.exit(0)
}

// Runtime availability check: `module scaffold` ships with the module-scaffold
// PR (#4303); on branches without it we print the command instead of failing.
const help = spawnSync('yarn', ['mercato', 'module', 'help'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
const helpOutput = `${help.stdout ?? ''}\n${help.stderr ?? ''}`
if (!scaffoldAvailableFromHelp(helpOutput)) {
  console.log('')
  console.log(
    'The `module scaffold` subcommand is not available in this checkout — it ships with the module-scaffold PR. Run the printed command once that branch lands.',
  )
  process.exit(0)
}

console.log('')
console.log('Running the scaffold command…')
const child = spawnSync(
  'yarn',
  [
    'mercato',
    'module',
    'scaffold',
    derivation.module,
    '--entity',
    derivation.entity,
    '--with-ui',
    '--fields',
    derivation.fieldsDsl,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
)
process.exit(child.status ?? 1)
