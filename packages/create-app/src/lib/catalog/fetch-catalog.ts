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

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

const printableText = (text: string) => text.replace(CONTROL_CHARACTERS, ' ')

/** Catalog values with every string freed of control characters, which could rewrite the terminal they print to. */
function printable(value: unknown): unknown {
  if (isString(value)) return printableText(value)
  if (Array.isArray(value)) return value.map(printable)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [printableText(key), printable(item)]))
  return value
}

function toInstallByLine(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  const commands: Record<string, string> = {}
  for (const [line, command] of Object.entries(value)) if (isString(command)) commands[line] = command
  return commands
}

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
    installByLine: toInstallByLine(value.installByLine),
    inPresets: isStringArray(value.inPresets) ? value.inPresets : [],
    presetNote: isString(value.presetNote) ? value.presetNote : null,
    conflictsWith: isStringArray(value.conflictsWith) ? value.conflictsWith : [],
    warning: isString(value.warning) && value.warning.trim() !== '' ? value.warning : null,
  }
}

export function parsePickerIndex(value: unknown): PickerIndex | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (!isString(value.generatedAt) || !isStringArray(value.lines) || !Array.isArray(value.modules)) return null
  const modules = value.modules
    .map((entry) => toCatalogModule(printable(entry)))
    .filter((entry): entry is CatalogModule => entry !== null)
  return { schemaVersion: 1, generatedAt: value.generatedAt, lines: value.lines.map(printableText), modules }
}

export function resolvePickerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PICKER_URL_ENV]?.trim()
  return override ? override : DEFAULT_PICKER_URL
}

