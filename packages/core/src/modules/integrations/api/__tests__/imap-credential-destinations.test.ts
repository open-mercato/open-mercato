import { integration as imapIntegration } from '@open-mercato/channel-imap/modules/channel_imap/integration'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { MASKED_SECRET_VALUE } from '../../lib/credentials-masking'
import { emitIntegrationsEvent } from '../../events'
import { runIntegrationMutationGuards, runIntegrationMutationGuardAfterSuccess } from '../guards'
import { PUT } from '../[id]/credentials/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  ...jest.requireActual('@open-mercato/shared/modules/integrations/types'), getIntegration: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ t: (key: string) => key }) }))
jest.mock('../../events', () => ({ emitIntegrationsEvent: jest.fn() }))
jest.mock('../guards', () => ({
  resolveUserFeatures: () => ['integrations.credentials.manage'],
  runIntegrationMutationGuards: jest.fn(), runIntegrationMutationGuardAfterSuccess: jest.fn(),
}))

const existing = {
  imapHost: 'imap.trusted.example', imapPort: '993', imapPassword: 'stored-imap-password',
  smtpHost: 'smtp.trusted.example', smtpPort: '465', smtpPassword: 'stored-smtp-password',
}
const save = jest.fn()
const cases = ['imapHost', 'smtpHost', 'imapPort', 'smtpPort'].flatMap((field) => (
  ['sentinel', 'list'].map((format) => ({ field, format }))
))

describe('IMAP credential route destination binding with the registered schema', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAuthFromRequest).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1' })
    jest.mocked(getIntegration).mockReturnValue(imapIntegration)
    jest.mocked(runIntegrationMutationGuards).mockResolvedValue({ ok: true })
    jest.mocked(createRequestContainer).mockResolvedValue({ resolve: () => ({
      getSchema: () => imapIntegration.credentials, resolve: async () => existing,
      resolveUpdatedAt: async () => null, save,
    }) } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  })

  it.each(cases)('denies $field retargeting with $format before persistence', async ({ field, format }) => {
    const credentials: Record<string, unknown> = { ...existing, [field]: field.endsWith('Port') ? '1143' : 'attacker.example' }
    for (const secret of ['imapPassword', 'smtpPassword']) {
      if (format === 'sentinel') credentials[secret] = MASKED_SECRET_VALUE
      else delete credentials[secret]
    }
    const response = await PUT(new Request('http://localhost/api/integrations/channel_imap/credentials', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials, unchangedSecretFields: ['imapPassword', 'smtpPassword'] }),
    }), { params: { id: 'channel_imap' } })
    expect(response.status).toBe(422)
    expect(save).not.toHaveBeenCalled()
    expect(emitIntegrationsEvent).not.toHaveBeenCalled()
    expect(runIntegrationMutationGuardAfterSuccess).not.toHaveBeenCalled()
    expect(await response.text()).not.toMatch(/stored-imap-password|stored-smtp-password/)
  })
})
