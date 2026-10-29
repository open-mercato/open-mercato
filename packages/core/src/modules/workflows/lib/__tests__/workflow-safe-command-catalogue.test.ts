/** @jest-environment node */

/**
 * The shipped UPDATE_ENTITY catalogue.
 *
 * Two things can only be verified by reading the real declarations:
 *
 * 1. **Every `requiredFeatures` entry exists in the owning module's `acl.ts`.**
 *    A declaration naming a feature nobody grants is not merely wrong, it is
 *    PERMANENTLY UNUSABLE — `hasAllFeatures` can never be satisfied, so the
 *    command is in the picker, tickable in settings, and refused at runtime with
 *    an authorization error that names a feature no role can hold. A typo here
 *    is invisible until a customer's workflow fails in production.
 *
 * 2. **Only the grandfathered command carries `defaultEnabled`.** That flag is
 *    what makes the tenant gate ship without changing anybody's behaviour, and
 *    it is also the one way a module can hand itself the tenant's decision. It
 *    belongs to `sales.orders.update` — the only command reachable before the
 *    gate existed — and to nothing else.
 */

import { describe, test, expect } from '@jest/globals'
import { listWorkflowSafeCommands } from '../workflow-safe-commands'
import { features as customersFeatures } from '../../../customers/acl'
import { features as catalogFeatures } from '../../../catalog/acl'
import { features as salesFeatures } from '../../../sales/acl'
import '../../../customers/workflows'
import '../../../catalog/workflows'
import '../../../sales/workflows'

const declaredFeatureIds = new Set(
  [...customersFeatures, ...catalogFeatures, ...salesFeatures].map((feature) => feature.id),
)

describe('shipped workflow-safe command catalogue', () => {
  test('declares the deals, customers, products and orders update commands', () => {
    expect(listWorkflowSafeCommands().map((command) => command.commandId).sort()).toEqual([
      'catalog.products.update',
      'customers.companies.update',
      'customers.deals.update',
      'customers.people.update',
      'sales.orders.update',
    ])
  })

  test('every requiredFeatures entry exists in its owning module acl.ts', () => {
    for (const command of listWorkflowSafeCommands()) {
      for (const feature of command.requiredFeatures) {
        expect({ commandId: command.commandId, feature, declared: declaredFeatureIds.has(feature) })
          .toEqual({ commandId: command.commandId, feature, declared: true })
      }
    }
  })

  test('the required feature belongs to the module the command id names', () => {
    for (const command of listWorkflowSafeCommands()) {
      const commandModule = command.commandId.split('.')[0]
      for (const feature of command.requiredFeatures) {
        expect(feature.startsWith(`${commandModule}.`)).toBe(true)
      }
    }
  })

  test('only the grandfathered sales.orders.update is on by default', () => {
    const defaultEnabled = listWorkflowSafeCommands()
      .filter((command) => command.defaultEnabled === true)
      .map((command) => command.commandId)

    expect(defaultEnabled).toEqual(['sales.orders.update'])
  })

  test('no create or delete command is declared', () => {
    for (const command of listWorkflowSafeCommands()) {
      expect(command.commandId.endsWith('.create')).toBe(false)
      expect(command.commandId.endsWith('.delete')).toBe(false)
    }
  })

  test('every declaration carries a label key so the settings UI names it', () => {
    for (const command of listWorkflowSafeCommands()) {
      expect(typeof command.labelKey).toBe('string')
    }
  })
})
