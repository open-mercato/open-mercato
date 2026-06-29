import type { CommandHandler } from './types'

export type CommandLoader = {
  id?: string | null
  moduleId: string
  key?: string | null
  load: () => Promise<unknown>
}

class CommandRegistry {
  private handlers = new Map<string, CommandHandler>()
  private loadersById = new Map<string, CommandLoader>()
  private fallbackLoadersByModule = new Map<string, Map<string, CommandLoader>>()
  private loadedLoaderKeys = new Set<string>()
  private loadingLoaderKeys = new Map<string, Promise<void>>()
  private didWarnAboutDevelopmentReregistration = false
  private didWarnAboutDevelopmentLoaderReregistration = false

  register(handler: CommandHandler) {
    if (!handler?.id) throw new Error('Command handler must define an id')
    if (this.handlers.has(handler.id)) {
      if (process.env.NODE_ENV === 'development') {
        if (!this.didWarnAboutDevelopmentReregistration) {
          console.debug('[Bootstrap] Commands re-registered (this may occur during HMR)')
          this.didWarnAboutDevelopmentReregistration = true
        }
        this.handlers.set(handler.id, handler)
        return
      }
      throw new Error(`Duplicate command registration for id ${handler.id}`)
    }
    this.handlers.set(handler.id, handler)
  }

  registerLoaders(loaders: CommandLoader[]) {
    for (const loader of loaders) {
      if (!loader?.moduleId) throw new Error('Command loader must define a moduleId')
      if (typeof loader.load !== 'function') throw new Error('Command loader must define a load function')

      if (loader.id) {
        if (this.loadersById.has(loader.id) && process.env.NODE_ENV !== 'development') {
          throw new Error(`Duplicate command loader registration for id ${loader.id}`)
        }
        if (this.loadersById.has(loader.id) && process.env.NODE_ENV === 'development' && !this.didWarnAboutDevelopmentLoaderReregistration) {
          console.debug('[Bootstrap] Command loaders re-registered (this may occur during HMR)')
          this.didWarnAboutDevelopmentLoaderReregistration = true
        }
        this.loadersById.set(loader.id, loader)
        continue
      }

      const key = loader.key ?? `${loader.moduleId}:fallback:${this.fallbackLoadersByModule.get(loader.moduleId)?.size ?? 0}`
      const existing = this.fallbackLoadersByModule.get(loader.moduleId) ?? new Map<string, CommandLoader>()
      if (existing.has(key) && process.env.NODE_ENV !== 'development') {
        throw new Error(`Duplicate command loader registration for key ${key}`)
      }
      if (existing.has(key) && process.env.NODE_ENV === 'development' && !this.didWarnAboutDevelopmentLoaderReregistration) {
        console.debug('[Bootstrap] Command loaders re-registered (this may occur during HMR)')
        this.didWarnAboutDevelopmentLoaderReregistration = true
      }
      existing.set(key, loader)
      this.fallbackLoadersByModule.set(loader.moduleId, existing)
    }
  }

  unregister(id: string) {
    this.handlers.delete(id)
  }

  get<TInput = unknown, TResult = unknown>(id: string): CommandHandler<TInput, TResult> | null {
    return (this.handlers.get(id) as CommandHandler<TInput, TResult> | undefined) ?? null
  }

  has(id: string): boolean {
    return this.handlers.has(id) || this.loadersById.has(id)
  }

  /**
   * List all known command IDs, including exact lazy loaders that have not
   * been imported yet.
   */
  list(): string[] {
    return Array.from(new Set([...this.handlers.keys(), ...this.loadersById.keys()]))
  }

  async load(commandId: string): Promise<CommandHandler | null> {
    const existing = this.get(commandId)
    if (existing) return existing

    const moduleId = commandId.split('.')[0]
    const exact = this.loadersById.get(commandId)
    if (exact) {
      await this.loadOnce(exact.key ?? commandId, exact)
      const loaded = this.get(commandId)
      if (loaded) {
        await this.loadModuleFallbacks(moduleId)
        return loaded
      }
    }

    await this.loadModuleFallbacks(moduleId)

    return this.get(commandId)
  }

  listLoaders(): string[] {
    return [
      ...Array.from(this.loadersById.keys()),
      ...Array.from(this.fallbackLoadersByModule.values()).flatMap((loaders) => Array.from(loaders.keys())),
    ]
  }

  clear() {
    this.handlers.clear()
    this.loadersById.clear()
    this.fallbackLoadersByModule.clear()
    this.loadedLoaderKeys.clear()
    this.loadingLoaderKeys.clear()
    this.didWarnAboutDevelopmentReregistration = false
    this.didWarnAboutDevelopmentLoaderReregistration = false
  }

  private async loadOnce(key: string, loader: CommandLoader): Promise<void> {
    if (this.loadedLoaderKeys.has(key)) return
    const pending = this.loadingLoaderKeys.get(key)
    if (pending) return pending

    const promise = Promise.resolve()
      .then(() => loader.load())
      .then(() => {
        this.loadedLoaderKeys.add(key)
      })
      .finally(() => {
        this.loadingLoaderKeys.delete(key)
      })

    this.loadingLoaderKeys.set(key, promise)
    return promise
  }

  private async loadModuleFallbacks(moduleId: string): Promise<void> {
    const fallbacks = Array.from(this.fallbackLoadersByModule.get(moduleId)?.entries() ?? [])
    for (const [key, loader] of fallbacks) {
      await this.loadOnce(key, loader)
    }
  }
}

export const commandRegistry = new CommandRegistry()

export function registerCommand(handler: CommandHandler) {
  commandRegistry.register(handler)
}

export function unregisterCommand(id: string) {
  commandRegistry.unregister(id)
}

export function registerCommandLoaders(loaders: CommandLoader[]) {
  commandRegistry.registerLoaders(loaders)
}
