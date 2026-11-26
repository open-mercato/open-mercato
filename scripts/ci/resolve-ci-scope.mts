// Pure CI scope resolver: changed files + PR labels → test level, integration modules, lane.
// Config lives in .github/ci-scope.json (schema next to it). Design and rollout:
// .ai/specs/2026-11-25-batch-merge-and-green-tag-release-process.md, Phase 2.
// Not wired into ci.yml yet: the prepare job still runs its inline FULL_SUITE_PATTERN /
// FORCE_FULL_SUITE logic, and scripts/__tests__/resolve-ci-scope.test.ts proves the two agree
// for unlabelled PRs. Run with plain `node` — Node strips the type annotations.

export const SCOPE_CONTROL_PATHS: readonly string[] = [
  '.github/ci-scope.json',
  '.github/ci-scope.schema.json',
  'scripts/ci/resolve-ci-scope.mts',
]

export const AREA_LABEL_PREFIX = 'ci-area:'
const CI_LABEL_PREFIX = 'ci-'
const DEFAULT_LEVEL = 'scoped'
const MODULE_PATH_PATTERN = /(?:packages\/[^/]+|apps\/[^/]+)\/src\/modules\/([^/]+)/g

export type CiScopeConfig = {
  default: 'scoped'
  levels: string[]
  implies: Record<string, string>
  areas: Record<string, string[]>
  ignoredLabels: string[]
  fullSuitePatterns: string[]
  docsOnly: string[]
}

export type CiScopeInput = {
  event?: 'pull_request' | 'push'
  changedFiles: readonly string[]
  labels: readonly string[]
  headRef: string
  baseRef: string
  isFork: boolean
}

export type CiScopeLane = 'code' | 'docs'

export type CiScopeResult = {
  level: string
  lane: CiScopeLane
  modules: string[]
  changedModules: string[]
  areas: string[]
  skipIntegration: boolean
  reasons: string[]
  summary: string
}

export class CiScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CiScopeError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new CiScopeError(`ci-scope.json: "${field}" must be an array of non-empty strings`)
  }
  return value as string[]
}

const CONFIG_KEYS = ['default', 'levels', 'implies', 'areas', 'ignoredLabels', 'fullSuitePatterns', 'docsOnly']

export function parseCiScopeConfig(raw: unknown): CiScopeConfig {
  if (!isRecord(raw)) throw new CiScopeError('ci-scope.json: expected a JSON object')
  for (const key of Object.keys(raw)) {
    if (key !== '$schema' && !CONFIG_KEYS.includes(key)) throw new CiScopeError(`ci-scope.json: unknown key "${key}"`)
  }
  if (raw.default !== DEFAULT_LEVEL) throw new CiScopeError(`ci-scope.json: "default" must be "${DEFAULT_LEVEL}"`)

  const levels = stringArray(raw.levels, 'levels')
  if (levels.length === 0) throw new CiScopeError('ci-scope.json: "levels" must not be empty')
  for (const label of levels) {
    if (!/^ci-[a-z][a-z0-9-]*$/.test(label)) throw new CiScopeError(`ci-scope.json: level label "${label}" must look like ci-<name>`)
  }
  if (new Set(levels).size !== levels.length) throw new CiScopeError('ci-scope.json: duplicate level label')

  if (!isRecord(raw.implies)) throw new CiScopeError('ci-scope.json: "implies" must be an object')
  const implies: Record<string, string> = {}
  for (const [label, level] of Object.entries(raw.implies)) {
    if (typeof level !== 'string' || !levels.includes(level)) {
      throw new CiScopeError(`ci-scope.json: implies["${label}"] must be one of ${levels.join(', ')}`)
    }
    implies[label] = level
  }

  if (!isRecord(raw.areas)) throw new CiScopeError('ci-scope.json: "areas" must be an object')
  const areas: Record<string, string[]> = {}
  const owner = new Map<string, string>()
  for (const [area, modules] of Object.entries(raw.areas)) {
    if (!/^[a-z][a-z0-9-]*$/.test(area)) throw new CiScopeError(`ci-scope.json: area name "${area}" must be kebab-case`)
    const list = stringArray(modules, `areas.${area}`)
    if (list.length === 0) throw new CiScopeError(`ci-scope.json: area "${area}" has no modules`)
    for (const moduleId of list) {
      const previous = owner.get(moduleId)
      if (previous) throw new CiScopeError(`ci-scope.json: module "${moduleId}" is in both "${previous}" and "${area}"`)
      owner.set(moduleId, area)
    }
    areas[area] = list
  }

  const ignoredLabels = stringArray(raw.ignoredLabels, 'ignoredLabels')
  const fullSuitePatterns = stringArray(raw.fullSuitePatterns, 'fullSuitePatterns')
  if (fullSuitePatterns.length === 0) throw new CiScopeError('ci-scope.json: "fullSuitePatterns" must not be empty')
  for (const pattern of fullSuitePatterns) {
    try {
      new RegExp(pattern)
    } catch {
      throw new CiScopeError(`ci-scope.json: fullSuitePatterns entry "${pattern}" is not a valid regular expression`)
    }
  }
  const docsOnly = stringArray(raw.docsOnly, 'docsOnly')

  return { default: DEFAULT_LEVEL, levels, implies, areas, ignoredLabels, fullSuitePatterns, docsOnly }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') {
        source += '(?:[^/]+/)*'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += escapeRegExp(char)
    }
  }
  return new RegExp(`^${source}$`)
}

