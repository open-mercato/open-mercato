import { createInterface } from 'node:readline'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import {
  downloadReadyAppSnapshot,
  extractTarballSnapshot,
  resolveReadyAppSource,
  type ReadyAppSource,
  validateImportedReadyAppSnapshot,
  validateSlug,
} from './lib/ready-apps.js'
import { applyStarterPreset } from './lib/apply-starter-preset.js'
import { DEFAULT_PRESET_ID, VALID_PRESET_IDS } from './lib/starter-presets.js'
import { runAgenticSetup } from './setup/wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
const PACKAGE_VERSION: string = packageJson.version
const TEMPLATE_DIR = join(__dirname, '..', 'template')

interface Options {
  app?: string
  appUrl?: string
  preset?: string
  registry?: string
  initGit?: boolean
  skipAgenticSetup: boolean
  verdaccio: boolean
  help: boolean
  version: boolean
}

function showHelp(): void {
  console.log(`
${pc.bold('create-mercato-app')} - Create a new Open Mercato application

${pc.bold('Usage:')}
  create-mercato-app <app-name> [options]

${pc.bold('Arguments:')}
  app-name           Name of the application (will create folder with this name)

${pc.bold('Options:')}
  --app <name>       Bootstrap an official ready app from open-mercato/ready-app-<name>
  --app-url <url>    Bootstrap a ready app from a GitHub repository URL
  --preset <id>      Starter preset: classic, empty, or crm (omit to choose interactively)
  --init-git         Initialize a local Git repository after scaffolding
  --no-init-git      Do not prompt for or initialize a local Git repository
  --skip-agentic-setup  Skip the interactive agentic setup wizard
  --registry <url>   Custom npm registry URL
  --verdaccio        Use local Verdaccio registry (http://localhost:4873)
  --help, -h         Show help
  --version, -v      Show version

${pc.bold('Examples:')}
  npx create-mercato-app my-store
  npx create-mercato-app my-store --preset classic
  npx create-mercato-app my-store --preset empty
  npx create-mercato-app my-store --preset crm
  npx create-mercato-app my-store --init-git
  npx create-mercato-app my-prm --app prm
  npx create-mercato-app my-marketplace --app-url https://github.com/some-agency/ready-app-marketplace
  npx create-mercato-app my-store --verdaccio
  npx create-mercato-app my-store --registry http://localhost:4873
`)
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

function parseArgs(args: string[]): { appName: string | null; options: Options } {
  const options: Options = {
    app: undefined,
    appUrl: undefined,
    preset: undefined,
    registry: undefined,
    initGit: undefined,
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
    } else if (arg === '--preset') {
      options.preset = requireOptionValue(args, index, arg)
      index += 1
    } else if (!arg.startsWith('-')) {
      appName = arg
    }
  }

  return { appName, options }
}

type Ask = (question: string) => Promise<string>

const PRESET_PROMPT_OPTIONS = [
  { number: '1', id: 'classic', label: 'Classic     (default)', hint: 'full demo-ready starter' },
  { number: '2', id: 'empty', label: 'Empty', hint: 'minimal builder-ready baseline' },
  { number: '3', id: 'crm', label: 'CRM', hint: 'minimal CRM starter' },
] as const