export function catalogLineFor(version: string, lines: readonly string[]): string | null {
  const match = /^(\d+)\.(\d+)\.\d+(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (!match) return null
  const prerelease = match[3] ?? ''
  const key = `${Number(match[1])}.${Number(match[2])}`
  if (/(^|[.-])develop([.-]|$)/.test(prerelease)) return lines.includes('next') ? 'next' : null
  // A canary previews a pull request: on a release branch its x.y line is in the catalog; on main it is not yet
  // (main moves to the next minor at the release cut), so it runs the unreleased line like a develop snapshot.
  if (/(^|[.-])canary([.-]|$)/.test(prerelease) && !lines.includes(key)) return lines.includes('next') ? 'next' : null
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

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const NPM_NAME_MAX_LENGTH = 214
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const MODULE_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const MODULE_ID_MAX_LENGTH = 64
const ENV_FLAG = /^OM_ENABLE_[A-Z0-9_]+=true$/
const STEP_SEPARATOR = ' && '

type PackageSpec = { name: string; version: string }

type InstallStep =
  | { kind: 'module-add'; spec: PackageSpec; allowThirdParty: boolean; moduleId: string | null }
  | { kind: 'module-enable'; name: string; moduleId: string }
  | { kind: 'package-add'; specs: PackageSpec[] }
  | { kind: 'env-flag'; assignment: string }
  | { kind: 'generate' }

const isPackageName = (token: string | undefined): token is string =>
  token !== undefined && token.length <= NPM_NAME_MAX_LENGTH && NPM_NAME.test(token)

const isModuleId = (token: string | undefined): token is string =>
  token !== undefined && token.length <= MODULE_ID_MAX_LENGTH && MODULE_ID.test(token)

function parsePackageSpec(token: string | undefined): PackageSpec | null {
  if (token === undefined) return null
  const at = token.lastIndexOf('@')
  if (at <= 0) return null
  const name = token.slice(0, at)
  const version = token.slice(at + 1)
  return isPackageName(name) && EXACT_VERSION.test(version) ? { name, version } : null
}

function parseModuleAdd(rest: string[]): InstallStep | null {
  const spec = parsePackageSpec(rest[0])
  if (!spec) return null
  let position = 1
  const allowThirdParty = rest[position] === '--allow-third-party'
  if (allowThirdParty) position += 1
  let moduleId: string | null = null
  if (rest[position] === '--module') {
    if (!isModuleId(rest[position + 1])) return null
    moduleId = rest[position + 1]!
    position += 2
  }
  return position === rest.length ? { kind: 'module-add', spec, allowThirdParty, moduleId } : null
}

function parseInstallStep(segment: string): InstallStep | null {
  const tokens = segment.split(' ')
  const [first, second, third, fourth, ...rest] = tokens
  if (first === 'yarn' && second === 'generate' && tokens.length === 2) return { kind: 'generate' }
  if (first === 'yarn' && second === 'add' && tokens.length > 2) {
    const specs = tokens.slice(2).map(parsePackageSpec)
    return specs.every((spec): spec is PackageSpec => spec !== null) ? { kind: 'package-add', specs } : null
  }
  if (first === 'echo' && tokens.length === 4 && ENV_FLAG.test(second ?? '') && third === '>>' && fourth === '.env') {
    return { kind: 'env-flag', assignment: second! }
  }
  if (first !== 'yarn' || second !== 'mercato' || third !== 'module') return null
  if (fourth === 'add') return parseModuleAdd(rest)
  if (fourth === 'enable' && rest.length === 3 && isPackageName(rest[0]) && rest[1] === '--module' && isModuleId(rest[2])) {
    return { kind: 'module-enable', name: rest[0], moduleId: rest[2] }
  }
  return null
}

const formatPackageSpec = (spec: PackageSpec) => `${spec.name}@${spec.version}`

function formatInstallStep(step: InstallStep): string {
  switch (step.kind) {
    case 'module-add':
      return [
        'yarn mercato module add',
        formatPackageSpec(step.spec),
        ...(step.allowThirdParty ? ['--allow-third-party'] : []),
        ...(step.moduleId ? ['--module', step.moduleId] : []),
      ].join(' ')
    case 'module-enable':
      return `yarn mercato module enable ${step.name} --module ${step.moduleId}`
    case 'package-add':
      return `yarn add ${step.specs.map(formatPackageSpec).join(' ')}`
    case 'env-flag':
      return `echo ${step.assignment} >> .env`
    case 'generate':
      return 'yarn generate'
  }
}

/**
 * The catalog command rebuilt from its parsed steps, or null unless every ` && ` step matches the grammar the
 * catalog emits (`yarn mercato module add|enable`, `yarn add <pkg>@<version>...`, `echo OM_ENABLE_<NAME>=true >> .env`,
 * `yarn generate`) and one of them installs or enables a module: a package, a `module add|enable` or an `OM_ENABLE_*`
 * flag, the way the catalog turns on the enterprise modules a new app registers behind flags. create-app prints and stores the result for the
 * user to paste, so it is an allowlist of exact tokens, not a filter of shell characters.
 */
export function parseInstallCommand(command: string): string | null {
  const steps: InstallStep[] = []
  for (const segment of command.split(STEP_SEPARATOR)) {
    const step = parseInstallStep(segment)
    if (!step) return null
    steps.push(step)
  }
  const installs = steps.some((step) => step.kind !== 'generate')
  return installs ? steps.map(formatInstallStep).join(STEP_SEPARATOR) : null
}

/**
 * Install command for an app on `line`: the catalog's command for that line, else `install` when `line` is the
 * latest line (`lines[0]`). Null otherwise: `install` pins the version verified on the latest line, which was
 * never verified on an older line or on `next`. Null as well for a command outside `parseInstallCommand`'s grammar.
 */
export function installCommandFor(entry: CatalogModule, line: string, lines: readonly string[]): string | null {
  const command = entry.installByLine?.[line] ?? (line === lines[0] ? entry.install : null)
  return typeof command === 'string' ? parseInstallCommand(command) : null
}

const verifiedOnLine = (index: PickerIndex, line: string): CatalogModule[] =>
  index.modules.filter((entry) => entry.source !== 'core' && entry.verifiedOn.includes(line))

/** Non-core modules verified on the line, each with the install command of that line. */
export function selectableModules(index: PickerIndex, line: string | null): CatalogModule[] {
  if (line === null) return []
  return verifiedOnLine(index, line).flatMap((entry) => {
    const install = installCommandFor(entry, line, index.lines)
    return install === null ? [] : [{ ...entry, install }]
  })
}

/** Modules verified on the line for which the catalog gives no install command on that line; left out of the picker. */
export function modulesWithoutLineInstall(index: PickerIndex, line: string | null): CatalogModule[] {
  if (line === null) return []
  return verifiedOnLine(index, line).filter((entry) => installCommandFor(entry, line, index.lines) === null)
}
