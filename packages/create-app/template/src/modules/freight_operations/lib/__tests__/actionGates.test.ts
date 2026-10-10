/** @jest-environment node */
import {
  canDeleteContract,
  canEditContract,
  canEditContractRoutes,
  canEditTrip,
  canExcludeTrip,
  isContractActionAllowed,
  isTripActionAllowed,
} from '../actionGates'

describe('contract action gates', () => {
  it('offers each verb only from the status the command accepts', () => {
    expect(isContractActionAllowed('draft', 'activate')).toBe(true)
    expect(isContractActionAllowed('active', 'activate')).toBe(false)
    expect(isContractActionAllowed('active', 'suspend')).toBe(true)
    expect(isContractActionAllowed('suspended', 'resume')).toBe(true)
    expect(isContractActionAllowed('suspended', 'suspend')).toBe(false)
    expect(isContractActionAllowed('terminated', 'terminate')).toBe(false)
    expect(isContractActionAllowed('draft', 'terminate')).toBe(true)
  })

  it('keeps a terminated contract read-only, rate lines included', () => {
    expect(canEditContract('terminated')).toBe(false)
    expect(canEditContractRoutes('terminated')).toBe(false)
    expect(canEditContract('suspended')).toBe(true)
    expect(canEditContractRoutes('draft')).toBe(true)
    expect(canEditContractRoutes('active')).toBe(true)
  })

  it('deletes only what the server deletes', () => {
    expect(canDeleteContract('draft')).toBe(true)
    expect(canDeleteContract('active')).toBe(false)
    expect(canDeleteContract('terminated')).toBe(false)
  })
})

describe('trip action gates', () => {
  it('walks execution planned → dispatched → in transit → delivered', () => {
    expect(isTripActionAllowed('planned', 'dispatch')).toBe(true)
    expect(isTripActionAllowed('dispatched', 'dispatch')).toBe(false)
    expect(isTripActionAllowed('planned', 'start')).toBe(true)
    expect(isTripActionAllowed('dispatched', 'start')).toBe(true)
    expect(isTripActionAllowed('delivered', 'start')).toBe(false)
    expect(isTripActionAllowed('dispatched', 'deliver')).toBe(true)
    expect(isTripActionAllowed('in_transit', 'deliver')).toBe(true)
    expect(isTripActionAllowed('planned', 'deliver')).toBe(false)
    expect(isTripActionAllowed('cancelled', 'cancel')).toBe(false)
  })

  // The billing lock is the second, independent gate: once a trip sits in an
  // abstract (or is billed/excluded) every write is refused with `trip_locked`.
  it('locks every write outside the unbilled state', () => {
    expect(canEditTrip('unbilled')).toBe(true)
    expect(canEditTrip('in_abstract')).toBe(false)
    expect(canEditTrip('billed')).toBe(false)
    expect(canEditTrip('excluded')).toBe(false)
    expect(canExcludeTrip('unbilled')).toBe(true)
    expect(canExcludeTrip('in_abstract')).toBe(false)
  })
})
