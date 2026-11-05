import eventsConfig from '../events'
import { NOTIFICATION_SSE_EVENTS } from '../lib/events'
import { isPortalBroadcastEvent } from '@open-mercato/shared/modules/events'

describe('notification events — portal broadcast contract', () => {
  it('exposes the notifications event registry', () => {
    expect(eventsConfig.moduleId).toBe('notifications')
  })

  describe.each([
    NOTIFICATION_SSE_EVENTS.CREATED,
    NOTIFICATION_SSE_EVENTS.BATCH_CREATED,
  ])('%s', (eventId) => {
    it('is registered for authenticated portal delivery', () => {
      expect(isPortalBroadcastEvent(eventId)).toBe(true)
    })
  })
})