function labelPatternMatches(pattern: string, label: string): boolean {
  if (!pattern.includes('*')) return pattern === label
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`).test(label)
}

export function extractChangedModules(changedFiles: readonly string[]): string[] {
  const modules = new Set<string>()
  for (const file of changedFiles) {
    for (const match of file.matchAll(MODULE_PATH_PATTERN)) modules.add(match[1])
  }
  return [...modules].sort()
}

export function fullSuitePattern(config: CiScopeConfig): RegExp {
  return new RegExp(config.fullSuitePatterns.join('|'))
}

export function validateCiLabels(labels: readonly string[], config: CiScopeConfig): void {
  const unknown = labels.filter((label) => {
    if (!label.startsWith(CI_LABEL_PREFIX)) return false
    if (config.levels.includes(label) || config.ignoredLabels.includes(label)) return false
    if (label.startsWith(AREA_LABEL_PREFIX)) return !(label.slice(AREA_LABEL_PREFIX.length) in config.areas)
    return true
  })
  if (unknown.length === 0) return
  const known = [...config.levels, ...Object.keys(config.areas).map((area) => `${AREA_LABEL_PREFIX}${area}`)]
  throw new CiScopeError(
    `Unknown CI label${unknown.length > 1 ? 's' : ''} ${unknown.map((label) => `"${label}"`).join(', ')}. ` +
      `Known ci-* labels: ${known.join(', ')}. Fix the label on the PR, or add it to .github/ci-scope.json.`,
  )
}

export function isScopeLabel(label: string, config: CiScopeConfig): boolean {
  if (config.ignoredLabels.includes(label)) return false
  if (label.startsWith(CI_LABEL_PREFIX)) return true
  return Object.keys(config.implies).some((pattern) => labelPatternMatches(pattern, label))
}

function levelName(label: string): string {
  return label.slice(CI_LABEL_PREFIX.length)
}

export function resolveCiScope(input: CiScopeInput, config: CiScopeConfig): CiScopeResult {
  validateCiLabels(input.labels, config)

  const ranks = [DEFAULT_LEVEL, ...config.levels.map(levelName)]
  const fullLevel = ranks[ranks.length - 1]
  const lowestRaisedLevel = ranks[1]
  let level = DEFAULT_LEVEL
  const reasons: string[] = []
  const raise = (target: string, reason: string) => {
    reasons.push(reason)
    if (ranks.indexOf(target) > ranks.indexOf(level)) level = target
  }

  const changedModules = extractChangedModules(input.changedFiles)
  const event = input.event ?? 'pull_request'

  if (event !== 'pull_request') raise(fullLevel, `${event} event`)

  const controlFiles = input.changedFiles.filter((file) => SCOPE_CONTROL_PATHS.includes(file))
  if (controlFiles.length > 0) raise(fullLevel, `CI scope files changed (${controlFiles.join(', ')})`)

  const sharedPattern = fullSuitePattern(config)
  const sharedFiles = input.changedFiles.filter((file) => sharedPattern.test(file))
  if (sharedFiles.length > 0) raise(fullLevel, `shared code changed (${sharedFiles.length} file${sharedFiles.length > 1 ? 's' : ''}, e.g. ${sharedFiles[0]})`)

  const areas: string[] = []
  if (event === 'pull_request' && !input.isFork) {
    if (input.headRef.startsWith('stabilize/')) raise(fullLevel, `stabilization branch ${input.headRef}`)
    for (const label of input.labels) {
      if (config.levels.includes(label)) raise(levelName(label), `label ${label}`)
      else if (label.startsWith(AREA_LABEL_PREFIX)) {
        const area = label.slice(AREA_LABEL_PREFIX.length)
        areas.push(area)
        raise(lowestRaisedLevel, `label ${label}`)
      } else {
        const implied = Object.entries(config.implies).find(([pattern]) => labelPatternMatches(pattern, label))
        if (implied) raise(levelName(implied[1]), `label ${label} implies ${implied[1]}`)
      }
    }
  } else if (event === 'pull_request' && input.labels.some((label) => isScopeLabel(label, config))) {
    reasons.push('fork PR: labels do not change the scope')
  }
  areas.sort()

  const areaModules = areas.flatMap((area) => config.areas[area])
  const modules = level === fullLevel ? [] : [...new Set([...changedModules, ...areaModules])].sort()
  const skipIntegration = level !== fullLevel && modules.length === 0

  const docsPatterns = config.docsOnly.map(globToRegExp)
  const docsOnly = input.changedFiles.length > 0 && input.changedFiles.every((file) => docsPatterns.some((pattern) => pattern.test(file)))
  const lane: CiScopeLane = docsOnly && level === DEFAULT_LEVEL && modules.length === 0 ? 'docs' : 'code'

  return {
    level,
    lane,
    modules,
    changedModules,
    areas,
    skipIntegration,
    reasons,
    summary: summarize({ level, lane, changedModules, areas, reasons, fullLevel, skipIntegration }),
  }
}

function summarize({ level, lane, changedModules, areas, reasons, fullLevel, skipIntegration }: {
  level: string
  lane: CiScopeLane
  changedModules: string[]
  areas: string[]
  reasons: string[]
  fullLevel: string
  skipIntegration: boolean
}): string {
  if (lane === 'docs') return `${level} · docs lane (documentation-only change)`
  if (level === fullLevel) return `${level} · ${reasons.join('; ')}`
  if (skipIntegration) return `${level} · no integration tests (no module changed)${reasons.length ? ` · ${reasons.join('; ')}` : ''}`
  const parts: string[] = []
  if (changedModules.length) parts.push(`${changedModules.join(', ')} (changed)`)
  for (const area of areas) parts.push(`${area} area (label)`)
  const extra = reasons.filter((reason) => !reason.startsWith(`label ${AREA_LABEL_PREFIX}`))
  return `${level} · ${parts.join(' + ')}${extra.length ? ` · ${extra.join('; ')}` : ''}`
}
