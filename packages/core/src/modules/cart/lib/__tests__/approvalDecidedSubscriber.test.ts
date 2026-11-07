type FakeRow = Record<string, any>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value)
}

let seededCarts: FakeRow[] = []

function makeCart(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'cart-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    approvalId: 'approval-1',
    awaitingApprovalSince: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeEm() {
  const em: any = {
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>, data: FakeRow) => {
      const rows = seededCarts.filter((row) => matchesWhere(row, where))
      rows.forEach((row) => Object.assign(row, data))
      return rows.length
    }),
  }
  em.fork = jest.fn(() => em)
  return em
}

function makeCtx() {
  const em = makeEm()
  return { container: { resolve: () => em }, em }
}

beforeEach(() => {
  seededCarts = [makeCart()]
})

// Step 3.2 (K5, §9a.5) — shared by all four `.approved`/`.rejected`/`.expired`/`.withdrawn`
// subscriber files. §9a.5's own text, read literally, applies identically to ALL FOUR
// events: clears `awaiting_approval_since` when `approval_id` matches, "it changes no
// other column" — `approval_id` is NEVER cleared here, on `.approved` or any other event
// (§9a.4's table: "approval_id is unchanged").
describe.each([
  ['approval-approved', 'customer_groups.approval.approved'],
  ['approval-rejected', 'customer_groups.approval.rejected'],
  ['approval-expired', 'customer_groups.approval.expired'],
  ['approval-withdrawn', 'customer_groups.approval.withdrawn'],
])('cart subscriber %s (%s)', (fileName) => {
  it('clears awaiting_approval_since when the cart.approvalId matches the event, and never touches approval_id', async () => {
    const mod = await import(`../../subscribers/${fileName}`)
    const ctx = makeCtx()

    await mod.default(
      { subjectType: 'cart', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(seededCarts[0].awaitingApprovalSince).toBeNull()
    expect(seededCarts[0].approvalId).toBe('approval-1')
  })

  it('does nothing when the cart has since moved its approvalId to a newer request', async () => {
    seededCarts = [makeCart({ approvalId: 'approval-2' })]
    const mod = await import(`../../subscribers/${fileName}`)
    const ctx = makeCtx()

    await mod.default(
      { subjectType: 'cart', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(seededCarts[0].awaitingApprovalSince).not.toBeNull()
    expect(seededCarts[0].approvalId).toBe('approval-2')
  })

  it('ignores a payload for a different subjectType (reserved quote subject, §9a.6)', async () => {
    const mod = await import(`../../subscribers/${fileName}`)
    const ctx = makeCtx()

    await mod.default(
      { subjectType: 'quote', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(ctx.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('is a no-op (never throws) on an incomplete payload', async () => {
    const mod = await import(`../../subscribers/${fileName}`)
    const ctx = makeCtx()

    await expect(mod.default({ subjectType: 'cart' }, ctx)).resolves.toBeUndefined()
    expect(ctx.em.nativeUpdate).not.toHaveBeenCalled()
  })
})
