export function tryResolve<T>(resolver: { resolve: <R = unknown>(name: string) => R }, name: string): T | undefined {
  try {
    return resolver.resolve<T>(name)
  } catch {
    return undefined
  }
}
