import { createInterface } from 'node:readline'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import {
  downloadReadyAppSnapshot,
  ensureGeneratedCssPlaceholder,
  extractTarballSnapshot,
  resolveReadyAppSource,
  type ReadyAppSource,
  validateImportedReadyAppSnapshot,
  validateSlug,
} from './lib/ready-apps.js'
import { applyStarterPreset, resolvePreset } from './lib/apply-starter-preset.js'
import { runCatalogStep, type CatalogStepOptions, type CatalogStepResult } from './lib/catalog/catalog-step.js'
import { parseModulesFlag } from './lib/catalog/selection.js'
import { DEFAULT_PRESET_ID, VALID_PRESET_IDS } from './lib/starter-presets.js'
import { resolveTemplatesUrl } from './lib/templates/fetch-templates.js'
import { printTemplateImportNextSteps, type TemplateNextStepsInput } from './lib/templates/finalize.js'
import { parseTemplateArg } from './lib/templates/resolve-template.js'
import { scaffoldFromTemplate } from './lib/templates/template-step.js'
import type { TemplateArg } from './lib/templates/types.js'
import { WITHOUT_DOCKER_GUIDE_URL, isDockerCliAvailable, missingDockerNotice } from './lib/docker-availability.js'
import { runAgenticSetup, parseAgentsValue } from './setup/wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
const PACKAGE_VERSION: string = packageJson.version
const TEMPLATE_DIR = join(__dirname, '..', 'template')

export interface Options {
  app?: string
  appUrl?: string
  /** --template <slug | owner/repo>[#ref]: create the app from an app template. */
  template?: string
  keepName: boolean
  preset?: string
  registry?: string
  initGit?: boolean
  agents?: string
  experimentalHooksValidator?: boolean
  modules?: string
  /** true: --module-picker, false: --no-module-picker, undefined: decided by shouldOfferModulePicker. */
  modulePicker?: boolean
  skipAgenticSetup: boolean
  verdaccio: boolean
  help: boolean
  version: boolean
}

/** Resolved agentic-setup intent after combining --agents and --skip-agentic-setup. */
type AgentSelection =
  | { mode: 'skip' }
  | { mode: 'tools'; tools: string[] }
  | { mode: 'interactive' }

export function helpText(): string {
  return `
${pc.bold('create-mercato-app')} - Create a new Open Mercato application

${pc.bold('Usage:')}
  create-mercato-app <app-name> [options]

${pc.bold('Arguments:')}
  app-name           Name of the application (will create folder with this name)

${pc.bold('Options:')}
  --app <name>       Bootstrap an official ready app from open-mercato/ready-app-<name>
  --app-url <url>    Bootstrap a ready app from a GitHub repository URL
  --template <slug | owner/repo>[#ref]
                     Create the app from an app template: a slug listed at
                     https://modules.openmercato.com/templates or any GitHub repo
                     (set GITHUB_TOKEN for a private one). Prints owner/repo@sha
                     and whether that commit is verified before the download
  --keep-name        With --template, keep the template's package.json name
  --preset <id>      Starter preset: classic, empty, crm, or wms (omit to choose interactively)
  --init-git         Initialize a local Git repository after scaffolding
  --no-init-git      Do not prompt for or initialize a local Git repository
  --agents <list>    Set up agent tooling non-interactively (skips the wizard):
                     comma-separated claude-code,codex,cursor,github-copilot — or 'all' / 'none'
  --experimental-hooks-validator
                     Install experimental gate-evidence/typecheck validator hooks
  --skip-agentic-setup  Skip the agentic setup wizard (alias for --agents none)
  --modules <list>   Plan modules from the Open Mercato Modules catalog (comma-separated
                     module ids, npm names or <npm name>:<module id>, verified on this
                     version); writes .mercato/catalog-selection.json and prints their
                     install commands
  --module-picker    Pick catalog modules interactively (needs a terminal). Offered by
                     default in a terminal when neither --preset nor --modules is given
  --no-module-picker Do not offer the catalog module picker
  --registry <url>   Custom npm registry URL
  --verdaccio        Use local Verdaccio registry (http://localhost:4873)
  --help, -h         Show help
  --version, -v      Show version

${pc.bold('Examples:')}
  npx create-mercato-app my-store
  npx create-mercato-app my-store --preset classic
  npx create-mercato-app my-store --preset empty
  npx create-mercato-app my-store --preset crm
  npx create-mercato-app my-warehouse --preset wms
  npx create-mercato-app my-store --init-git
  npx create-mercato-app my-store --agents claude-code,codex
  npx create-mercato-app my-store --agents codex --experimental-hooks-validator
  npx create-mercato-app my-store --agents all
  npx create-mercato-app my-store --agents none
  npx create-mercato-app my-store --preset crm --modules gateway_stripe
  npx create-mercato-app my-store --module-picker
  npx create-mercato-app my-store --no-module-picker
  npx create-mercato-app my-crm --template crm
  npx create-mercato-app my-portal --template some-agency/b2b-portal#v1.0.0
  npx create-mercato-app my-marketplace --app-url https://github.com/some-agency/ready-app-marketplace
  npx create-mercato-app my-store --verdaccio
  npx create-mercato-app my-store --registry http://localhost:4873
`
}

