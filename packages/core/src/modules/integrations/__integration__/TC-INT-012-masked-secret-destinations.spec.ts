import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const MASKED_SECRET_VALUE = '__om_secret_unchanged__'

test.describe('TC-INT-012: retained secrets stay bound to their destination (#9108)', () => {
  for (const provider of [
    { id: 'channel_smtp', secret: 'password', credentials: { host: 'smtp.example.com', port: '587' }, destination: 'host', replacement: 'other.example.com' },
    { id: 'channel_imap', secret: 'imapPassword', credentials: { imapHost: 'imap.example.com', imapPort: '993', smtpHost: 'smtp.example.com', smtpPort: '465' }, destination: 'imapHost', replacement: 'other.example.com' },
    { id: 'channel_imap', secret: 'smtpPassword', credentials: { imapHost: 'imap.example.com', imapPort: '993', smtpHost: 'smtp.example.com', smtpPort: '465' }, destination: 'smtpHost', replacement: 'other.example.com' },
    { id: 'sync_akeneo', secret: 'clientSecret', credentials: { apiUrl: 'https://akeneo.example.com' }, destination: 'apiUrl', replacement: 'https://other.example.com' },
  ]) {
    test(`${provider.id}/${provider.secret}: rejects mask retargeting and keeps unrelated edits and replacement`, async ({ request }) => {
      const token = await getAuthToken(request, 'superadmin')
      const available = await apiRequest(request, 'GET', `/api/integrations/${provider.id}/credentials`, { token })
      test.skip(available.status() === 404, `${provider.id} is not enabled in this build`)
      expect(available.status()).toBe(200)
      const { tenantId } = getTokenContext(token)
      let organizationId: string | null = null
      const credentialsPath = `/api/integrations/${provider.id}/credentials`
      const originalDestination = (provider.credentials as Record<string, unknown>)[provider.destination]
      try {
        organizationId = await createOrganizationFixture(request, token, { name: `issue-9108-${randomUUID()}`, tenantId })
        const selectedOrgId = organizationId
        const write = (credentials: Record<string, unknown>, unchangedSecretFields?: string[]) => apiRequestWithSelectedOrg(
          request, 'PUT', credentialsPath, { token, selectedOrgId, data: { credentials, unchangedSecretFields } },
        )
        const read = () => apiRequestWithSelectedOrg(request, 'GET', credentialsPath, { token, selectedOrgId })
        const credentials = { ...provider.credentials, [provider.secret]: `fixture-${randomUUID()}` }
        const configured = await write(credentials)
        expect(configured.status()).toBe(200)

        const masked = { ...credentials, [provider.secret]: MASKED_SECRET_VALUE }
        const retargeted = { ...masked, [provider.destination]: provider.replacement }
        expect((await write(retargeted)).status()).toBe(422)
        const listed: Record<string, unknown> = { ...retargeted }
        delete listed[provider.secret]
        expect((await write(listed, [provider.secret])).status()).toBe(422)
        if (provider.id === 'channel_smtp') {
          expect((await write({ ...masked, port: '465' })).status()).toBe(422)
        }

        if (provider.id === 'channel_imap') {
          const portField = provider.destination === 'imapHost' ? 'imapPort' : 'smtpPort'
          expect((await write({ ...masked, [portField]: '1143' })).status()).toBe(422)
        }

        const afterDenied = await readJsonSafe<{ credentials: Record<string, unknown>; secretFieldsConfigured: Record<string, boolean> }>(await read())
        expect(afterDenied?.credentials[provider.destination]).toBe(originalDestination)
        expect(afterDenied?.credentials[provider.secret]).toBe(MASKED_SECRET_VALUE)
        expect(afterDenied?.secretFieldsConfigured[provider.secret]).toBe(true)
        expect((await write({ ...masked, displayName: 'Changed label' })).status()).toBe(200)
        expect((await write({ ...retargeted, [provider.secret]: `replacement-${randomUUID()}` })).status()).toBe(200)
        const afterReplacement = await readJsonSafe<{ credentials: Record<string, unknown> }>(await read())
        expect(afterReplacement?.credentials[provider.destination]).toBe(provider.replacement)
      } finally {
        if (organizationId) {
          const cleared = await apiRequestWithSelectedOrg(request, 'PUT', credentialsPath, {
            token, selectedOrgId: organizationId, data: { credentials: {} },
          })
          expect(cleared.status()).toBe(200)
        }
        await deleteOrganizationIfExists(request, token, organizationId)
      }
    })
  }
})
