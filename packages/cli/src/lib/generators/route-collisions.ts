export type BackendRouteRegistration = {
  routePath: string
  moduleId: string
  packageSourced: boolean
}

export type BackendRouteCollisionResult = {
  errors: string[]
  notes: string[]
}

export function detectBackendRouteCollisions(
  registrations: BackendRouteRegistration[],
): BackendRouteCollisionResult {
  const byPath = new Map<string, BackendRouteRegistration[]>()
  for (const registration of registrations) {
    const existing = byPath.get(registration.routePath)
    if (existing) existing.push(registration)
    else byPath.set(registration.routePath, [registration])
  }

  const errors: string[] = []
  const notes: string[] = []
  for (const [routePath, entries] of byPath) {
    const moduleIds = new Set(entries.map((entry) => entry.moduleId))
    if (moduleIds.size < 2) continue

    const packageModuleIds = Array.from(
      new Set(entries.filter((entry) => entry.packageSourced).map((entry) => entry.moduleId)),
    ).sort((a, b) => a.localeCompare(b))

    if (packageModuleIds.length >= 2) {
      errors.push(
        `Backend route "${routePath}" is registered by ${packageModuleIds.length} package modules: ${packageModuleIds
          .map((id) => `"${id}"`)
          .join(', ')}. Duplicate backend paths between package modules are always a bug — rename one module's page directory.`,
      )
      continue
    }

    const appModuleIds = Array.from(
      new Set(entries.filter((entry) => !entry.packageSourced).map((entry) => entry.moduleId)),
    ).sort((a, b) => a.localeCompare(b))
    const shadowedId = packageModuleIds[0]
    notes.push(
      shadowedId
        ? `Backend route "${routePath}" from package module "${shadowedId}" is shadowed by app module(s) ${appModuleIds
            .map((id) => `"${id}"`)
            .join(', ')} (intentional override mechanism).`
        : `Backend route "${routePath}" is registered by multiple app modules: ${appModuleIds
            .map((id) => `"${id}"`)
            .join(', ')}.`,
    )
  }

  return { errors, notes }
}
