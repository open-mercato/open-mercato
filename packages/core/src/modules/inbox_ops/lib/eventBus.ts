import type { AwilixContainer } from 'awilix'
import type { EventBus } from '@open-mercato/events/types'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('inbox_ops')

export function resolveOptionalEventBus(container: AwilixContainer): EventBus | null {
  try {
    return container.resolve('eventBus') as EventBus
  } catch (error) {
    logger.warn('Event bus unavailable', { err: error })
    return null
  }
}

