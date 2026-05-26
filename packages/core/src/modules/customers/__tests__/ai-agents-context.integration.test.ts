/**
 * Step 5.16 — Phase 3 WS-D integration tests for `customers.account_assistant`
 * page-context resolution.
 *
 * Exercises the `resolvePageContext` contract end-to-end through the agent
 * callback (the production `resolvePageContext` exported from
 * `packages/core/src/modules/customers/ai-agents.ts`) rather than calling the
 * lower-level `hydrateCustomersAccountContext` helper directly. This pins the
 * widget → runtime contract the chat dispatcher relies on: when the
 * Step 5.15 Deal detail binding passes `pageContext = { recordType, recordId }`
 * and the runtime forwards `entityType = recordType` into the callback, the
 * returned hydration string MUST surface the correct record bundle.
 *
 * Scope (per Step 5.16 spec):
 *   - person / company / deal happy path via their respective get_* tools
 *   - unknown recordType → input unchanged (null)
 *   - missing recordId → input unchanged (null)
 *   - cross-tenant recordId → input unchanged (null, tenant isolation)
 *   - throwing service → input unchanged + console.warn spy assertion
 *
 * The underlying tool pack (`ai-tools`) is mocked at the module boundary so
 * the test stays in-process — no DB, no DI container, no encryption path.
 * This mirrors the narrow mock boundary Step 5.2 established.
 */

// Prevent the tool pack from pulling the encryption runtime into the test graph.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

const VALID_UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VALID_UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type HydrateInput = {
  entityType: string
  recordId: string
  container: unknown
  tenantId: string | null
  organizationId: string | null
}

function buildFakeContainer() {
  return {
    resolve: (name: string) => (name === 'em' ? { count: jest.fn() } : null),
  }
}

async function loadWithMockedToolPack(
  toolName: string,
  handler: jest.Mock,
): Promise<(input: HydrateInput) => Promise<string | null>> {
  jest.doMock('../ai-tools', () => ({
    __esModule: true,
    default: [
      {
        name: toolName,
        description: 'mock',
        inputSchema: { parse: (value: unknown) => value },
        handler,
      },
    ],
    aiTools: [
      {
        name: toolName,
        description: 'mock',
        inputSchema: { parse: (value: unknown) => value },
        handler,
      },
    ],
  }))
  const mod = (await import('../ai-agents')) as unknown as {
    default: Array<{ resolvePageContext?: (input: HydrateInput) => Promise<string | null> }>
  }
  const callback = mod.default[0].resolvePageContext
  if (!callback) throw new Error('customers.account_assistant.resolvePageContext not exported')
  return callback
}

describe('Step 5.16 — customers.account_assistant.resolvePageContext (integration)', () => {
  const originalWarn = console.warn
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })
  afterEach(() => {
    console.warn = originalWarn
  })

  it('hydrates a person bundle under the Person context block for recordType=person', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      person: { id: VALID_UUID_A, displayName: 'Taylor Sample' },
      relatedCompanies: [{ id: VALID_UUID_B, displayName: 'Acme Corp' }],
    }))
    const resolvePageContext = await loadWithMockedToolPack(
      'customers.get_person',
      handler,
    )
    const result = await resolvePageContext({
      // The dispatcher forwards `pageContext.recordType` into `entityType`; the
      // PERSON_ENTITY_TYPES set recognises both the short form (`person`) and
      // the fully-qualified `customers.person` form.
      entityType: 'person',
      recordId: VALID_UUID_A,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledWith(
      { personId: VALID_UUID_A, includeRelated: true },
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
    )
    expect(result).not.toBeNull()
    expect(result).toContain('## Page context — Person')
    expect(result).toContain('Taylor Sample')
    // The Step 5.2 helper nests the bundle under `extra.person` equivalent —
    // the contract here is "bundle appears in the context string", which
    // the runtime appends to the system prompt.
    expect(result).toContain('relatedCompanies')
  })

  it('hydrates a company bundle for recordType=company', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      company: { id: VALID_UUID_A, displayName: 'Acme Industries' },
    }))
    const resolvePageContext = await loadWithMockedToolPack(
      'customers.get_company',
      handler,
    )
    const result = await resolvePageContext({
      entityType: 'company',
      recordId: VALID_UUID_A,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledWith(
      { companyId: VALID_UUID_A, includeRelated: true },
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
    expect(result).toContain('## Page context — Company')
    expect(result).toContain('Acme Industries')
  })

  it('hydrates a deal bundle for recordType=deal (Step 5.15 Deal detail binding)', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      deal: { id: VALID_UUID_A, title: 'Q3 renewal', stage: 'negotiation' },
    }))
    const resolvePageContext = await loadWithMockedToolPack(
      'customers.get_deal',
      handler,
    )
    const result = await resolvePageContext({
      entityType: 'deal',
      recordId: VALID_UUID_A,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledWith(
      { dealId: VALID_UUID_A, includeRelated: true },
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
    expect(result).toContain('## Page context — Deal')
    expect(result).toContain('Q3 renewal')
    expect(result).toContain('negotiation')
  })

  it('leaves input unchanged (returns null) when recordType is unknown', async () => {
    const handler = jest.fn()
    const resolvePageContext = await loadWithMockedToolPack(
      'customers.get_person',
      handler,
    )
    const result = await resolvePageContext({
      entityType: 'customers.unknown_type',
      recordId: VALID_UUID_A,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('leaves input unchanged (returns null) when recordId is not a UUID', async () => {
    const handler = jest.fn()
    const resolvePageContext = await loadWithMockedToolPack(
      'customers.get_person',
      handler,
    )
    const result = await resolvePageContext({
      entityType: 'person',
      recordId: '',
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('leaves input unchanged (returns null) for cross-tenant recordId (tenant isolation)', async () => {
    // Cross-tenant shape: the underlying tool enforces tenant scope through
    // `findOneWithDecryption`; the helper surfaces that as `found: false`,
    // which the hydrator translates to a silent null return. The chat
    // request proceeds without extra context.
    const handler = jest.fn(async () => ({ found: false, personId: VALID_UUID_B }))
    const resolvePageContext = await loadWithMockedToolPack(
      'customers.get_person',
      handler,
    )
    const result = await resolvePageContext({
      entityType: 'person',
      recordId: VALID_UUID_B,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('leaves input unchanged and logs a warn when the underlying service throws', async () => {
    const warn = jest.fn()
    console.warn = warn
    const handler = jest.fn(async () => {
      throw new Error('downstream blew up')
    })
    const resolvePageContext = await loadWithMockedToolPack(
      'customers.get_deal',
      handler,
    )
    const result = await resolvePageContext({
      entityType: 'deal',
      recordId: VALID_UUID_A,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalled()
    const firstCall = warn.mock.calls[0]
    expect(String(firstCall[0])).toMatch(/resolvePageContext/)
    expect(String(firstCall[0])).toMatch(/hydration_error/)
  })
})
