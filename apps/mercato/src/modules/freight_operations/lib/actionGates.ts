import type { ContractStatus, TripBillingStatus, TripExecutionStatus } from '../data/entities'
import { CONTRACT_STATUS_VALUES, TRIP_BILLING_STATUS_VALUES, TRIP_EXECUTION_STATUS_VALUES } from './freightEnums'

export { CONTRACT_STATUS_VALUES, TRIP_BILLING_STATUS_VALUES, TRIP_EXECUTION_STATUS_VALUES }

/**
 * What each freight lifecycle verb allows, as pure data.
 *
 * Type-only imports keep this module safe for client bundles: importing the
 * entity module itself would drag ORM decorators into the browser. The server
 * still owns the final word (each command re-checks and raises its own 409) —
 * these gates exist so a screen never offers a verb the command will refuse.
 */

export type ContractAction = 'activate' | 'suspend' | 'resume' | 'terminate'

export const CONTRACT_ACTION_SOURCE_STATUSES: Record<ContractAction, readonly ContractStatus[]> = {
  activate: ['draft'],
  suspend: ['active'],
  resume: ['suspended'],
  terminate: ['draft', 'active', 'suspended'],
}

export function isContractActionAllowed(status: ContractStatus, action: ContractAction): boolean {
  return CONTRACT_ACTION_SOURCE_STATUSES[action].includes(status)
}

/** A terminated contract refuses edits, and rate lines follow the parent. */
export function canEditContract(status: ContractStatus): boolean {
  return status !== 'terminated'
}

export function canEditContractRoutes(status: ContractStatus): boolean {
  return status === 'draft' || status === 'active'
}

export function canDeleteContract(status: ContractStatus): boolean {
  return status === 'draft'
}

export type TripAction = 'dispatch' | 'start' | 'deliver' | 'cancel'

export const TRIP_ACTION_SOURCE_STATUSES: Record<TripAction, readonly TripExecutionStatus[]> = {
  dispatch: ['planned'],
  start: ['planned', 'dispatched'],
  deliver: ['dispatched', 'in_transit'],
  cancel: ['planned', 'dispatched', 'in_transit', 'delivered'],
}

export function isTripActionAllowed(executionStatus: TripExecutionStatus, action: TripAction): boolean {
  return TRIP_ACTION_SOURCE_STATUSES[action].includes(executionStatus)
}

/**
 * The trip screen has two independent gates: `execution_status` decides which
 * lifecycle verbs appear, and the billing lock decides whether the record is
 * editable at all — a trip inside an abstract, billed or excluded, refuses every
 * write with `trip_locked` until the abstract releases it.
 */
export function canEditTrip(billingStatus: TripBillingStatus): boolean {
  return billingStatus === 'unbilled'
}

export function canExcludeTrip(billingStatus: TripBillingStatus): boolean {
  return billingStatus === 'unbilled'
}
