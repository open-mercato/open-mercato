import type { CatalogFetchResult, CatalogLicense, CatalogModule, CatalogSource, PickerIndex } from './types.js'

export const DEFAULT_PICKER_URL = 'https://modules.openmercato.com/picker.json'
export const PICKER_URL_ENV = 'OM_MODULES_PICKER_URL'
export const CATALOG_TIMEOUT_MS = 4000

export type CatalogResponse = {
  status: number
  ok: boolean
  json(): Promise<unknown>
}

export type CatalogFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<CatalogResponse>

const SOURCES: readonly CatalogSource[] = ['core', 'official', 'community', 'third-party', 'enterprise']
const LICENSE_KINDS: readonly CatalogLicense['kind'][] = ['osi', 'proprietary', 'enterprise', 'unknown']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

function toCatalogModule(value: unknown): CatalogModule | null {
  if (!isRecord(value)) return null
  const license = value.license
  if (
    !isString(value.id) ||
    !isString(value.from) ||
    !isString(value.title) ||
    !isString(value.description) ||
    !isStringArray(value.requires) ||
    !isString(value.locator) ||
    !isStringArray(value.verifiedOn) ||
    !isString(value.install) ||
    !isRecord(license)
  ) {
    return null
  }
  const source = SOURCES.find((candidate) => candidate === value.source)
  const kind = LICENSE_KINDS.find((candidate) => candidate === license.kind)
  if (!source || !kind) return null
  if (!(license.spdx === null || isString(license.spdx))) return null
  const tier = value.tier === 'listed' || value.tier === 'verified' ? value.tier : null
  return {
    id: value.id,
    from: value.from,
    title: value.title,
    description: value.description,
    requires: value.requires,
    source,
    locator: value.locator,
    license: { spdx: license.spdx, kind },
    tier,
    verifiedOn: value.verifiedOn,
    install: value.install,
  }
}

export function parsePickerIndex(value: unknown): PickerIndex | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (!isString(value.generatedAt) || !isStringArray(value.lines) || !Array.isArray(value.modules)) return null
  const modules = value.modules
    .map((entry) => toCatalogModule(entry))
    .filter((entry): entry is CatalogModule => entry !== null)
  return { schemaVersion: 1, generatedAt: value.generatedAt, lines: value.lines, modules }
}

export function resolvePickerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PICKER_URL_ENV]?.trim()
  return override ? override : DEFAULT_PICKER_URL
}

export function catalogLineFor(version: string, lines: readonly string[]): string | null {
  const match = /^(\d+)\.(\d+)\.\d+(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (!match) return null
  const prerelease = match[3] ?? ''
  if (/(^|[.-])develop([.-]|$)/.test(prerelease)) return lines.includes('next') ? 'next' : null
  const key = `${Number(match[1])}.${Number(match[2])}`
  return lines.includes(key) ? key : null
}

export async function fetchPickerCatalog(options: {
  url?: string
  fetchImpl?: CatalogFetch
  timeoutMs?: number
} = {}): Promise<CatalogFetchResult> {
  const url = options.url ?? DEFAULT_PICKER_URL
  const timeoutMs = options.timeoutMs ?? CATALOG_TIMEOUT_MS
  const fetchImpl: CatalogFetch = options.fetchImpl ?? ((target, init) => fetch(target, init))
  let reason = 'no response'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        reason = `HTTP ${response.status}`
        if (response.status < 500) break
        continue
      }
      const index = parsePickerIndex(await response.json())
      if (!index) return { status: 'unavailable', url, reason: 'unsupported picker.json format' }
      return { status: 'ok', url, index }
    } catch (error: unknown) {
      reason = error instanceof Error ? error.message : String(error)
    }
  }
  return { status: 'unavailable', url, reason }
}

export function selectableModules(index: PickerIndex, line: string | null): CatalogModule[] {
  if (line === null) return []
  return index.modules.filter((entry) => entry.source !== 'core' && entry.verifiedOn.includes(line))
}
