import { registerHooks } from 'node:module'

export async function withNextRuntime<T>(load: () => Promise<T>): Promise<T> {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'next/server' || specifier === 'next/headers') {
        return nextResolve(`${specifier}.js`, context)
      }
      return nextResolve(specifier, context)
    },
  })
  try {
    return await load()
  } finally {
    hooks.deregister()
  }
}
