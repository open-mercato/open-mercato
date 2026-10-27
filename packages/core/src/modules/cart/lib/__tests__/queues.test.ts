// BullMQ's `QueueBase` constructor rejects any queue name containing `:`
// (`bullmq/dist/cjs/classes/queue-base.js`: `if (name.includes(':')) throw new Error('Queue
// name cannot contain :')`), which stops the worker under `QUEUE_STRATEGY=async`. The four
// sweeper queues here used to be `cart:mark-abandoned` etc — this pins the fix (hyphenated
// names) so a future queue added to this file can't regress the same way.
import {
  CART_EXPIRE_QUEUE,
  CART_MARK_ABANDONED_QUEUE,
  CART_PURGE_EXPIRED_QUEUE,
  CART_RELEASE_STALE_LOCKS_QUEUE,
} from '../queues'

describe('cart queue names', () => {
  it('never contain a colon', () => {
    for (const queueName of [
      CART_MARK_ABANDONED_QUEUE,
      CART_EXPIRE_QUEUE,
      CART_RELEASE_STALE_LOCKS_QUEUE,
      CART_PURGE_EXPIRED_QUEUE,
    ]) {
      expect(queueName.includes(':')).toBe(false)
    }
  })
})
