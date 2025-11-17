const PARTITION_ENV_PREFIX = 'ATTACHMENTS_PARTITION_'
const ENV_SUFFIX_ROOT = '_ROOT'

function toEnvFragment(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
}

export function resolvePartitionEnvKey(code: string): string {
  const fragment = toEnvFragment(code)
  return `${PARTITION_ENV_PREFIX}${fragment}${ENV_SUFFIX_ROOT}`
}
