import type { AwilixContainer } from 'awilix'
import type { EventBus } from '@open-mercato/events/types'

export function resolveOptionalEventBus(container: AwilixContainer): EventBus | null {
  try {
    return container.resolve('eventBus') as EventBus
  } catch (error) {
    console.warn(
      '[inbox_ops] Event bus unavailable:',
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

