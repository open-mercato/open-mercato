import { resolveBulkReplayStartedMessage } from '../failure-queue-messages'

const translate = (key: string) => key

describe('resolveBulkReplayStartedMessage (#9217)', () => {
  it.each([
    ['retry', 'job-1', 'workflows.failureQueue.messages.retryStarted'],
    ['cancel', 'job-1', 'workflows.failureQueue.messages.cancelStarted'],
    ['retry', null, 'workflows.failureQueue.messages.retryQueued'],
    ['cancel', null, 'workflows.failureQueue.messages.cancelQueued'],
    ['retry', undefined, 'workflows.failureQueue.messages.retryQueued'],
  ] as const)('%s with progressJobId=%s uses %s', (action, progressJobId, expectedKey) => {
    expect(resolveBulkReplayStartedMessage(action, progressJobId, translate)).toBe(expectedKey)
  })
})
