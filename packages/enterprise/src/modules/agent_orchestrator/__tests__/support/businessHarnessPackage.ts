import path from 'node:path'

export const businessAgentRuntimeCliPath = path.resolve(
  process.cwd(),
  'packages/business-harness/dist/cli.js',
)

export const businessAgentRuntimeHostConfigPath = path.resolve(
  process.cwd(),
  'packages/business-harness/harness.config.host.json',
)
