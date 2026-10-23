import { applyWebhookActiveState } from '../activation'

describe('applyWebhookActiveState', () => {
  it('resets the failure counter when an inactive webhook is re-activated', () => {
    const webhook = { isActive: false, consecutiveFailures: 2 }
    applyWebhookActiveState(webhook, true)
    expect(webhook).toEqual({ isActive: true, consecutiveFailures: 0 })
  })

  it('keeps the failure counter when an already active webhook is saved as active', () => {
    const webhook = { isActive: true, consecutiveFailures: 1 }
    applyWebhookActiveState(webhook, true)
    expect(webhook).toEqual({ isActive: true, consecutiveFailures: 1 })
  })

  it('keeps the failure counter when a webhook is deactivated', () => {
    const webhook = { isActive: true, consecutiveFailures: 1 }
    applyWebhookActiveState(webhook, false)
    expect(webhook).toEqual({ isActive: false, consecutiveFailures: 1 })
  })
})
