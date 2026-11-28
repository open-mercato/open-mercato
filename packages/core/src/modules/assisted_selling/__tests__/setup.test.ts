import { features } from '../acl'
import { metadata } from '../index'
import { setup } from '../setup'
import { eventsConfig } from '../events'

describe('assisted_selling registration (§6.9)', () => {
  it('declares the six §6.9 features', () => {
    expect(features.map((feature) => feature.id).sort()).toEqual([
      'assisted_selling.attributions.view',
      'assisted_selling.messages.post',
      'assisted_selling.proposals.author',
      'assisted_selling.settings.manage',
      'assisted_selling.threads.participate',
      'assisted_selling.threads.view',
    ])
  })

  it('requires cart and is ejectable', () => {
    expect(metadata.requires).toEqual(['cart'])
    expect(metadata.ejectable).toBe(true)
  })

  it('grants admin the module wildcard', () => {
    expect(setup.defaultRoleFeatures?.admin).toEqual(['assisted_selling.*'])
  })

  it('grants employee conversation access and cart.proposals.view, nothing more (D-R5-AS1)', () => {
    expect(setup.defaultRoleFeatures?.employee).toEqual([
      'assisted_selling.threads.view',
      'assisted_selling.threads.participate',
      'assisted_selling.messages.post',
      'cart.proposals.view',
    ])
  })

  it('keeps authoring, attribution and settings away from employee', () => {
    const employee = setup.defaultRoleFeatures?.employee ?? []
    expect(employee).not.toContain('assisted_selling.proposals.author')
    expect(employee).not.toContain('assisted_selling.attributions.view')
    expect(employee).not.toContain('assisted_selling.settings.manage')
  })
})

describe('assisted_selling events (§6.8)', () => {
  const ids = eventsConfig.events.map((event) => event.id)

  it('declares the twelve §6.8 ids and no reopened id', () => {
    expect(ids).toHaveLength(12)
    expect(ids).not.toContain('assisted_selling.proposal.reopened')
  })

  it('does not broadcast the operator-facing attribution.degraded event', () => {
    const degraded = eventsConfig.events.find((event) => event.id === 'assisted_selling.attribution.degraded')
    expect(degraded).toBeDefined()
    expect(degraded?.clientBroadcast).not.toBe(true)
  })
})
