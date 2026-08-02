import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ReferenceTask, ReferenceTaskLink, ReferenceTaskUndoSnapshot } from './data/entities'
import { invalidateReferenceTaskCache, readReferenceTaskCache, writeReferenceTaskCache } from './lib/task-cache'

export function register(container: AppContainer): void {
  container.register({
    ReferenceTask: asValue(ReferenceTask),
    ReferenceTaskLink: asValue(ReferenceTaskLink),
    ReferenceTaskUndoSnapshot: asValue(ReferenceTaskUndoSnapshot),
    referenceTaskCacheRead: asValue(readReferenceTaskCache),
    referenceTaskCacheWrite: asValue(writeReferenceTaskCache),
    referenceTaskCacheInvalidate: asValue(invalidateReferenceTaskCache),
  })
}
