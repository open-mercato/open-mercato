import { features } from '../acl'
import { notificationTypes } from '../notifications'

describe('staff leave request notification actions', () => {
  const pendingType = notificationTypes.find((type) => type.type === 'staff.leave_request.pending')

  it.each(['approve', 'reject'])('%s requires the leave request management feature', (actionId) => {
    const action = pendingType?.actions.find((candidate) => candidate.id === actionId)

    expect(action?.commandId).toBeTruthy()
    expect(action?.requiredFeatures).toEqual(['staff.leave_requests.manage'])
  })

  it('declares only features the staff module defines', () => {
    const featureIds = new Set(features.map((feature) => feature.id))
    for (const action of pendingType?.actions ?? []) {
      for (const feature of action.requiredFeatures ?? []) {
        expect(featureIds.has(feature)).toBe(true)
      }
    }
  })
})
