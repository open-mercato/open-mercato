/**
 * Template sync checker/fixer for create-app scaffold parity.
 *
 * Keeps `packages/create-app/template/src/{app,components,modules}` and selected
 * root src files aligned with app source for shared layout/routes/module scaffolding.
 *
 * Usage:
 *   tsx scripts/template-sync.ts          # check only (exit 1 on drift)
 *   tsx scripts/template-sync.ts --fix    # full mirror sync (overwrite from app source)
 *   tsx scripts/template-sync.ts --ask    # when drift is found, prompt to sync
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { globSync } from 'glob'

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')

const APP_SRC_ROOT = path.join(ROOT, 'apps', 'mercato', 'src')
const TEMPLATE_SRC_ROOT = path.join(ROOT, 'packages', 'create-app', 'template', 'src')
const SYNC_FOLDERS = ['app', 'components', 'modules'] as const
const SYNC_ROOT_FILES = ['bootstrap.ts'] as const
const TEMPLATE_ONLY_RELATIVE_FILES = new Set<string>([
  'modules/auth/__integration__/TC-AUTH-001.spec.ts',
  'modules/auth/__integration__/helpers/auth.ts',
])
const TEMPLATE_CONTENT_TRANSFORMS: Record<string, (content: string) => string> = {
  // Standalone template has shallower node_modules path than monorepo app.
  'app/globals.css': (content) => content.replaceAll('../../../../node_modules/', '../../node_modules/'),
}
const MAX_DIFFS_TO_SHOW = 20

const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

type DriftKind = 'missing_in_template' | 'content_mismatch' | 'extra_in_template'

type Drift = {
  kind: DriftKind
  sourceFile: string
  templateFile: string
  rel: string
}

function relFromRoot(absPath: string): string {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

function collectSourceFiles(): string[] {
  const folderFiles = SYNC_FOLDERS.flatMap((folder) =>
    globSync(`${folder}/**/*`, {
      cwd: APP_SRC_ROOT,
      absolute: true,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.DS_Store'],
    }),
  )
  const rootFiles = SYNC_ROOT_FILES
    .map((rel) => path.join(APP_SRC_ROOT, rel))
    .filter((abs) => fs.existsSync(abs))
  return [...folderFiles, ...rootFiles].sort()
}

function collectTemplateFiles(): string[] {
  const folderFiles = SYNC_FOLDERS.flatMap((folder) =>
    globSync(`${folder}/**/*`, {
      cwd: TEMPLATE_SRC_ROOT,
      absolute: true,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.DS_Store'],
    }),
  )
  const rootFiles = SYNC_ROOT_FILES
    .map((rel) => path.join(TEMPLATE_SRC_ROOT, rel))
    .filter((abs) => fs.existsSync(abs))
  return [...folderFiles, ...rootFiles].sort()
}

function getExpectedTemplateContent(rel: string, source: Buffer): Buffer {
  const transform = TEMPLATE_CONTENT_TRANSFORMS[rel]
  if (!transform) return source
  const sourceText = source.toString('utf8')
  return Buffer.from(transform(sourceText), 'utf8')
}

function computeDrift(): Drift[] {
  const sourceFiles = collectSourceFiles()
  const templateFiles = collectTemplateFiles()
  const drifts: Drift[] = []
  const sourceRelSet = new Set(sourceFiles.map((file) => path.relative(APP_SRC_ROOT, file)))

  for (const sourceFile of sourceFiles) {
    const rel = path.relative(APP_SRC_ROOT, sourceFile)
    const templateFile = path.join(TEMPLATE_SRC_ROOT, rel)
    if (!fs.existsSync(templateFile)) {
      drifts.push({
        kind: 'missing_in_template',
        sourceFile,
        templateFile,
        rel,
      })
      continue
    }

    const source = fs.readFileSync(sourceFile)
    const template = fs.readFileSync(templateFile)
    const expectedTemplate = getExpectedTemplateContent(rel, source)
    if (!expectedTemplate.equals(template)) {
      drifts.push({
        kind: 'content_mismatch',
        sourceFile,
        templateFile,
        rel,
      })
    }
  }

  for (const templateFile of templateFiles) {
    const rel = path.relative(TEMPLATE_SRC_ROOT, templateFile)
    if (TEMPLATE_ONLY_RELATIVE_FILES.has(rel)) continue
    if (sourceRelSet.has(rel)) continue
    drifts.push({
      kind: 'extra_in_template',
      sourceFile: path.join(APP_SRC_ROOT, rel),
      templateFile,
      rel,
    })
  }

  return drifts
}

function printDrift(drifts: Drift[]): void {
  if (drifts.length === 0) {
    console.log(green('Template sync check passed: app and template are in sync for src/app, src/components, src/modules, and synced root src files.'))
    return
  }

  const missing = drifts.filter((d) => d.kind === 'missing_in_template').length
  const changed = drifts.filter((d) => d.kind === 'content_mismatch').length
  const extra = drifts.filter((d) => d.kind === 'extra_in_template').length

  console.log(red(`Template drift detected: ${drifts.length} file(s)`))
  console.log(dim(`  missing in template: ${missing}`))
  console.log(dim(`  content mismatch:    ${changed}`))
  console.log(dim(`  extra in template:   ${extra}`))

  const preview = drifts.slice(0, MAX_DIFFS_TO_SHOW)
  for (const drift of preview) {
    const marker = drift.kind === 'missing_in_template'
      ? yellow('MISSING')
      : drift.kind === 'content_mismatch'
        ? yellow('DIFF')
        : yellow('EXTRA')
    console.log(`  - [${marker}] ${drift.rel}`)
  }
  if (drifts.length > preview.length) {
    console.log(dim(`  ... and ${drifts.length - preview.length} more`))
  }
}

function applyFullSync(): number {
  const sourceFiles = collectSourceFiles()
  const templateFiles = collectTemplateFiles()
  const sourceRelSet = new Set(sourceFiles.map((file) => path.relative(APP_SRC_ROOT, file)))
  let updated = 0

  // Always rewrite template targets from source of truth.
  for (const sourceFile of sourceFiles) {
    const rel = path.relative(APP_SRC_ROOT, sourceFile)
    const templateFile = path.join(TEMPLATE_SRC_ROOT, rel)
    const source = fs.readFileSync(sourceFile)
    const expectedTemplate = getExpectedTemplateContent(rel, source)
    const current = fs.existsSync(templateFile) ? fs.readFileSync(templateFile) : null
    if (current && current.equals(expectedTemplate)) continue
    fs.mkdirSync(path.dirname(templateFile), { recursive: true })
    fs.writeFileSync(templateFile, expectedTemplate)
    updated++
  }

  // Remove template files that are not in source (except explicit template-only files).
  for (const templateFile of templateFiles) {
    const rel = path.relative(TEMPLATE_SRC_ROOT, templateFile)
    if (TEMPLATE_ONLY_RELATIVE_FILES.has(rel)) continue
    if (sourceRelSet.has(rel)) continue
    fs.rmSync(templateFile, { force: true })
    updated++
  }

  return updated
}

function applySync(drifts: Drift[]): number {
  let updated = 0
  for (const drift of drifts) {
    if (drift.kind === 'extra_in_template') {
      fs.rmSync(drift.templateFile, { force: true })
      updated++
      continue
    }
    fs.mkdirSync(path.dirname(drift.templateFile), { recursive: true })
    const source = fs.readFileSync(drift.sourceFile)
    const expectedTemplate = getExpectedTemplateContent(drift.rel, source)
    fs.writeFileSync(drift.templateFile, expectedTemplate)
    updated++
  }
  return updated
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const fix = args.has('--fix')
  const ask = args.has('--ask')
  const checkOnly = !fix && !ask

  if (!fs.existsSync(APP_SRC_ROOT) || !fs.existsSync(TEMPLATE_SRC_ROOT)) {
    console.log(red('Required source/template paths were not found.'))
    process.exit(2)
  }

  console.log(cyan('[template-sync] Checking template parity for synced src folders and root files...'))
  const drifts = computeDrift()
  printDrift(drifts)

  if (drifts.length === 0) {
    process.exit(0)
  }

  if (checkOnly) {
    console.log(dim('Run `yarn template:sync --fix` to sync template from app source.'))
    process.exit(1)
  }

  if (ask) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
    if (!interactive) {
      console.log(yellow('Cannot prompt in non-interactive mode. Re-run with --fix or in a TTY with --ask.'))
      process.exit(1)
    }
    const shouldSync = await promptYesNo('Template drift found. Sync template files now?')
    if (!shouldSync) {
      console.log(yellow('Template sync skipped by user.'))
      process.exit(1)
    }
  }

  const updated = applyFullSync()
  console.log(green(`Synced ${updated} file(s) into packages/create-app/template/src.`))
  process.exit(0)
}

void main()