export function normalizePresetAnswer(answer: string): string {
  const normalized = answer.trim().toLowerCase()

  if (!normalized) return DEFAULT_PRESET_ID

  const selected = PRESET_PROMPT_OPTIONS.find((option) => (
    option.number === normalized || option.id === normalized
  ))

  if (!selected) {
    throw new Error(`Unknown preset "${answer}". Choose classic, empty, or crm.`)
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

async function resolveStarterPresetId(options: Options, readyAppSource: ReadyAppSource | null): Promise<string> {
  if (options.preset) {
    if (!VALID_PRESET_IDS.includes(options.preset)) {
      throw new Error(`Unknown preset "${options.preset}". Valid presets: ${VALID_PRESET_IDS.join(', ')}`)
    }
    if (options.preset !== DEFAULT_PRESET_ID && readyAppSource) {
      throw new Error(
        `--preset ${options.preset} cannot be combined with --app or --app-url. Presets apply only to the built-in template.`,
      )
    }

    return options.preset
  }

  if (readyAppSource) return DEFAULT_PRESET_ID

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

async function promptForGitInitialization(ask: Ask): Promise<boolean> {
  console.log('')
  console.log('🌱  Git repository setup')
  console.log('')
  console.log('   Initialize a local Git repository now?')
  console.log(pc.dim('   You can publish it to GitHub later with `gh repo create --source=. --remote=origin --push`.'))
  console.log('')

  while (true) {
    const answer = await ask('   Initialize Git repository? [Y/n]: ')

    try {
      return normalizeGitInitAnswer(answer)
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

function buildRegistryConfig(registryUrl: string): string {
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

  return configLines.join('\n')
}

const FILE_RENAMES: Record<string, string> = {
  gitignore: '.gitignore',
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

function ensureGeneratedCssPlaceholder(targetDir: string): void {
  const generatedDir = join(targetDir, '.mercato', 'generated')
  const placeholderPath = join(generatedDir, 'module-package-sources.css')

  mkdirSync(generatedDir, { recursive: true })
  if (!existsSync(placeholderPath)) {
    writeFileSync(placeholderPath, '')
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

  await extractTarballSnapshot(download.archive, targetDir)
  validateImportedReadyAppSnapshot(targetDir)
  ensureGeneratedCssPlaceholder(targetDir)
}

async function maybeRunAgenticSetup(targetDir: string, skipAgenticSetup: boolean): Promise<void> {
  if (skipAgenticSetup) {
    await runAgenticSetup(targetDir, async () => '', { tool: 'skip' })
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question: string) =>
    new Promise<string>((resolveAnswer) => rl.question(question, (answer) => resolveAnswer(answer.trim())))

  try {
    await runAgenticSetup(targetDir, ask)
  } finally {
    rl.close()
  }
}

function printTemplateNextSteps(appName: string): void {
  console.log('Next steps:')
  console.log('')
  console.log(pc.cyan(`  cd ${appName}`))
  console.log(pc.dim('  # Make sure Yarn 4.1x is installed before running the setup command, and install all the deependencies with:'))
  console.log(pc.cyan('  yarn'))
  console.log('')
  console.log(pc.green('Suggested quick start:'))
  console.log(pc.cyan('  yarn setup'))
  console.log(pc.dim('  # Copies .env.example to .env if needed, installs deps, migrates, initializes, and starts dev'))
  console.log(pc.dim('  # If you need a clean reset first: yarn setup --reinstall'))
  console.log(pc.dim('  # Alias: yarn setup:reinstall'))
  console.log('')
  console.log('Manual alternative:')
  console.log(pc.cyan('  cp .env.example .env'))
  console.log(pc.dim('  # Edit .env with your database credentials'))
  console.log(pc.cyan('  yarn install'))
  console.log(pc.cyan('  yarn generate'))
  console.log(pc.cyan('  yarn db:migrate'))
  console.log(pc.cyan('  yarn initialize'))
  console.log(pc.cyan('  yarn dev'))
  console.log('')
  console.log('Docker alternatives:')
  console.log(pc.dim('  # Before Docker: cp .env.example .env && yarn install'))
  console.log(pc.dim('  # Docker expects your local app env and dependencies to be prepared first'))
  console.log(pc.cyan('  # Dev (recommended on Windows): docker compose -f docker-compose.fullapp.dev.yml up --build'))
  console.log(pc.cyan('  # Production-style: docker compose -f docker-compose.fullapp.yml up --build'))
  console.log('')
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

  const readyAppSource = resolveReadyAppSource(options, PACKAGE_VERSION)

  const presetId = await resolveStarterPresetId(options, readyAppSource)

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

  if (readyAppSource) {
    console.log(pc.dim(`Ready app source: ${describeReadyAppSource(readyAppSource)}`))
    console.log('')
    await scaffoldImportedReadyApp(targetDir, readyAppSource)
  } else {
    await scaffoldTemplateApp(targetDir, placeholders)
    applyStarterPreset(presetId, targetDir)
  }

  console.log(pc.green('Success!') + ` Created ${pc.bold(appName)}`)
  console.log('')

  if (!readyAppSource) {
    await maybeRunAgenticSetup(targetDir, options.skipAgenticSetup)
  }

  const gitResult = await maybeInitializeGitRepository(targetDir, options)

  if (readyAppSource) {
    printImportedReadyAppNextSteps(appName)
  } else {
    printTemplateNextSteps(appName)
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
