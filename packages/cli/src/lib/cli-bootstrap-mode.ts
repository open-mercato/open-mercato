export type CliBootstrapMode = 'none' | 'dev-supervisor' | 'full'

const BOOTSTRAP_FREE_COMMANDS = new Set([
  'generate',
  'module',
  'deploy',
  'db',
  'init',
  'agentic:init',
  'eject',
  'test',
  'test:integration',
  'test:integration:coverage',
  'test:integration:spec-coverage',
  'test:ephemeral',
  'test:integration:interactive',
  'umes:list',
  'umes:inspect',
  'umes:check',
  'help',
  '--help',
  '-h',
])

export function resolveCliBootstrapMode(argv: readonly string[]): CliBootstrapMode {
  const [, , first, second] = argv
  if (!first || BOOTSTRAP_FREE_COMMANDS.has(first)) return 'none'
  if (first === 'server' && second === 'dev') return 'dev-supervisor'
  return 'full'
}
