/** Per-module local soft-resolve helper — see `packages/core/AGENTS.md` § Cross-Module Coupling. */
export function tryResolve<T>(resolver: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return (resolver.resolve(name) as T | undefined) ?? null
  } catch {
    return null
  }
}
