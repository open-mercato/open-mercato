import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
const PACKAGE_VERSION: string = packageJson.version
const TEMPLATE_DIR = join(__dirname, '..', 'template')

interface Options {
  registry?: string
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
  --registry <url>   Custom npm registry URL
  --verdaccio        Use local Verdaccio registry (http://localhost:4873)
  --help, -h         Show help
  --version, -v      Show version

${pc.bold('Examples:')}
  npx create-mercato-app my-store
  npx create-mercato-app my-store --verdaccio
  npx create-mercato-app my-store --registry http://localhost:4873
`)
}

function showVersion(): void {
  console.log(`create-mercato-app v${PACKAGE_VERSION}`)
}

function parseArgs(args: string[]): { appName: string | null; options: Options } {
  const options: Options = {
    registry: undefined,
    verdaccio: false,
    help: false,
    version: false,
  }
  let appName: string | null = null

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--version' || arg === '-v') {
      options.version = true
    } else if (arg === '--verdaccio') {
      options.verdaccio = true
    } else if (arg === '--registry') {
      options.registry = args[++i]
    } else if (!arg.startsWith('-')) {
      appName = arg
    }
  }

  return { appName, options }
}

function validateAppName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: 'App name is required' }
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return {
      valid: false,
      error: 'App name must be lowercase alphanumeric with hyphens only (e.g., my-app)',
    }
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    return { valid: false, error: 'App name cannot start or end with a hyphen' }
  }

  return { valid: true }
}

// Files that need to be renamed (npm ignores .gitignore during pack)
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
      // Process template files
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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const { appName: appNameArg, options } = parseArgs(args)

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  if (options.version) {
    showVersion()
    process.exit(0)
  }

  if (!appNameArg) {
    console.error(pc.red('Error: App name is required'))
    console.error('')
    showHelp()
    process.exit(1)
  }

  // Support both relative names (my-app) and full paths (/tmp/my-app)
  const targetDir = resolve(process.cwd(), appNameArg)
  const appName = basename(targetDir)

  const validation = validateAppName(appName)
  if (!validation.valid) {
    console.error(pc.red(`Error: ${validation.error}`))
    process.exit(1)
  }

  if (existsSync(targetDir)) {
    console.error(pc.red(`Error: Directory "${appName}" already exists`))
    process.exit(1)
  }

  if (!existsSync(TEMPLATE_DIR)) {
    console.error(pc.red('Error: Template directory not found'))
    console.error(`Expected: ${TEMPLATE_DIR}`)
    process.exit(1)
  }

  // Determine registry config
  let registryConfig = ''
  if (options.verdaccio) {
    registryConfig = `npmScopes:
  open-mercato:
    npmRegistryServer: "http://localhost:4873"`
  } else if (options.registry) {
    registryConfig = `npmScopes:
  open-mercato:
    npmRegistryServer: "${options.registry}"`
  }

  console.log('')
  console.log(pc.bold(`Creating a new Open Mercato app in ${pc.cyan(targetDir)}`))
  console.log('')

  // Define placeholders
  const placeholders: Record<string, string> = {
    APP_NAME: appName,
    PACKAGE_VERSION: PACKAGE_VERSION,
    REGISTRY_CONFIG: registryConfig,
  }

  try {
    copyDirRecursive(TEMPLATE_DIR, targetDir, placeholders)

    console.log(pc.green('Success!') + ` Created ${pc.bold(appName)}`)
    console.log('')
    console.log('Next steps:')
    console.log('')
    console.log(pc.cyan(`  cd ${appName}`))
    console.log(pc.cyan('  cp .env.example .env'))
    console.log(pc.dim('  # Edit .env with your database credentials'))
    console.log(pc.cyan('  yarn install'))
    console.log(pc.cyan('  yarn generate'))
    console.log(pc.cyan('  yarn db:migrate'))
    console.log(pc.cyan('  yarn initialize'))
    console.log(pc.cyan('  yarn dev'))
    console.log('')
    console.log('Docker alternatives:')
    console.log(pc.cyan('  # Dev (recommended on Windows): docker compose -f docker-compose.fullapp.dev.yml up --build'))
    console.log(pc.cyan('  # Production-style: docker compose -f docker-compose.fullapp.yml up --build'))
    console.log('')
    console.log(pc.dim('For more information, visit https://github.com/open-mercato/open-mercato'))
    console.log('')
  } catch (error) {
    console.error(pc.red('Error creating app:'), error)
    process.exit(1)
  }
}

main()
