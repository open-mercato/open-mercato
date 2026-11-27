import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createQueue } from '@open-mercato/queue'
import { FormSubmission } from '../data/entities'
import projectConsent from '../subscribers/forms-consent-projector'
import enqueueSnapshot from '../subscribers/forms-pdf-snapshot'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/queue', () => ({ createQueue: jest.fn(), resolveQueueStrategy: jest.fn() }))

describe.each([projectConsent, enqueueSnapshot])('submitted subscriber scope', (handle) => {
  const submissionId = 'test-submission'
  beforeEach(() => jest.clearAllMocks())

  it.each([{}, { tenantId: 'test-tenant' }, { organizationId: 'test-org' }])('requires both scope identifiers before lookup', async (scope) => {
    const resolve = jest.fn()
    await handle({ submissionId }, { ...scope, container: { resolve } })
    expect(resolve).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('uses both scope identifiers and stops before side effects when no scoped row matches', async () => {
    const em = {}
    const resolve = jest.fn().mockReturnValue({ fork: () => em })
    const scope = { tenantId: 'test-tenant', organizationId: 'test-org' }
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)
    await handle({ submissionId }, { ...scope, container: { resolve } })
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, FormSubmission, { id: submissionId, ...scope, deletedAt: null }, undefined, scope)
    expect(resolve.mock.calls).toEqual([['em']])
    expect(createQueue).not.toHaveBeenCalled()
  })
})