function showHelp(): void {
  console.log(helpText())
}

function showVersion(): void {
  console.log(`create-mercato-app v${PACKAGE_VERSION}`)
}

function requireOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`Option ${flag} requires a value`)
  }

  return value
}

export function parseArgs(args: string[]): { appName: string | null; options: Options } {
  const options: Options = {
    app: undefined,
    appUrl: undefined,
    template: undefined,
    keepName: false,
    preset: undefined,
    registry: undefined,
    initGit: undefined,
    agents: undefined,
    experimentalHooksValidator: undefined,
    modules: undefined,
    modulePicker: undefined,
    skipAgenticSetup: false,
    verdaccio: false,
    help: false,
    version: false,
  }
  let appName: string | null = null

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--version' || arg === '-v') {
      options.version = true
    } else if (arg === '--agents') {
      options.agents = requireOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--experimental-hooks-validator') {
      options.experimentalHooksValidator = true
    } else if (arg === '--modules') {
      options.modules = requireOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--module-picker') {
      options.modulePicker = true
    } else if (arg === '--no-module-picker') {
      options.modulePicker = false
    } else if (arg === '--skip-agentic-setup') {
      options.skipAgenticSetup = true
    } else if (arg === '--init-git') {
      options.initGit = true
    } else if (arg === '--no-init-git') {
      options.initGit = false
    } else if (arg === '--verdaccio') {
      options.verdaccio = true
    } else if (arg === '--registry') {
      options.registry = requireOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--app') {
      options.app = requireOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--app-url') {
      options.appUrl = requireOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--template') {
      options.template = requireOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--keep-name') {
      options.keepName = true
    } else if (arg === '--preset') {
      options.preset = requireOptionValue(args, index, arg)
      index += 1
    } else if (!arg.startsWith('-')) {
      appName = arg
    }
  }

  return { appName, options }
}

export type Ask = (question: string) => Promise<string>

const PRESET_PROMPT_OPTIONS = [
  { number: '1', id: 'classic', label: 'Classic     (default)', hint: 'full demo-ready starter' },
  { number: '2', id: 'empty', label: 'Empty', hint: 'minimal builder-ready baseline' },
  { number: '3', id: 'crm', label: 'CRM', hint: 'minimal CRM starter' },
  { number: '4', id: 'wms', label: 'WMS', hint: 'warehouse and inventory starter' },
] as const

