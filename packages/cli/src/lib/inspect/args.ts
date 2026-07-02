export type InspectCliOptions = {
  positionalSurface?: string
  json: boolean
  tier: 1 | 2 | 3
  tenantId?: string
  organizationId?: string
  surfaceIds?: string[]
}

export function parseInspectArgv(argv: string[]): InspectCliOptions {
  const json = argv.includes('--json')
  const tierRaw = readFlagValue(argv, '--tier')
  const tier = tierRaw === '1' || tierRaw === '2' || tierRaw === '3' ? Number(tierRaw) as 1 | 2 | 3 : 2
  const tenantId = readFlagValue(argv, '--tenant')
  const organizationId = readFlagValue(argv, '--org')
  const surfaceFlag = readFlagValue(argv, '--surface')
  const surfaceIds = surfaceFlag
    ? surfaceFlag.split(',').map((entry) => entry.trim()).filter(Boolean)
    : undefined

  const flags = new Set(['--json', '--tier', '--tenant', '--org', '--surface'])
  const positional = argv.filter((arg, index) => {
    if (flags.has(arg)) return false
    const prev = argv[index - 1]
    if (prev === '--tier' || prev === '--tenant' || prev === '--org' || prev === '--surface') return false
    return !arg.startsWith('-')
  })

  return {
    positionalSurface: positional[0],
    json,
    tier,
    tenantId,
    organizationId,
    surfaceIds,
  }
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

export function resolveSurfaceFilter(options: InspectCliOptions): string[] | undefined {
  if (options.surfaceIds?.length) return options.surfaceIds
  if (options.positionalSurface) return [options.positionalSurface]
  return undefined
}
