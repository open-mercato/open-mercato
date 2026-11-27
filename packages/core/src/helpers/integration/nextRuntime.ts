import { registerHooks } from 'node:module'

const nextEntryPoints = new Set(['next/server', 'next/headers', 'next/navigation', 'next/link', 'next/dynamic'])

export async function withNextRuntime<T>(run: () => Promise<T>): Promise<T> {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (nextEntryPoints.has(specifier)) {
        return nextResolve(`${specifier}.js`, context)
      }
      return nextResolve(specifier, context)
    },
  })
  try {
    return await run()
  } finally {
    hooks.deregister()
  }
}
