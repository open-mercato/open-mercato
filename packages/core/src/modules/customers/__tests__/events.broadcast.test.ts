import eventsConfig from '../events'
import { isBroadcastEvent } from '@open-mercato/shared/modules/events'

describe('customers events — DOM broadcast contract', () => {
  it('exposes the customers event registry', () => {
    expect(eventsConfig.moduleId).toBe('customers')
  })

  describe.each([
    ['customers.person_company_link.created'],
    ['customers.person_company_link.updated'],
    ['customers.person_company_link.deleted'],
  ])('%s', (eventId) => {
    it('is registered with clientBroadcast: true so the DOM event bridge picks it up', () => {
      expect(isBroadcastEvent(eventId)).toBe(true)
    })
  })

  it('does not silently broadcast non-link CRUD events that should stay server-only', () => {
    expect(isBroadcastEvent('customers.person.created')).toBe(false)
    expect(isBroadcastEvent('customers.company.deleted')).toBe(false)
  })
})
