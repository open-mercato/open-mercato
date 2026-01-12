import { asValue } from 'awilix'
import type { AwilixContainer } from 'awilix'
import { toolRegistry } from './lib/tool-registry'

export function register(container: AwilixContainer): void {
  container.register({
    mcpToolRegistry: asValue(toolRegistry),
  })
}
