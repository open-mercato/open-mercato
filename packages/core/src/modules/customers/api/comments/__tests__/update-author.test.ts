import type { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

let mockOptions: Parameters<typeof makeCrudRoute>[0]
jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: Parameters<typeof makeCrudRoute>[0]) => {
    mockOptions = options
    return { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  },
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

import '../route'

const commentId = '33333333-3333-4333-8333-333333333333'
const authorId = '44444444-4444-4444-8444-444444444444'
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

describe('comment PUT author mapping (#8759)', () => {
  it.each([{}, { authorUserId: authorId }, { authorUserId: null }])('retains author intent %j for the guarded update command', async authorInput => {
    const action = mockOptions.actions!.update!
    expect(action.commandId).toBe('customers.comments.update')
    const ctx = {
      auth: { sub: authorId, tenantId, orgId: organizationId },
      selectedOrganizationId: organizationId,
    } as CommandRuntimeContext
    const input = await action.mapInput!({ raw: { id: commentId, body: 'Edited', ...authorInput }, ctx } as never)
    expect(input).toMatchObject({ id: commentId, body: 'Edited', ...authorInput })
    if (!('authorUserId' in authorInput)) expect(input).not.toHaveProperty('authorUserId')
  })

  it('keeps the existing update permissions and response', () => {
    expect(mockOptions.metadata?.PUT).toMatchObject({ requireAuth: true, requireFeatures: ['customers.activities.manage'] })
    expect(mockOptions.actions!.update!.response!({} as never)).toEqual({ ok: true })
  })
})
