/**
 * The PURE half of the UPDATE_ENTITY tenant enablement gate.
 *
 * The properties that must hold whatever the storage does:
 *
 * 1. An ABSENT setting means exactly the grandfathered set — not "everything",
 *    not "nothing". This is what makes shipping the gate byte-identical for a
 *    tenant that never opens the settings page.
 * 2. A newly declared candidate is OFF until a human ticks it.
 * 3. A command outside the code-declared catalogue can never be enabled, no
 *    matter what is stored.
 * 4. An empty stored list is a real answer ("nothing enabled") and is NOT the
 *    same as an absent setting.
 */

import { describe, test, expect } from '@jest/globals'
import type { WorkflowSafeCommandDefinition } from '../workflow-safe-commands'
import {
  findUncataloguedCommandIds,
  isWorkflowCommandEnabled,
  mergeEnabledCommandIds,
  parseStoredEnabledCommandIds,
  resolveEnabledWorkflowCommand,
  resolveWorkflowCommandCatalogue,
  UNSET_WORKFLOW_COMMAND_POLICY,
} from '../workflow-command-enablement'

const GRANDFATHERED: WorkflowSafeCommandDefinition = {
  commandId: 'sales.orders.update',
  requiredFeatures: ['sales.orders.manage'],
  labelKey: 'sales.workflows.commands.orders.update',
  defaultEnabled: true,
}

const NEW_CANDIDATE: WorkflowSafeCommandDefinition = {
  commandId: 'customers.deals.update',
  requiredFeatures: ['customers.deals.manage'],
  labelKey: 'customers.workflows.commands.deals.update',
}

const CATALOGUE: WorkflowSafeCommandDefinition[] = [GRANDFATHERED, NEW_CANDIDATE]

describe('isWorkflowCommandEnabled', () => {
  test('an absent setting enables exactly the grandfathered declarations', () => {
    expect(isWorkflowCommandEnabled(GRANDFATHERED, UNSET_WORKFLOW_COMMAND_POLICY)).toBe(true)
    expect(isWorkflowCommandEnabled(NEW_CANDIDATE, UNSET_WORKFLOW_COMMAND_POLICY)).toBe(false)
  })

  test('a stored list is authoritative and overrides the grandfather clause', () => {
    const policy = { enabledCommandIds: ['customers.deals.update'] }
    expect(isWorkflowCommandEnabled(NEW_CANDIDATE, policy)).toBe(true)
    // Explicitly unticking the grandfathered command must actually turn it off,
    // or the settings page would show a checkbox that cannot be cleared.
    expect(isWorkflowCommandEnabled(GRANDFATHERED, policy)).toBe(false)
  })

  test('an empty stored list is "nothing enabled", not "never configured"', () => {
    expect(isWorkflowCommandEnabled(GRANDFATHERED, { enabledCommandIds: [] })).toBe(false)
  })
})

describe('resolveEnabledWorkflowCommand', () => {
  test('a command outside the catalogue is never resolved, however it is stored', () => {
    expect(
      resolveEnabledWorkflowCommand(CATALOGUE, { enabledCommandIds: ['auth.users.delete'] }, 'auth.users.delete'),
    ).toBeNull()
  })

  test('a catalogued but unticked command is not resolved', () => {
    expect(
      resolveEnabledWorkflowCommand(CATALOGUE, UNSET_WORKFLOW_COMMAND_POLICY, 'customers.deals.update'),
    ).toBeNull()
  })

  test('resolving returns the declaration, so requiredFeatures stay the code-declared ones', () => {
    const resolved = resolveEnabledWorkflowCommand(
      CATALOGUE,
      { enabledCommandIds: ['customers.deals.update'] },
      'customers.deals.update',
    )
    expect(resolved?.requiredFeatures).toEqual(['customers.deals.manage'])
  })
})

describe('parseStoredEnabledCommandIds', () => {
  test('an absent or structurally wrong value resolves to the UNSET policy', () => {
    expect(parseStoredEnabledCommandIds(undefined)).toBeNull()
    expect(parseStoredEnabledCommandIds(null)).toBeNull()
    expect(parseStoredEnabledCommandIds('sales.orders.update')).toBeNull()
    expect(parseStoredEnabledCommandIds({ enabled: ['x'] })).toBeNull()
  })

  test('an empty array is preserved as an empty list, never collapsed to unset', () => {
    expect(parseStoredEnabledCommandIds([])).toEqual([])
  })

  test('non-string and blank members are dropped without failing the whole read', () => {
    expect(parseStoredEnabledCommandIds([' sales.orders.update ', 42, '', null, 'sales.orders.update'])).toEqual([
      'sales.orders.update',
    ])
  })
})

describe('resolveWorkflowCommandCatalogue', () => {
  test('reports enablement and the grandfather clause separately, in catalogue order', () => {
    expect(resolveWorkflowCommandCatalogue(CATALOGUE, UNSET_WORKFLOW_COMMAND_POLICY)).toEqual([
      {
        commandId: 'sales.orders.update',
        requiredFeatures: ['sales.orders.manage'],
        labelKey: 'sales.workflows.commands.orders.update',
        enabled: true,
        defaultEnabled: true,
      },
      {
        commandId: 'customers.deals.update',
        requiredFeatures: ['customers.deals.manage'],
        labelKey: 'customers.workflows.commands.deals.update',
        enabled: false,
        defaultEnabled: false,
      },
    ])
  })
})

describe('mergeEnabledCommandIds', () => {
  test('drops submitted ids the catalogue does not declare', () => {
    expect(mergeEnabledCommandIds(['auth.users.delete', 'customers.deals.update'], null, CATALOGUE)).toEqual([
      'customers.deals.update',
    ])
  })

  test('retains stored ids whose declaring module is not loaded in this process', () => {
    expect(
      mergeEnabledCommandIds(['customers.deals.update'], ['wms.stock.update', 'sales.orders.update'], CATALOGUE),
    ).toEqual(['customers.deals.update', 'wms.stock.update'])
  })

  test('an unticked catalogued id is dropped rather than retained', () => {
    expect(mergeEnabledCommandIds([], ['sales.orders.update'], CATALOGUE)).toEqual([])
  })
})

describe('findUncataloguedCommandIds', () => {
  test('names exactly the submitted ids the catalogue does not declare', () => {
    expect(findUncataloguedCommandIds(['sales.orders.update', 'auth.users.delete'], CATALOGUE)).toEqual([
      'auth.users.delete',
    ])
  })
})
