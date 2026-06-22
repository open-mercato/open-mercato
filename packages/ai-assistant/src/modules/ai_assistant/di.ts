import { asValue, asFunction } from 'awilix'
import type { AwilixContainer } from 'awilix'
import { toolRegistry } from './lib/tool-registry'
import { createOpenCodeClient } from './lib/opencode-client'

export function register(container: AwilixContainer): void {
  container.register({
    mcpToolRegistry: asValue(toolRegistry),
    // Injectable OpenCode client so the file-agent runner (and tests, via a
    // fake client) resolve it from DI instead of constructing it inline.
    // Production wiring uses the env-configured factory.
    openCodeClient: asFunction(() => createOpenCodeClient()).singleton(),
  })
}
