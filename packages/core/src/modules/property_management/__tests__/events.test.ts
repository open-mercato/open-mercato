/** @jest-environment node */
import eventsConfig from '../events'

describe('property_management events', () => {
  it('hides proposal approval and decline from workflow triggers until the portal emits them', () => {
    const notYetEmitted = ['property_management.lease_proposal.approved', 'property_management.lease_proposal.declined']
    for (const id of notYetEmitted) {
      expect(eventsConfig.events.find((event) => event.id === id)).toMatchObject({ id, excludeFromTriggers: true })
    }
  })

  it('keeps the proposal events the backoffice already emits available as triggers', () => {
    for (const id of ['property_management.lease_proposal.sent', 'property_management.lease_proposal.withdrawn', 'property_management.lease_proposal.expired']) {
      expect(eventsConfig.events.find((event) => event.id === id)?.excludeFromTriggers).not.toBe(true)
    }
  })
})
