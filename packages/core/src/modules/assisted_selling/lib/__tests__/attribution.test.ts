jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))

import { emitAssistedSellingEvent } from '../../events'
import { AssistedSellingAttribution, AssistedSellingProposal } from '../../data/entities'
import { handleCartConvertedForAttribution } from '../attribution'

type Row = Record<string, any>

const TENANT_ID = 'tenant-attr-1'
const ORG_ID = 'org-attr-1'
const CART_ID = 'cart-1'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return (row[key] ?? null) === (value ?? null)
  })
}

function makeFakeEm(seed: { attributions?: Row[]; proposals?: Row[] } = {}) {
  const attributions: Row[] = seed.attributions ? [...seed.attributions] : []
  const proposals: Row[] = seed.proposals ? [...seed.proposals] : []
  const persisted: Row[] = []
  const em: Row = {
    count: jest.fn(async (Cls: unknown, where: Row) => {
      const rows = Cls === AssistedSellingAttribution ? attributions : []
      return rows.filter((row) => matches(row, where)).length
    }),
    find: jest.fn(async (Cls: unknown, where: Row) => {
      if (Cls !== AssistedSellingProposal) return []
      const ids: string[] = where.proposalCartId?.$in ?? []
      return proposals.filter((row) => ids.includes(row.proposalCartId) && matches(row, { tenantId: where.tenantId, organizationId: where.organizationId, deletedAt: where.deletedAt }))
    }),
    // Real MikroORM's `em.create` both builds the entity AND schedules it for persist —
    // mirrored here so a caller that relies on `em.create` alone (never calling `em.persist`
    // separately) still shows up in `persisted`, matching production behavior.
    create: jest.fn((_Cls: unknown, data: Row) => {
      persisted.push(data)
      return data
    }),
    persist: jest.fn((row: Row) => persisted.push(row)),
    flush: jest.fn(async () => undefined),
  }
  em.fork = jest.fn(() => em)
  return { em, persisted }
}

function makeContainer(em: Row, cartService: Row) {
  const registrations: Record<string, unknown> = { em, cartService }
  return { resolve: (name: string): any => registrations[name] }
}

