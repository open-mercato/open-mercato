/** @jest-environment node */

const mockFindWithDecryption = jest.fn()
let capturedCrudOptions: Record<string, any> | null = null

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: Record<string, any>) => {
    capturedCrudOptions = opts
    return {
      GET: jest.fn(),
      POST: jest.fn(),
      PUT: jest.fn(),
      DELETE: jest.fn(),
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

describe('customers people route afterList hook', () => {
  beforeAll(async () => {
    await import('../route')
  })

  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('overlays decrypted customer entity fields onto raw list rows', async () => {
    const nextInteractionAt = new Date('2026-04-13T12:34:56.000Z')
    mockFindWithDecryption
      .mockResolvedValueOnce([
        {
          id: 'person-1',
          displayName: 'Ada Lovelace',
          description: 'First programmer',
          ownerUserId: 'user-1',
          primaryEmail: 'ada@example.com',
          primaryPhone: '+1 555-0100',
          status: 'active',
          lifecycleStage: 'customer',
          source: 'partner_referral',
          nextInteractionAt,
          nextInteractionName: 'Follow-up call',
          nextInteractionRefId: 'interaction-1',
          nextInteractionIcon: 'phone',
          nextInteractionColor: 'emerald',
        },
      ])
      .mockResolvedValueOnce([
        {
          entity: { id: 'person-1' },
          firstName: 'Ada',
          lastName: 'Lovelace',
          preferredName: 'Ada',
          jobTitle: 'VP Partnerships',
          department: 'Partnerships',
          seniority: 'executive',
          timezone: 'Europe/Warsaw',
          linkedInUrl: 'https://linkedin.example/ada',
          twitterUrl: null,
          company: { id: 'company-1' },
        },
      ])

    const payload = {
      items: [
        {
          id: 'person-1',
          display_name: 'ATFBv2W3V5bqFwbD:FtL...',
          primary_email: '8nk3sjl5/acHOpE6...',
          primary_phone: 'RLhTo85oq08dVLJY...',
          status: 'garbled',
        },
      ],
    }
    const em = {}
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
      container: {
        resolve: (token: string) => (token === 'em' ? em : null),
      },
    }

    await capturedCrudOptions?.hooks?.afterList?.(payload, ctx)

    expect(mockFindWithDecryption).toHaveBeenNthCalledWith(
      1,
      em,
      expect.anything(),
      expect.objectContaining({
        id: { $in: ['person-1'] },
        deletedAt: null,
        kind: 'person',
      }),
      undefined,
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    )
    expect(payload.items[0]).toMatchObject({
      id: 'person-1',
      display_name: 'Ada Lovelace',
      description: 'First programmer',
      owner_user_id: 'user-1',
      primary_email: 'ada@example.com',
      primary_phone: '+1 555-0100',
      status: 'active',
      lifecycle_stage: 'customer',
      source: 'partner_referral',
      next_interaction_at: '2026-04-13T12:34:56.000Z',
      next_interaction_name: 'Follow-up call',
      next_interaction_ref_id: 'interaction-1',
      next_interaction_icon: 'phone',
      next_interaction_color: 'emerald',
      first_name: 'Ada',
      last_name: 'Lovelace',
      preferred_name: 'Ada',
      job_title: 'VP Partnerships',
      department: 'Partnerships',
      seniority: 'executive',
      timezone: 'Europe/Warsaw',
      linked_in_url: 'https://linkedin.example/ada',
      twitter_url: null,
      company_entity_id: 'company-1',
    })
  })
})
