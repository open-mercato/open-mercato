import { allocateNextInvoiceChain, commitInvoiceChain, createInMemoryZatcaInvoiceChainStore, peekNextInvoiceChain, ZatcaInvoiceChainError } from '../chain'
import { INITIAL_PREVIOUS_INVOICE_HASH, computeInvoiceHash } from '../hash'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('ZATCA invoice chain', () => {
  it('starts the first invoice at counter 1 with the chain-start hash', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()

    const reservation = await allocateNextInvoiceChain({ store, scope })

    expect(reservation).toEqual({ icv: 1, previousInvoiceHash: INITIAL_PREVIOUS_INVOICE_HASH })
  })

  it('hands out the next hash only once the issued invoice is committed', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()
    const first = await allocateNextInvoiceChain({ store, scope })
    const firstHash = computeInvoiceHash('<Invoice>1</Invoice>')

    await commitInvoiceChain({ store, scope, icv: first.icv, invoiceHash: firstHash })
    const second = await allocateNextInvoiceChain({ store, scope })

    expect(second.icv).toBe(2)
    expect(second.previousInvoiceHash).toBe(firstHash)
  })

  it('never reuses a counter, even when an invoice is abandoned before commit', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()
    const abandoned = await allocateNextInvoiceChain({ store, scope })
    const next = await allocateNextInvoiceChain({ store, scope })

    expect(abandoned.icv).toBe(1)
    expect(next.icv).toBe(2)
    // Nothing was committed, so the next invoice still points at the chain start.
    expect(next.previousInvoiceHash).toBe(INITIAL_PREVIOUS_INVOICE_HASH)
  })

  it('keeps separate chains per tenant and organization', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()
    const other = { tenantId: 'tenant-1', organizationId: 'org-2' }

    await allocateNextInvoiceChain({ store, scope })
    await allocateNextInvoiceChain({ store, scope })
    const firstOfOther = await allocateNextInvoiceChain({ store, scope: other })

    expect(firstOfOther.icv).toBe(1)
  })

  it('refuses to commit a malformed hash', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()
    const reservation = await allocateNextInvoiceChain({ store, scope })

    await expect(
      commitInvoiceChain({ store, scope, icv: reservation.icv, invoiceHash: 'nope' }),
    ).rejects.toThrow(ZatcaInvoiceChainError)
  })

  it('refuses to commit a counter value that was never claimed', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()

    await expect(
      commitInvoiceChain({ store, scope, icv: 7, invoiceHash: computeInvoiceHash('<Invoice>1</Invoice>') }),
    ).rejects.toThrow(ZatcaInvoiceChainError)
  })

  it('rejects a scope without a tenant or organization', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()

    await expect(allocateNextInvoiceChain({ store, scope: { tenantId: 'tenant-1', organizationId: ' ' } })).rejects.toThrow(
      ZatcaInvoiceChainError,
    )
  })

  it('does not hand out its internal state', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()
    const reservation = await allocateNextInvoiceChain({ store, scope })

    const state = await store.read(scope)
    if (!state) throw new Error('expected a chain state')
    state.icv = 999

    const reread = await store.read(scope)
    expect(reread?.icv).toBe(reservation.icv)
  })

  it('peeks the next counter and hash without claiming or moving anything', async () => {
    const store = createInMemoryZatcaInvoiceChainStore()
    const first = await allocateNextInvoiceChain({ store, scope })
    const firstHash = computeInvoiceHash('<Invoice>1</Invoice>')
    await commitInvoiceChain({ store, scope, icv: first.icv, invoiceHash: firstHash })

    const peeked = await peekNextInvoiceChain({ store, scope })
    const peekedAgain = await peekNextInvoiceChain({ store, scope })

    expect(peeked).toEqual({ icv: 2, previousInvoiceHash: firstHash })
    expect(peekedAgain).toEqual(peeked)
    // Peeking must not consume the counter the next real invoice needs.
    expect(await allocateNextInvoiceChain({ store, scope })).toEqual(peeked)
  })
})