export function normalizePresetAnswer(answer: string): string {
  const normalized = answer.trim().toLowerCase()

  if (!normalized) return DEFAULT_PRESET_ID

  const selected = PRESET_PROMPT_OPTIONS.find((option) => (
    option.number === normalized || option.id === normalized
  ))

  if (!selected) {
    throw new Error(`Unknown preset "${answer}". Choose classic, empty, crm, or wms.`)
  }

  return selected.id
}

async function promptForStarterPreset(ask: Ask): Promise<string> {
  console.log('')
  console.log('🧩  Starter module setup')
  console.log('')
  console.log('   Which starter module set do you want?')
  console.log('')
  for (const option of PRESET_PROMPT_OPTIONS) {
    console.log(`   ${option.number}. ${option.label} - ${option.hint}`)
  }
  console.log('')

  while (true) {
    const answer = await ask('   Enter number [1]: ')

    try {
      return normalizePresetAnswer(answer)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(pc.yellow(`   ${message}`))
    }
  }
}

async function resolveStarterPresetId(options: Options, importsApp: boolean): Promise<string> {
  if (options.preset) {
    if (!VALID_PRESET_IDS.includes(options.preset)) {
      throw new Error(`Unknown preset "${options.preset}". Valid presets: ${VALID_PRESET_IDS.join(', ')}`)
    }
    if (options.preset !== DEFAULT_PRESET_ID && importsApp) {
      throw new Error(
        `--preset ${options.preset} cannot be combined with --app or --app-url. Presets apply only to the built-in template.`,
      )
    }

    return options.preset
  }

  if (importsApp) return DEFAULT_PRESET_ID

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(pc.dim(`No starter preset selected; using ${DEFAULT_PRESET_ID}.`))
    console.log('')
    return DEFAULT_PRESET_ID
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question: string) =>
    new Promise<string>((resolveAnswer) => rl.question(question, (answer) => resolveAnswer(answer.trim())))

  try {
    return await promptForStarterPreset(ask)
  } finally {
    rl.close()
  }
}

function normalizeGitInitAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase()
  if (!normalized) return true
  if (['y', 'yes'].includes(normalized)) return true
  if (['n', 'no'].includes(normalized)) return false
  throw new Error(`Unknown answer "${answer}". Choose yes or no.`)
}

export async function promptForGitInitialization(ask: Ask): Promise<boolean> {
  console.log('')
  console.log('🌱  Git repository setup')
  console.log('')
  console.log('   Initialize a local Git repository now?')
  console.log(pc.dim('   You can publish it to GitHub later with `gh repo create --source=. --remote=origin --push`.'))
  console.log('')

  while (true) {
    const answer = await ask('   Initialize Git repository? [Y/n]: ')

    try {
      const shouldInitialize = normalizeGitInitAnswer(answer)
      console.log('')
      return shouldInitialize
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(pc.yellow(`   ${message}`))
    }
  }
}

async function resolveGitInitialization(options: Options): Promise<boolean> {
  if (typeof options.initGit === 'boolean') return options.initGit
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question: string) =>
    new Promise<string>((resolveAnswer) => rl.question(question, (answer) => resolveAnswer(answer.trim())))

  try {
    return await promptForGitInitialization(ask)
  } finally {
    rl.close()
  }
}

type GitInitializationResult =
  | { status: 'skipped' }
  | { status: 'initialized' }
  | { status: 'already-initialized' }
  | { status: 'failed'; message: string }

