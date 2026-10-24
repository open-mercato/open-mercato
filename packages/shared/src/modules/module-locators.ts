export type ModuleLocator = {
  kind: 'module' | 'npm' | 'github'
  identity: string
  installSpecifier?: string
}

export type ModuleIdentity = {
  id: string
  locators?: readonly string[]
}

export function parseModuleLocator(input: string): ModuleLocator | null {
  const value = input.trim().replace(/^https:\/\/github\.com\/https:\/\/github\.com\//i, 'https://github.com/')
  if (!value || /\s/.test(value)) return null
  if (/^[a-z][a-z0-9_]*$/.test(value)) return { kind: 'module', identity: value }
  const npmValue = value.startsWith('npm:') ? value.slice(4) : value
  if (value.startsWith('npm:') || npmValue.startsWith('@')) {
    const match = npmValue.match(/^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@[A-Za-z0-9][A-Za-z0-9._-]*)?$/)
    if (!match || match[1].length > 214) return null
    return { kind: 'npm', identity: `npm:${match[1]}`, installSpecifier: npmValue }
  }
  const githubValue = value
    .replace(/^github:/i, '')
    .replace(/^github\.com\//i, '')
    .replace(/^(?:git\+)?https?:\/\/github\.com\//i, '')
    .replace(/^(?:git\+)?ssh:\/\/(?:git@)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
  const githubMatch = githubValue.match(/^([a-z0-9][a-z0-9-]*)\/([a-z0-9._-]+?)(?:\.git)?(?:[#@][A-Za-z0-9][A-Za-z0-9._/-]{0,254})?\/?$/i)
  if (/^github:[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    return { kind: 'github', identity: value.toLowerCase(), installSpecifier: value }
  }
  if (githubMatch) {
    const repository = `${githubMatch[1]}/${githubMatch[2]}`.toLowerCase()
    return { kind: 'github', identity: `github:${repository}`, installSpecifier: value }
  }
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    return { kind: 'github', identity: `github:${value.toLowerCase()}`, installSpecifier: value }
  }
  return null
}

export function normalizeModuleLocator(value: string): string | null {
  return parseModuleLocator(value)?.identity ?? null
}

export function resolveModuleRequirement(requirement: string, modules: readonly ModuleIdentity[]): string | undefined {
  const direct = modules.find((module) => module.id === requirement)
  if (direct) return direct.id
  const parsed = parseModuleLocator(requirement)
  if (!parsed || parsed.kind === 'module') return undefined
  const matches = modules.filter((module) => module.locators?.some((locator) => normalizeModuleLocator(locator) === parsed.identity))
  if (matches.length > 0) return matches[0].id
  const repositoryName = requirement.replace(/^github:/i, '')
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(repositoryName)) {
    const repositories = new Map<string, string>()
    for (const module of modules) {
      for (const locator of module.locators ?? []) {
        const source = parseModuleLocator(locator)
        if (source?.kind === 'github' && source.identity.endsWith(`/${repositoryName.toLowerCase()}`) && !repositories.has(source.identity)) {
          repositories.set(source.identity, module.id)
        }
      }
    }
    if (repositories.size === 1) return repositories.values().next().value
  }
  return undefined
}

export function getModuleRequirementHint(requirement: string): string {
  const locator = parseModuleLocator(requirement)
  if (!locator || locator.kind === 'module') return `Enable module '${requirement}' in src/modules.ts.`
  const specifier = requirement.trim()
  const escaped = specifier.replace(/'/g, "'\\''")
  return `npx create-mercato-module install '${escaped}'`
}
