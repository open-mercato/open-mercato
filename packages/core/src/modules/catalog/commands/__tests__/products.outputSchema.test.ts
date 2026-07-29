/** @jest-environment node */

/**
 * Product commands are named high-value by
 * `.ai/specs/2026-07-26-workflows-ux-redesign.md`, but none of them is declared
 * workflow-safe yet, so their contracts buy nothing until
 * `registerWorkflowSafeCommands` lists one. These tests pin the declared shapes
 * and assert that the flattener would turn them into a pickable ledger entry —
 * the check that fails loudly if a future schema flattens to nothing useful.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { flattenSchemaToContract } from '@open-mercato/core/modules/workflows/lib/ledger-schema-flatten'
import '../products'

const productCommandIds = [
  'catalog.products.create',
  'catalog.products.update',
  'catalog.products.delete',
]

describe('product command outputSchema', () => {
  const validOutput = { productId: '9c1e4b8a-6d2f-4a1b-8c3d-5e7f0a2b4c6d' }

  it.each(productCommandIds)('declares an outputSchema on %s that parses a valid output', (commandId) => {
    const outputSchema = commandRegistry.outputSchemaOf(commandId)

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse(validOutput).success).toBe(true)
  })

  it.each(productCommandIds)('rejects payloads that are not a { productId: uuid } object on %s', (commandId) => {
    const outputSchema = commandRegistry.outputSchemaOf(commandId)

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse({ productId: 'not-a-uuid' }).success).toBe(false)
    expect(outputSchema!.safeParse({}).success).toBe(false)
    expect(outputSchema!.safeParse('junk').success).toBe(false)
    expect(outputSchema!.safeParse(null).success).toBe(false)
  })

  it('flattens into a pickable ledger entry rather than degrading to unknown', () => {
    const outputSchema = commandRegistry.outputSchemaOf('catalog.products.update')

    expect(outputSchema).not.toBeNull()
    expect(flattenSchemaToContract(outputSchema!)).toEqual({
      entries: [{ path: 'productId', type: 'text' }],
    })
  })
})