function runGitCommand(targetDir: string, args: string[]) {
  return spawnSync('git', args, {
    cwd: targetDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

function initializeGitRepository(targetDir: string): GitInitializationResult {
  if (existsSync(join(targetDir, '.git'))) {
    return { status: 'already-initialized' }
  }

  const initWithBranch = runGitCommand(targetDir, ['init', '-b', 'main'])
  if (initWithBranch.status === 0) {
    return { status: 'initialized' }
  }

  const fallbackInit = runGitCommand(targetDir, ['init'])
  if (fallbackInit.status !== 0) {
    const message = fallbackInit.stderr || initWithBranch.stderr || fallbackInit.stdout || initWithBranch.stdout
    return { status: 'failed', message: message.trim() || 'git init failed' }
  }

  const branchRename = runGitCommand(targetDir, ['branch', '-M', 'main'])
  if (branchRename.status !== 0) {
    const message = branchRename.stderr || branchRename.stdout
    return { status: 'failed', message: message.trim() || 'git branch -M main failed' }
  }

  return { status: 'initialized' }
}

async function maybeInitializeGitRepository(targetDir: string, options: Options): Promise<GitInitializationResult> {
  const shouldInitialize = await resolveGitInitialization(options)
  if (!shouldInitialize) return { status: 'skipped' }

  const result = initializeGitRepository(targetDir)
  if (result.status === 'initialized') {
    console.log(pc.green('Initialized local Git repository.'))
  } else if (result.status === 'already-initialized') {
    console.log(pc.dim('Git repository already initialized.'))
  } else if (result.status === 'failed') {
    console.log(pc.yellow(`Could not initialize Git repository: ${result.message}`))
  }
  console.log('')

  return result
}

export function buildRegistryConfig(registryUrl: string): string {
  let parsedRegistryUrl: URL

  try {
    parsedRegistryUrl = new URL(registryUrl)
  } catch {
    throw new Error(`Invalid registry URL "${registryUrl}"`)
  }

  const configLines: string[] = []

  if (parsedRegistryUrl.protocol === 'http:') {
    const unsafeHttpHosts = new Set([parsedRegistryUrl.hostname])

    if (parsedRegistryUrl.hostname === 'localhost' || parsedRegistryUrl.hostname === '127.0.0.1') {
      unsafeHttpHosts.add('host.docker.internal')
    }

    configLines.push('unsafeHttpWhitelist:')

    for (const host of unsafeHttpHosts) {
      configLines.push(`  - "${host}"`)
    }
  }

  configLines.push('npmScopes:')
  configLines.push('  open-mercato:')
  configLines.push(`    npmRegistryServer: "${registryUrl}"`)
  configLines.push('    npmMinimalAgeGate: 0')

  return configLines.join('\n')
}

const FILE_RENAMES: Record<string, string> = {
  gitignore: '.gitignore',
  gitattributes: '.gitattributes',
}

const SKIP_DIRS = new Set(['__tests__', '__integration__'])

function copyDirRecursive(src: string, dest: string, placeholders: Record<string, string>): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }

  const entries = readdirSync(src)

  for (const entry of entries) {
    const srcPath = join(src, entry)
    const destName = FILE_RENAMES[entry] ?? entry
    let destPath = join(dest, destName)
    const stat = statSync(srcPath)

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      copyDirRecursive(srcPath, destPath, placeholders)
    } else if (entry.endsWith('.template')) {
      const finalName = entry.replace('.template', '')
      destPath = join(dest, finalName)
      let content = readFileSync(srcPath, 'utf-8')

      for (const [key, value] of Object.entries(placeholders)) {
        content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
      }

      writeFileSync(destPath, content)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

async function scaffoldTemplateApp(
  targetDir: string,
  placeholders: Record<string, string>,
): Promise<void> {
  if (!existsSync(TEMPLATE_DIR)) {
    throw new Error(`Template directory not found at ${TEMPLATE_DIR}`)
  }

  copyDirRecursive(TEMPLATE_DIR, targetDir, placeholders)
  ensureGeneratedCssPlaceholder(targetDir)
}

function describeReadyAppSource(source: ReadyAppSource): string {
  if (source.kind === 'official') {
    return `${source.owner}/${source.repo}@${source.ref}`
  }

  return `${source.owner}/${source.repo}${source.ref ? `@${source.ref}` : ''}`
}

async function scaffoldImportedReadyApp(targetDir: string, source: ReadyAppSource): Promise<void> {
  const download = await downloadReadyAppSnapshot(source, PACKAGE_VERSION)
  console.log(pc.dim(`Fetching ready app snapshot from ${download.owner}/${download.repo}@${download.ref}`))

  try {
    await extractTarballSnapshot(download.archive.path, targetDir, {
      afterExtract: (dir) => {
        validateImportedReadyAppSnapshot(dir)
        ensureGeneratedCssPlaceholder(dir)
      },
    })
  } finally {
    download.archive.dispose()
  }
}

/**
 * Checks the flags that cannot be combined with --template and parses its value, all before any network call.
 * Returns null without --template, where --keep-name is a usage error.
 */
export function resolveTemplateFlags(options: Options): TemplateArg | null {
  if (options.template === undefined) {
    if (options.keepName) {
      throw new Error('--keep-name works only with --template.')
    }
    return null
  }

  if (options.app !== undefined || options.appUrl !== undefined) {
    throw new Error('Options --template, --app and --app-url are mutually exclusive. Use only one source flag.')
  }
  if (options.modules !== undefined || options.modulePicker === true) {
    throw new Error('--modules and --module-picker are not supported with --template. App templates keep their own module set.')
  }
  if (options.preset !== undefined && options.preset !== DEFAULT_PRESET_ID) {
    throw new Error(
      `--preset ${options.preset} cannot be combined with --template. Presets apply only to the built-in scaffold.`,
    )
  }
  if (options.agents !== undefined) {
    throw new Error(
      '--agents is not supported with --template. App templates manage their own agentic tooling; run `yarn mercato agentic:init` inside the app instead.',
    )
  }
  if (options.experimentalHooksValidator) {
    throw new Error(
      '--experimental-hooks-validator is not supported with --template. Run `yarn mercato agentic:init --experimental-hooks-validator` inside the app instead.',
    )
  }

  return parseTemplateArg(options.template)
}

// Combine --agents (validated) and --skip-agentic-setup into a single intent.
// `--agents none` == `--skip-agentic-setup`; a non-empty --agents list together
// with --skip-agentic-setup is contradictory and rejected.
function resolveAgentSelection(options: Options): AgentSelection {
  if (options.agents === undefined) {
    return options.skipAgenticSetup ? { mode: 'skip' } : { mode: 'interactive' }
  }
  const parsed = parseAgentsValue(options.agents)
  if (parsed.skip) {
    return { mode: 'skip' }
  }
  if (options.skipAgenticSetup) {
    throw new Error('--skip-agentic-setup cannot be combined with --agents <tools>. Use --agents none to skip.')
  }
  return { mode: 'tools', tools: parsed.tools }
}

async function maybeRunAgenticSetup(
  targetDir: string,
  selection: AgentSelection,
  experimentalHooksValidator?: boolean,
): Promise<boolean> {
  if (selection.mode === 'skip') {
    return runAgenticSetup(targetDir, async () => '', { tool: 'skip', experimentalHooksValidator })
  }

  if (selection.mode === 'tools') {
    return runAgenticSetup(targetDir, async () => '', {
      tool: selection.tools.join(','),
      experimentalHooksValidator,
    })
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question: string) =>
    new Promise<string>((resolveAnswer) => rl.question(question, (answer) => resolveAnswer(answer.trim())))

  try {
    return await runAgenticSetup(targetDir, ask, { experimentalHooksValidator })
  } finally {
    rl.close()
  }
}

export function printCatalogNextSteps(catalogCommands: string[], commandWarnings: Record<string, string> = {}): void {
  if (catalogCommands.length === 0) return
  console.log(pc.green('Modules you planned from the catalog:'))
  console.log(pc.dim('  # After yarn install, in this order (each command runs yarn generate for you):'))
  for (const command of catalogCommands) {
    const warning = Object.hasOwn(commandWarnings, command) ? commandWarnings[command] : undefined
    if (warning) console.log(pc.yellow(`  # Warning: ${warning}`))
    console.log(pc.cyan(`  ${command}`))
  }
  console.log(pc.dim('  # Then yarn db:migrate. The plan is saved in .mercato/catalog-selection.json'))
  console.log('')
}

export type CatalogPlan = Pick<CatalogStepResult, 'commands' | 'commandWarnings'>

export type CatalogStepRunner = (options: CatalogStepOptions) => Promise<CatalogStepResult>

function printTemplateNextSteps(
  appName: string,
  agenticConfigured: boolean,
  catalogPlan: CatalogPlan = { commands: [], commandWarnings: {} },
  dockerAvailable: boolean = isDockerCliAvailable(),
): void {
  if (!dockerAvailable) {
    const [title, ...details] = missingDockerNotice()
    console.log(pc.yellow(`⚠️  ${title}`))
    for (const line of details) console.log(pc.yellow(line))
    console.log('')
  }
  console.log('Next steps:')
  console.log('')
  console.log(pc.cyan(`  cd ${appName}`))
  console.log(pc.cyan('  yarn setup'))
  console.log(pc.dim('  # Checks Docker, starts PostgreSQL, Redis and Meilisearch and waits until they are healthy,'))
  console.log(pc.dim('  # then installs dependencies, migrates and initializes the database and starts the dev server.'))
  console.log(pc.dim('  # Needs Node 24, Yarn 4 (corepack enable) and a running Docker engine. Safe to re-run: data and .env are kept.'))
  console.log('')
  console.log('Using your own PostgreSQL, Redis and Meilisearch instead of Docker:')
  console.log(pc.cyan('  cp .env.example .env'))
  console.log(pc.dim('  # Point DATABASE_URL (and Redis/Meilisearch settings) at your services, then:'))
  console.log(pc.cyan('  yarn setup --no-infra'))
  console.log(pc.dim('  # Makes no Docker calls and keeps your URLs'))
  console.log(pc.dim(`  # Step by step: ${WITHOUT_DOCKER_GUIDE_URL}`))
  console.log('')
  console.log('Later:')
  console.log(pc.cyan('  yarn dev'))
  console.log(pc.dim('  # Start the app again (yarn infra:up first if the containers are stopped)'))
  console.log(pc.cyan('  yarn infra:down'))
  console.log(pc.dim('  # Stop the containers; data is kept'))
  console.log(pc.dim('  # Clean database reset (deletes local data): yarn setup --reinstall'))
  console.log('')
  printCatalogNextSteps(catalogPlan.commands, catalogPlan.commandWarnings)
  console.log('Full Docker stack (app in a container too):')
  console.log(pc.dim('  # Before Docker: cp .env.example .env && yarn install'))
  console.log(pc.cyan('  # Dev (recommended on Windows): docker compose -f docker-compose.fullapp.dev.yml up --build'))
  console.log(pc.cyan('  # Production-style: docker compose -f docker-compose.fullapp.yml up --build'))
  console.log('')

  if (agenticConfigured) {
    console.log(pc.green('Agent pipeline:'))
    console.log(pc.dim('  # .ai/agentic.config.json ships preconfigured (GitHub tracker, labels off) — skills work out of the box.'))
    console.log(pc.dim('  # To tailor it (enable pipeline labels + QA gate, switch tracker, change validation commands), run in your agent CLI:'))
    console.log(pc.cyan('  /om-setup-agent-pipeline'))
    console.log('')
  }
}

function printImportedReadyAppNextSteps(appName: string): void {
  console.log('Next steps:')
  console.log('')
  console.log(pc.cyan(`  cd ${appName}`))
  console.log(pc.cyan('  yarn install'))
  console.log(pc.cyan('  yarn initialize'))
  console.log(pc.cyan('  yarn dev'))
  console.log('')
  console.log(pc.dim('Imported ready apps are copied as raw source snapshots.'))
  console.log(pc.dim('If you want agentic tooling in the imported app later, run `yarn mercato agentic:init` inside it.'))
  console.log('')
}

function printGitHubSyncInstructions(gitResult: GitInitializationResult): void {
  console.log('Optional GitHub publish:')
  console.log('')

  if (gitResult.status === 'skipped' || gitResult.status === 'failed') {
    console.log(pc.cyan('  git init -b main'))
  }

  console.log(pc.cyan('  git add -A'))
  console.log(pc.cyan('  git commit -m "Initial commit"'))
  console.log(pc.dim('  # With GitHub CLI:'))
  console.log(pc.cyan('  gh repo create --source=. --remote=origin --push'))
  console.log(pc.dim('  # Or create an empty GitHub repo in the browser, then:'))
  console.log(pc.cyan('  git remote add origin https://github.com/<owner>/<repo>.git'))
  console.log(pc.cyan('  git push -u origin main'))
  console.log(pc.dim('  # You can also publish from the standalone dev splash after `yarn dev`.'))
  console.log('')
}

/**
 * Whether the catalog module picker runs: --module-picker and --no-module-picker decide when given; otherwise it is
 * offered in an interactive terminal to an app built from the template without --preset or --modules, so a user who
 * did not choose a starter set on the command line also sees the verified catalog modules (Enter adds none).
 */
export function shouldOfferModulePicker(
  options: Pick<Options, 'modulePicker' | 'preset' | 'modules' | 'template'>,
  readyAppSource: ReadyAppSource | null,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
): boolean {
  // An app template keeps its own module set; resolveTemplateFlags refuses --module-picker with it.
  if (options.template !== undefined) return false
  if (options.modulePicker !== undefined) return options.modulePicker
  return interactive && !readyAppSource && options.preset === undefined && options.modules === undefined
}

/** Runs the catalog step only for --modules or the picker; without either the catalog is never fetched. */
export async function maybeRunCatalogStep(
  targetDir: string,
  presetId: string,
  requested: string[] | null,
  picker: boolean,
  run: CatalogStepRunner = runCatalogStep,
): Promise<CatalogPlan> {
  if (requested === null && !picker) return { commands: [], commandWarnings: {} }
  const preset = resolvePreset(presetId)
  const presetModuleIds = preset.isClassic ? null : preset.modules.map((entry) => entry.id)
  const interactive = picker && Boolean(process.stdin.isTTY && process.stdout.isTTY)
  // Opened on the first question, not before the catalog fetch: a readline puts the terminal in raw mode, where
  // Ctrl+C during the fetch would close it instead of stopping the run.
  const terminal: { rl: ReturnType<typeof createInterface> | null } = { rl: null }
  const ask = interactive
    ? (question: string) => {
        const rl = (terminal.rl ??= createInterface({ input: process.stdin, output: process.stdout }))
        return new Promise<string>((resolveAnswer) => rl.question(question, (answer) => resolveAnswer(answer.trim())))
      }
    : null

  try {
    const result = await run({
      targetDir,
      version: PACKAGE_VERSION,
      requested,
      picker,
      presetModuleIds,
      presetModules: preset.isClassic ? null : preset.modules,
      ask,
      log: (line) => console.log(line),
      warn: (line) => console.log(pc.yellow(line)),
    })
    return { commands: result.commands, commandWarnings: result.commandWarnings }
  } finally {
    terminal.rl?.close()
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { appName: appNameArg, options } = parseArgs(argv)

  if (options.help) {
    showHelp()
    return
  }

  if (options.version) {
    showVersion()
    return
  }

  if (!appNameArg) {
    throw new Error('App name is required')
  }

  const targetDir = resolve(process.cwd(), appNameArg)
  const appName = basename(targetDir)

  const validation = validateSlug(appName, 'App name')
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  if (existsSync(targetDir)) {
    throw new Error(`Directory "${appName}" already exists`)
  }

  const templateArg = resolveTemplateFlags(options)
  const templatesUrl = templateArg ? resolveTemplatesUrl() : null
  const readyAppSource = resolveReadyAppSource(options, PACKAGE_VERSION)
  const importsApp = readyAppSource !== null || templateArg !== null

  if (options.agents !== undefined && readyAppSource) {
    throw new Error(
      '--agents is not supported with --app/--app-url. Imported ready apps manage their own agentic tooling; run `yarn mercato agentic:init` inside the app instead.',
    )
  }
  if (options.experimentalHooksValidator && readyAppSource) {
    throw new Error(
      '--experimental-hooks-validator is not supported with --app/--app-url. Run `yarn mercato agentic:init --experimental-hooks-validator` inside the imported app instead.',
    )
  }

  if ((options.modules !== undefined || options.modulePicker === true) && readyAppSource) {
    throw new Error(
      '--modules and --module-picker are not supported with --app/--app-url. Imported ready apps keep their own module set.',
    )
  }
  const requestedCatalogModules = options.modules !== undefined ? parseModulesFlag(options.modules) : null

  // Resolve (and validate) the agentic selection up front so a bad --agents
  // value fails before any scaffolding work happens.
  const agentSelection = resolveAgentSelection(options)

  const presetId = await resolveStarterPresetId(options, importsApp)

  const registryConfig = options.verdaccio
    ? buildRegistryConfig('http://localhost:4873')
    : options.registry
      ? buildRegistryConfig(options.registry)
      : ''

  console.log('')
  console.log(pc.bold(`Creating a new Open Mercato app in ${pc.cyan(targetDir)}`))
  console.log('')

  const placeholders: Record<string, string> = {
    APP_NAME: appName,
    PACKAGE_VERSION,
    REGISTRY_CONFIG: registryConfig,
  }

  let templateResult: TemplateNextStepsInput | null = null
  if (templateArg && templatesUrl) {
    if (options.registry !== undefined || options.verdaccio) {
      console.log(pc.yellow(
        '--registry and --verdaccio do not apply to app templates. The app keeps the registry settings of its own .yarnrc.yml.',
      ))
      console.log('')
    }
    templateResult = await scaffoldFromTemplate(targetDir, templateArg, {
      appName,
      keepName: options.keepName,
      indexUrl: templatesUrl,
      packageVersion: PACKAGE_VERSION,
    })
  } else if (readyAppSource) {
    console.log(pc.dim(`Ready app source: ${describeReadyAppSource(readyAppSource)}`))
    console.log('')
    await scaffoldImportedReadyApp(targetDir, readyAppSource)
  } else {
    await scaffoldTemplateApp(targetDir, placeholders)
    applyStarterPreset(presetId, targetDir)
  }

  const catalogPlan: CatalogPlan = importsApp
    ? { commands: [], commandWarnings: {} }
    : await maybeRunCatalogStep(targetDir, presetId, requestedCatalogModules, shouldOfferModulePicker(options, readyAppSource))

  console.log(pc.green('Success!') + ` Created ${pc.bold(appName)}`)
  console.log('')

  let agenticConfigured = false
  if (!importsApp) {
    agenticConfigured = await maybeRunAgenticSetup(
      targetDir,
      agentSelection,
      options.experimentalHooksValidator,
    )
  }

  const gitResult = await maybeInitializeGitRepository(targetDir, options)

  if (templateResult) {
    printTemplateImportNextSteps(templateResult)
  } else if (importsApp) {
    printImportedReadyAppNextSteps(appName)
  } else {
    printTemplateNextSteps(appName, agenticConfigured, catalogPlan)
  }
  printGitHubSyncInstructions(gitResult)

  console.log(pc.dim('For more information, visit https://github.com/open-mercato/open-mercato'))
  console.log('')
}

const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(pc.red('Error creating app:'), message)
    process.exit(1)
  })
}
