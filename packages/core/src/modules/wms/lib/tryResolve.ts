/** Per-module local soft-resolve helper — see `packages/core/AGENTS.md` § Cross-Module Coupling. */
export function tryResolve<T>(resolver: { resolve: <R = unknown>(name: string) => R }, name: string): T | undefined {
  try {
    return resolver.resolve<T>(name)
  } catch {
    return undefined
  }
}
