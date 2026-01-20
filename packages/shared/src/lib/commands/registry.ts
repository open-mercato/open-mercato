import type { CommandHandler } from './types'

class CommandRegistry {
  private handlers = new Map<string, CommandHandler>()

  register(handler: CommandHandler) {
    if (!handler?.id) throw new Error('Command handler must define an id')
    if (this.handlers.has(handler.id)) {
      throw new Error(`Duplicate command registration for id ${handler.id}`)
    }
    this.handlers.set(handler.id, handler)
  }

  unregister(id: string) {
    this.handlers.delete(id)
  }

  get<TInput = unknown, TResult = unknown>(id: string): CommandHandler<TInput, TResult> | null {
    return (this.handlers.get(id) as CommandHandler<TInput, TResult> | undefined) ?? null
  }

  has(id: string): boolean {
    return this.handlers.has(id)
  }

  /**
   * List all registered command handler IDs.
   */
  list(): string[] {
    return Array.from(this.handlers.keys())
  }

  clear() {
    this.handlers.clear()
  }
}

export const commandRegistry = new CommandRegistry()

export function registerCommand(handler: CommandHandler) {
  commandRegistry.register(handler)
}

export function unregisterCommand(id: string) {
  commandRegistry.unregister(id)
}
