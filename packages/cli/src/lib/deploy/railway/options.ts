import type { RailwayDeployOptions, RailwaySourceMode } from './types'

const VALUE_FLAGS = new Set([
  '--project',
  '--env',
  '--service',
  '--source',
  '--region',
  '--env-file',
  '--domain',
  '--volume',
  '--token',
  '--timeout',
  '--allow-secret-passthrough',
])

const BOOLEAN_FLAGS = new Set([
  '--worker',
  '--no-worker',
  '--no-wait-domain',
  '--non-interactive',
  '--dry-run',
  '--cleanup',
  '--yes',
  '--write-env',
  '--no-track',
  '--force-rename',
  '--verbose',
  '--help',
  '-h',
])

function readFlagValue(args: string[], index: number): { flag: string; value: string; consumed: number } {
  const argument = args[index] ?? ''
  const equalsIndex = argument.indexOf('=')
  if (equalsIndex > 0) {
    const flag = argument.slice(0, equalsIndex)
    const value = argument.slice(equalsIndex + 1)
    if (!value) throw new Error(`Missing value for ${flag}.`)
    return { flag, value, consumed: 1 }
  }

  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${argument}.`)
  }
  return { flag: argument, value, consumed: 2 }
}

function parseSourceMode(value: string): RailwaySourceMode {
  if (value === 'auto' || value === 'git' || value === 'local') return value
  throw new Error(`Invalid --source value "${value}". Expected auto, git, or local.`)
}

function parseTimeout(value: string): number {
  const timeout = Number.parseInt(value, 10)
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('--timeout must be a positive number of seconds.')
  }
  return timeout
}

export function parseRailwayDeployOptions(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): RailwayDeployOptions {
  const options: RailwayDeployOptions = {
    environment: 'production',
    service: 'mercato-app',
    worker: true,
    source: 'auto',
    waitDomain: true,
    nonInteractive: environment.CI === 'true',
    dryRun: false,
    cleanup: false,
    yes: false,
    writeEnv: false,
    track: true,
    forceRename: false,
    timeoutSeconds: 900,
    allowedSecretKeys: [],
    verbose: false,
    help: false,
  }

  for (let index = 0; index < args.length;) {
    const argument = args[index] ?? ''
    const normalizedFlag = argument.includes('=') ? argument.slice(0, argument.indexOf('=')) : argument

    if (VALUE_FLAGS.has(normalizedFlag)) {
      const { flag, value, consumed } = readFlagValue(args, index)
      if (flag === '--project') options.project = value
      else if (flag === '--env') options.environment = value
      else if (flag === '--service') options.service = value
      else if (flag === '--source') options.source = parseSourceMode(value)
      else if (flag === '--region') options.region = value
      else if (flag === '--env-file') options.envFile = value
      else if (flag === '--domain') options.domain = value
      else if (flag === '--volume') options.volume = value
      else if (flag === '--token') options.token = value
      else if (flag === '--timeout') options.timeoutSeconds = parseTimeout(value)
      else if (flag === '--allow-secret-passthrough') options.allowedSecretKeys.push(value)
      index += consumed
      continue
    }

    if (!BOOLEAN_FLAGS.has(argument)) {
      throw new Error(`Unknown Railway deploy option "${argument}".`)
    }

    if (argument === '--worker') options.worker = true
    else if (argument === '--no-worker') options.worker = false
    else if (argument === '--no-wait-domain') options.waitDomain = false
    else if (argument === '--non-interactive') options.nonInteractive = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--cleanup') options.cleanup = true
    else if (argument === '--yes') options.yes = true
    else if (argument === '--write-env') options.writeEnv = true
    else if (argument === '--no-track') options.track = false
    else if (argument === '--force-rename') options.forceRename = true
    else if (argument === '--verbose') options.verbose = true
    else if (argument === '--help' || argument === '-h') options.help = true
    index += 1
  }

  if (options.cleanup && !options.dryRun && options.nonInteractive && !options.yes) {
    throw new Error('--cleanup --non-interactive requires --yes.')
  }
  if (options.environment.trim().length === 0) throw new Error('--env cannot be empty.')
  if (options.service.trim().length === 0) throw new Error('--service cannot be empty.')
  return options
}

export function railwayDeployHelp(): string {
  return `Usage: mercato deploy railway [options]

Deploy an Open Mercato standalone app to Railway.

  --project <name>                 Railway project name
  --env <name>                     Environment name (default: production)
  --service <name>                 App service name (default: mercato-app)
  --worker / --no-worker           Enable or disable the dedicated worker
  --source <auto|git|local>        Source strategy (default: auto)
  --region <id>                    Railway region
  --env-file <path>                Environment file
  --domain <fqdn>                  Custom domain
  --no-wait-domain                 Do not wait for DNS verification
  --volume <mountPath>             Create an attachments volume
  --token <value>                  Railway Account token
  --non-interactive                Disable prompts
  --dry-run                        Print the plan without mutations
  --cleanup --yes                  Delete the recorded Railway project
  --write-env                      Persist generated secrets locally
  --no-track                       Use .mercato/railway.json.local
  --force-rename                   Allow renaming a recorded project
  --timeout <seconds>              Deployment timeout (default: 900)
  --allow-secret-passthrough <key> Allow one credential-like env value
  --verbose                        Print redacted GraphQL diagnostics`
}

export function redactRailwayCliArgs(args: string[]): string[] {
  return args.map((argument, index) => {
    if (argument.startsWith('--token=')) return '--token=****'
    if (args[index - 1] === '--token') return '****'
    return argument
  })
}
