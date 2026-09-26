import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { ZATCA_CHAIN_KEY, ZATCA_CHAIN_MODULE_ID, createModuleConfigZatcaInvoiceChainStore } from '../chain-store'
import { ZatcaInvoiceChainError, allocateNextInvoiceChain, commitInvoiceChain, peekNextInvoiceChain } from '../chain'
import { INITIAL_PREVIOUS_INVOICE_HASH, computeInvoiceHash } from '../hash'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function createFakeConfigService(initial: { value: unknown; updatedAt: string | null } | null = null) {
  let stored = initial
  const setValue = jest.fn(async (_moduleId: string, _key: string, value: unknown) => {
    stored = { value, updatedAt: '2026-01-31T09:15:00.000Z' }
    return { updatedAt: stored.updatedAt }
  })
  const getRecord = jest.fn(async () => (stored ? { value: stored.value, updatedAt: stored.updatedAt } : null))
  return {
    service: { getRecord, setValue } as unknown as ModuleConfigService,
    getRecord,
    setValue,
    readStored: () => stored,
  }
}

describe('module config invoice chain store', () => {
  it('reads nothing before the first invoice', async () => {
    const fake = createFakeConfigService()

    expect(await createModuleConfigZatcaInvoiceChainStore(fake.service).read(scope)).toBeNull()
  })

  it('writes under the module and key the settings screen already uses', async () => {
    const fake = createFakeConfigService()
    const store = createModuleConfigZatcaInvoiceChainStore(fake.service)

    await store.write(scope, { icv: 3, lastInvoiceHash: computeInvoiceHash('<Invoice>3</Invoice>') })

    expect(fake.setValue).toHaveBeenCalledWith(ZATCA_CHAIN_MODULE_ID, ZATCA_CHAIN_KEY, expect.anything(), scope)
    expect(await store.read(scope)).toEqual({
      icv: 3,
      lastInvoiceHash: computeInvoiceHash('<Invoice>3</Invoice>'),
    })
  })

  it('fails closed on a stored chain it cannot read, instead of restarting the chain', async () => {
    const missingCounter = createFakeConfigService({ value: { lastInvoiceHash: null }, updatedAt: null })
    const badHash = createFakeConfigService({ value: { icv: 2, lastInvoiceHash: 'nope' }, updatedAt: null })
    const wrongShape = createFakeConfigService({ value: 'not-an-object', updatedAt: null })

    await expect(createModuleConfigZatcaInvoiceChainStore(missingCounter.service).read(scope)).rejects.toThrow(
      ZatcaInvoiceChainError,
    )
    await expect(createModuleConfigZatcaInvoiceChainStore(badHash.service).read(scope)).rejects.toThrow(
      ZatcaInvoiceChainError,
    )
    await expect(createModuleConfigZatcaInvoiceChainStore(wrongShape.service).read(scope)).rejects.toThrow(
      ZatcaInvoiceChainError,
    )
  })

  it('drives the whole chain through the persisted store', async () => {
    const fake = createFakeConfigService()
    const store = createModuleConfigZatcaInvoiceChainStore(fake.service)

    const first = await allocateNextInvoiceChain({ store, scope })
    expect(first).toEqual({ icv: 1, previousInvoiceHash: INITIAL_PREVIOUS_INVOICE_HASH })

    const firstHash = computeInvoiceHash('<Invoice>first</Invoice>')
    await commitInvoiceChain({ store, scope, icv: first.icv, invoiceHash: firstHash })
    expect(fake.readStored()?.value).toEqual({ icv: 1, lastInvoiceHash: firstHash })

    const preview = await peekNextInvoiceChain({ store, scope })
    expect(preview).toEqual({ icv: 2, previousInvoiceHash: firstHash })
    // A preview must not have consumed the counter.
    expect(await allocateNextInvoiceChain({ store, scope })).toEqual({ icv: 2, previousInvoiceHash: firstHash })
  })
})