function makeCartService(detail: Row | null) {
  return { getAttributionLines: jest.fn(async () => detail) }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('handleCartConvertedForAttribution — §6.7 attribution subscriber', () => {
  test('order outcome, populated lineMap: writes one row per line, splitting buyer vs. proposal-authored lines, no degraded event', async () => {
    const proposal = { id: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID, proposalCartId: 'proposal-cart-1', threadId: 'thread-1', deletedAt: null }
    const { em, persisted } = makeFakeEm({ proposals: [proposal] })
    const cartService = makeCartService({
      currencyCode: 'USD',
      lines: [
        { id: 'line-buyer', addedByActorType: 'buyer', addedByActorId: 'customer-user-1', netAmount: '10.0000', grossAmount: '12.3000', proposalCartId: null },
        { id: 'line-rep', addedByActorType: 'rep', addedByActorId: 'rep-1', netAmount: '20.0000', grossAmount: '24.6000', proposalCartId: 'proposal-cart-1' },
      ],
    })

    await handleCartConvertedForAttribution(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: 'order-1',
        salesQuoteId: null,
        lineMap: [
          { cartLineId: 'line-buyer', salesOrderLineId: 'order-line-buyer' },
          { cartLineId: 'line-rep', salesOrderLineId: 'order-line-rep' },
        ],
      },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(persisted).toHaveLength(2)
    const buyerRow = persisted.find((row) => row.cartLineId === 'line-buyer')
    const repRow = persisted.find((row) => row.cartLineId === 'line-rep')
    expect(buyerRow).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: CART_ID,
      salesOrderId: 'order-1',
      salesOrderLineId: 'order-line-buyer',
      salesQuoteId: null,
      actorType: 'buyer',
      actorId: 'customer-user-1',
      threadId: null,
      proposalId: null,
      lineNetAmount: '10.0000',
      lineGrossAmount: '12.3000',
      currencyCode: 'USD',
    })
    expect(repRow).toMatchObject({
      salesOrderLineId: 'order-line-rep',
      actorType: 'rep',
      actorId: 'rep-1',
      threadId: 'thread-1',
      proposalId: 'proposal-1',
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('quote outcome, populated lineMap: attributes against quote lines', async () => {
    const { em, persisted } = makeFakeEm()
    const cartService = makeCartService({
      currencyCode: 'EUR',
      lines: [{ id: 'line-1', addedByActorType: 'buyer', addedByActorId: null, netAmount: '5.0000', grossAmount: '6.1500', proposalCartId: null }],
    })

    await handleCartConvertedForAttribution(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: null,
        salesQuoteId: 'quote-1',
        lineMap: [{ cartLineId: 'line-1', salesQuoteLineId: 'quote-line-1' }],
      },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ salesQuoteId: 'quote-1', salesQuoteLineId: 'quote-line-1', salesOrderId: null, salesOrderLineId: null })
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('missing lineMap: degrades to document-level attribution, summed per actor, emits .attribution.degraded', async () => {
    const { em, persisted } = makeFakeEm()
    const cartService = makeCartService({
      currencyCode: 'USD',
      lines: [
        { id: 'line-1', addedByActorType: 'buyer', addedByActorId: 'customer-user-1', netAmount: '10.0000', grossAmount: '12.0000', proposalCartId: null },
        { id: 'line-2', addedByActorType: 'buyer', addedByActorId: 'customer-user-1', netAmount: '5.5000', grossAmount: '6.6000', proposalCartId: null },
      ],
    })

    await handleCartConvertedForAttribution(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, salesOrderId: 'order-1', salesQuoteId: null, lineMap: null },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      cartLineId: null,
      salesOrderId: 'order-1',
      salesOrderLineId: null,
      actorType: 'buyer',
      actorId: 'customer-user-1',
      lineNetAmount: '15.5000',
      lineGrossAmount: '18.6000',
    })
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.attribution.degraded', {
      cartId: CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      salesOrderId: 'order-1',
      salesQuoteId: null,
    })
  })

  test('an incomplete lineMap (missing a live line) degrades the WHOLE conversion rather than guessing', async () => {
    const { em, persisted } = makeFakeEm()
    const cartService = makeCartService({
      currencyCode: 'USD',
      lines: [
        { id: 'line-1', addedByActorType: 'buyer', addedByActorId: null, netAmount: '10.0000', grossAmount: '12.0000', proposalCartId: null },
        { id: 'line-2', addedByActorType: 'buyer', addedByActorId: null, netAmount: '5.0000', grossAmount: '6.0000', proposalCartId: null },
      ],
    })

    await handleCartConvertedForAttribution(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: 'order-1',
        salesQuoteId: null,
        lineMap: [{ cartLineId: 'line-1', salesOrderLineId: 'order-line-1' }],
      },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(persisted).toHaveLength(1)
    expect(persisted[0].cartLineId).toBeNull()
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.attribution.degraded', expect.objectContaining({ cartId: CART_ID }))
  })

  test('a converted cart with no accepted proposal anywhere in its history still attributes every line (not gated on proposal existence, §6.7)', async () => {
    const { em, persisted } = makeFakeEm()
    const cartService = makeCartService({
      currencyCode: 'USD',
      lines: [{ id: 'line-1', addedByActorType: 'buyer', addedByActorId: 'customer-user-1', netAmount: '42.0000', grossAmount: '50.0000', proposalCartId: null }],
    })

    await handleCartConvertedForAttribution(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: 'order-1',
        salesQuoteId: null,
        lineMap: [{ cartLineId: 'line-1', salesOrderLineId: 'order-line-1' }],
      },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ threadId: null, proposalId: null, actorType: 'buyer' })
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('redelivery: a cart that already has attribution rows writes nothing twice', async () => {
    const { em, persisted } = makeFakeEm({ attributions: [{ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: CART_ID }] })
    const cartService = makeCartService({ currencyCode: 'USD', lines: [] })

    await handleCartConvertedForAttribution(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, salesOrderId: 'order-1', salesQuoteId: null, lineMap: null },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(cartService.getAttributionLines).not.toHaveBeenCalled()
    expect(persisted).toHaveLength(0)
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('neither salesOrderId nor salesQuoteId: no document outcome to attribute — skipped silently, not degraded', async () => {
    const { em, persisted } = makeFakeEm()
    const cartService = makeCartService({ currencyCode: 'USD', lines: [] })

    await handleCartConvertedForAttribution(
      { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, salesOrderId: null, salesQuoteId: null, lineMap: null },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(cartService.getAttributionLines).not.toHaveBeenCalled()
    expect(persisted).toHaveLength(0)
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('skips an incomplete payload (missing cartId/tenantId/organizationId)', async () => {
    const { em, persisted } = makeFakeEm()
    const cartService = makeCartService({ currencyCode: 'USD', lines: [] })

    await handleCartConvertedForAttribution(
      { cartId: CART_ID, salesOrderId: 'order-1' },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(cartService.getAttributionLines).not.toHaveBeenCalled()
    expect(persisted).toHaveLength(0)
  })

  test('another tenant\'s event: the redelivery guard is itself tenant-scoped, so it never masks a real first delivery', async () => {
    const { em, persisted } = makeFakeEm({ attributions: [{ tenantId: 'other-tenant', organizationId: ORG_ID, cartId: CART_ID }] })
    const cartService = makeCartService({
      currencyCode: 'USD',
      lines: [{ id: 'line-1', addedByActorType: 'buyer', addedByActorId: null, netAmount: '1.0000', grossAmount: '1.0000', proposalCartId: null }],
    })

    await handleCartConvertedForAttribution(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: 'order-1',
        salesQuoteId: null,
        lineMap: [{ cartLineId: 'line-1', salesOrderLineId: 'order-line-1' }],
      },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(persisted).toHaveLength(1)
  })
})

describe('handleCartConvertedForAttribution — a proposal summed into a line the buyer already held', () => {
  const proposal = {
    id: 'proposal-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    proposalCartId: 'proposal-cart-1',
    threadId: 'thread-1',
    authoredByActorType: 'rep',
    authoredByActorId: 'rep-1',
    deletedAt: null,
  }

  async function convert(line: Row) {
    const { em, persisted } = makeFakeEm({ proposals: [proposal] })
    const cartService = makeCartService({ currencyCode: 'PLN', lines: [line] })
    await handleCartConvertedForAttribution(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: 'order-1',
        lineMap: [{ cartLineId: line.id, salesOrderLineId: 'order-line-1' }],
      },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )
    return persisted
  }

  test('splits the line by quantity: the buyer keeps 2 units, the proposal author gets 3', async () => {
    const persisted = await convert({
      id: 'line-1',
      addedByActorType: 'buyer',
      addedByActorId: 'customer-user-1',
      netAmount: '250.0000',
      grossAmount: '300.0000',
      quantity: '5',
      proposalCartId: 'proposal-cart-1',
      proposalContributions: [{ proposalCartId: 'proposal-cart-1', quantity: '3' }],
    })

    expect(persisted).toHaveLength(2)
    expect(persisted.find((row) => row.actorType === 'buyer')).toMatchObject({
      salesOrderLineId: 'order-line-1',
      proposalId: null,
      threadId: null,
      lineNetAmount: '100.0000',
      lineGrossAmount: '120.0000',
    })
    expect(persisted.find((row) => row.actorType === 'rep')).toMatchObject({
      salesOrderLineId: 'order-line-1',
      actorId: 'rep-1',
      proposalId: 'proposal-1',
      threadId: 'thread-1',
      lineNetAmount: '150.0000',
      lineGrossAmount: '180.0000',
    })
  })

  test('keeps the split amounts summing to the line total when the share does not divide evenly', async () => {
    const persisted = await convert({
      id: 'line-1',
      addedByActorType: 'buyer',
      addedByActorId: 'customer-user-1',
      netAmount: '100.0000',
      grossAmount: '123.0000',
      quantity: '3',
      proposalCartId: 'proposal-cart-1',
      proposalContributions: [{ proposalCartId: 'proposal-cart-1', quantity: '1' }],
    })

    const grossSum = persisted.reduce((sum, row) => sum + Number(row.lineGrossAmount), 0)
    expect(grossSum).toBeCloseTo(123, 4)
  })

  // Review finding: a line a single proposal fully sourced used to skip splitting entirely
  // and credit the WHOLE line to `line.addedByActorType`/`addedByActorId` — here `'merge'`/
  // `null`, never a real rep — instead of the proposal's own author. Now it always splits by
  // contribution, so even full coverage lands on the right actor.
  test('a line a single proposal fully sourced credits that proposal\'s author, never the merge/last-writer placeholder', async () => {
    const persisted = await convert({
      id: 'line-1',
      addedByActorType: 'merge',
      addedByActorId: null,
      netAmount: '150.0000',
      grossAmount: '180.0000',
      quantity: '3',
      proposalCartId: 'proposal-cart-1',
      proposalContributions: [{ proposalCartId: 'proposal-cart-1', quantity: '3' }],
    })

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      actorType: 'rep',
      actorId: 'rep-1',
      threadId: 'thread-1',
      proposalId: 'proposal-1',
      lineNetAmount: '150.0000',
      lineGrossAmount: '180.0000',
    })
  })

  // Review finding (the core bug): when MULTIPLE proposals together fully make up a line's
  // quantity, the split used to bail out (`contributedQuantity >= lineQuantity`) and credit
  // the entire line to `line.addedByActorId` — whichever proposal's acceptance happened to
  // write the merged line last — giving one rep 100% of a commission two reps actually
  // earned. Each contributing proposal must now get its own proportional share.
  test('splits a line TWO proposals together fully sourced proportionally between both authors', async () => {
    const secondProposal = {
      id: 'proposal-2',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      proposalCartId: 'proposal-cart-2',
      threadId: 'thread-2',
      authoredByActorType: 'rep',
      authoredByActorId: 'rep-2',
      deletedAt: null,
    }
    const { em, persisted } = makeFakeEm({ proposals: [proposal, secondProposal] })
    const cartService = makeCartService({
      currencyCode: 'PLN',
      lines: [
        {
          id: 'line-1',
          // The last writer when two proposals' quantities are merged into one buyer-held
          // line — exactly the value the old fallback wrongly credited 100% to.
          addedByActorType: 'merge',
          addedByActorId: null,
          netAmount: '150.0000',
          grossAmount: '180.0000',
          quantity: '3',
          proposalCartId: 'proposal-cart-2',
          proposalContributions: [
            { proposalCartId: 'proposal-cart-1', quantity: '1' },
            { proposalCartId: 'proposal-cart-2', quantity: '2' },
          ],
        },
      ],
    })

    await handleCartConvertedForAttribution(
      {
        cartId: CART_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        salesOrderId: 'order-1',
        lineMap: [{ cartLineId: 'line-1', salesOrderLineId: 'order-line-1' }],
      },
      { resolve: makeContainer(em, cartService).resolve, container: makeContainer(em, cartService) },
    )

    expect(persisted).toHaveLength(2)
    // 1/3 of the line went through proposal-1 (rep-1), 2/3 through proposal-2 (rep-2) — no
    // buyer-remainder row, since the proposals' quantities fully cover the line.
    expect(persisted.find((row) => row.actorId === 'rep-1')).toMatchObject({
      actorType: 'rep',
      threadId: 'thread-1',
      proposalId: 'proposal-1',
      lineNetAmount: '50.0000',
      lineGrossAmount: '60.0000',
    })
    expect(persisted.find((row) => row.actorId === 'rep-2')).toMatchObject({
      actorType: 'rep',
      threadId: 'thread-2',
      proposalId: 'proposal-2',
      lineNetAmount: '100.0000',
      lineGrossAmount: '120.0000',
    })
    const netSum = persisted.reduce((sum, row) => sum + Number(row.lineNetAmount), 0)
    const grossSum = persisted.reduce((sum, row) => sum + Number(row.lineGrossAmount), 0)
    expect(netSum).toBeCloseTo(150, 4)
    expect(grossSum).toBeCloseTo(180, 4)
  })
})
