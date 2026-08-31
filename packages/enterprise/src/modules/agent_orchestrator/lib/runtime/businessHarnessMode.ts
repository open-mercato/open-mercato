import { BusinessHarnessClientError } from './businessHarnessTransportError'

export type BusinessHarnessTransportMode = 'stdio' | 'http'
export type BusinessHarnessRuntimeMode = 'one-off' | 'standalone'

function normalizeTransportMode(raw: string | undefined): BusinessHarnessTransportMode | null {
  const value = raw?.trim().toLowerCase()
  if (!value || value === 'stdio' || value === 'process' || value === 'cli') return 'stdio'
  if (value === 'http' || value === 'service') return 'http'
  return null
}

export function resolveBusinessHarnessTransportMode(
  raw = process.env.OM_BUSINESS_HARNESS_TRANSPORT,
): BusinessHarnessTransportMode {
  const mode = normalizeTransportMode(raw)
  if (mode) return mode
  throw new BusinessHarnessClientError(
    'HARNESS_CONFIGURATION_ERROR',
    `Unsupported OM_BUSINESS_HARNESS_TRANSPORT: ${raw}`,
  )
}

export function businessHarnessRuntimeMode(
  transport: BusinessHarnessTransportMode,
): BusinessHarnessRuntimeMode {
  return transport === 'http' ? 'standalone' : 'one-off'
}

export function resolveBusinessHarnessRuntimeMode(
  raw = process.env.OM_BUSINESS_HARNESS_TRANSPORT,
): BusinessHarnessRuntimeMode {
  return businessHarnessRuntimeMode(resolveBusinessHarnessTransportMode(raw))
}

/** Read-only UI projection. Invalid runtime configuration stays unlabeled here and is reported by health/run paths. */
export function readBusinessHarnessRuntimeMode(
  raw = process.env.OM_BUSINESS_HARNESS_TRANSPORT,
): BusinessHarnessRuntimeMode | null {
  const transport = normalizeTransportMode(raw)
  return transport ? businessHarnessRuntimeMode(transport) : null
}
