import { assertInboundDeliverable } from '../queue-strategy'

/**
 * Regression guard for #4978.
 *
 * `start-gateway` runs a worker for the `channel_discord_gateway` queue only,
 * while the bridge enqueues into `communication-channels-inbound` / `-reactions`,
 * whose workers live in the app server process. Under the DEFAULT
 * `QUEUE_STRATEGY=local` the queue is in-process, so those jobs never cross the
 * process boundary — QA saw zero rows, zero errors, zero log lines, and had to
 * reach for an external WebSocket probe to tell a dead socket from a lost job.
 */
describe('assertInboundDeliverable', () => {
  it('allows the gateway to start when the queue is async', () => {
    expect(() => assertInboundDeliverable('async')).not.toThrow()
  })

  it('refuses to start on the default in-process strategy', () => {
    expect(() => assertInboundDeliverable(undefined)).toThrow(/QUEUE_STRATEGY=async/)
  })

  it('refuses to start when local is set explicitly', () => {
    expect(() => assertInboundDeliverable('local')).toThrow(/QUEUE_STRATEGY=async/)
  })

  it('refuses an unrecognised value rather than guessing', () => {
    expect(() => assertInboundDeliverable('redis')).toThrow(/QUEUE_STRATEGY=async/)
  })

  it('explains the consequence, not just the rule', () => {
    expect(() => assertInboundDeliverable('local')).toThrow(/silently dropped/)
  })
})
