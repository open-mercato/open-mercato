import type { ResolveOptions } from 'awilix'

export function tryResolve<T>(resolver: { resolve: <R = unknown>(name: string, options?: ResolveOptions) => R }, name: string): T | undefined {
  return resolver.resolve<T | undefined>(name, { allowUnregistered: true })
}
