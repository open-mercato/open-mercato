/** @jest-environment node */

/**
 * `customers.deals.update` was the only command in the repo carrying an
 * `outputSchema` that no workflow could ever run: it was not declared
 * workflow-safe, so the typed-context work it enabled never reached an author.
 *
 * Declaring it in `customers/workflows.ts` closes that loop, and these tests
 * assert the loop end to end — the declaration, the ACL feature it names, and
 * the ledger entry an author actually picks from downstream of an UPDATE_ENTITY
 * activity running it.
 *
 * The nesting is load-bearing: what lands in context is the ACTIVITY HANDLER's
 * return (`{ executed, commandId, result, logEntryId }`), so the command's
 * `outputSchema` describes what sits under `result`. A regression that flattens
 * the schema at the activity root would break every `{{context.*}}` reference
 * an author wrote.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  computeContextLedger,
  type LedgerWorkflowDefinition,
} from '@open-mercato/core/modules/workflows/lib/context-ledger'
import { resolveServerOutputContract } from '@open-mercato/core/modules/workflows/lib/server-output-contract'
import { getWorkflowSafeCommand } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { features as customerFeatures } from '../../acl'
import '../deals'
import '../../workflows'

const definition: LedgerWorkflowDefinition = {
  steps: [
    { stepId: 'start', stepType: 'START' },
    { stepId: 'enrich', stepType: 'AUTOMATED' },
    { stepId: 'end', stepType: 'END' },
  ],
  transitions: [
    {
      transitionId: 't_start_enrich',
      fromStepId: 'start',
      toStepId: 'enrich',
      activities: [
        {
          activityId: 'a_update_deal',
          activityName: 'Update Deal',
          activityType: 'UPDATE_ENTITY',
          config: { commandId: 'customers.deals.update', input: { id: '{{context.dealId}}' } },
        },
      ],
    },
    { transitionId: 't_enrich_end', fromStepId: 'enrich', toStepId: 'end' },
  ],
}

describe('customers.deals.update is declared workflow-safe', () => {
  it('is in the catalogue, gated on customers.deals.manage', () => {
    expect(getWorkflowSafeCommand('customers.deals.update')).toMatchObject({
      commandId: 'customers.deals.update',
      requiredFeatures: ['customers.deals.manage'],
    })
  })

  it('names a feature the customers module actually declares', () => {
    const declared = new Set(customerFeatures.map((feature) => feature.id))
    const command = getWorkflowSafeCommand('customers.deals.update')

    for (const feature of command!.requiredFeatures) {
      expect(declared.has(feature)).toBe(true)
    }
  })

  it('ships switched OFF: a candidate is never a grant', () => {
    expect(getWorkflowSafeCommand('customers.deals.update')?.defaultEnabled).toBeUndefined()
  })
})

describe('customers.deals.update reaches a workflow author through the context ledger', () => {
  it('still declares the outputSchema the ledger resolves against', () => {
    const outputSchema = commandRegistry.outputSchemaOf('customers.deals.update')

    expect(outputSchema).not.toBeNull()
    expect(
      outputSchema!.safeParse({ dealId: '9c1e4b8a-6d2f-4a1b-8c3d-5e7f0a2b4c6d' }).success,
    ).toBe(true)
  })

  it('advertises the typed deal id under the activity envelope at the downstream step', () => {
    const ledger = computeContextLedger(definition, {
      resolveOutputContract: resolveServerOutputContract,
    })

    const entries = ledger.steps.enrich.entries
    const paths = entries.map((entry) => entry.path)

    expect(paths).toContain('Update Deal.result.dealId')
    expect(entries.find((entry) => entry.path === 'Update Deal.result.dealId')).toMatchObject({
      type: 'text',
    })
    // The envelope itself, so an author can branch on whether the command ran.
    expect(paths).toContain('Update Deal.executed')
    expect(paths).toContain('Update Deal.commandId')
    // NOT flattened at the activity root — that would be the CALL_API off-by-one.
    expect(paths).not.toContain('Update Deal.dealId')
  })
})
