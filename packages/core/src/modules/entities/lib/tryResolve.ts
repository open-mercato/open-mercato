import type { AwilixContainer } from 'awilix'

export function tryResolve<T>(resolver: Pick<AwilixContainer, 'resolve'>, name: string): T | undefined {
  return resolver.resolve<T>(name, { allowUnregistered: true })
}
