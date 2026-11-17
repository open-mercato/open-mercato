/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1' })),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => key }),
}))
jest.mock('@open-mercato/core/modules/integrations/lib/credentials-service', () => ({
  isCredentialsEncryptionUnavailableError: () => false,
  isCredentialsSealedWhileDisabledError: () => false,
  isReservedOAuthGrantId: (id: string) => id.endsWith('__oauth_grant'),
}))
jest.mock('@open-mercato/core/modules/integrations/events', () => ({ emitIntegrationsEvent: jest.fn() }))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { registerIntegration, clearRegisteredIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { MASKED_SECRET_VALUE } from '@open-mercato/core/modules/integrations/lib/credentials-masking'
import { PUT } from '@open-mercato/core/modules/integrations/api/[id]/credentials/route'
import { guards } from '../data/guards'
import { integration } from '../integration'

const credentials = {
  bucket: 'tenant-bucket',
  region: 'eu-central-1',
  authMode: 'access_keys',
  accessKeyId: 'tenant-key',
  secretAccessKey: 'tenant-secret',
}
const save = jest.fn()
const resolveCredentials = jest.fn()

async function putCredentials(values: Record<string, unknown>, unchangedSecretFields?: string[], id = 'storage_s3') {
  return PUT(new Request(`http://localhost/api/integrations/${id}/credentials`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credentials: values, unchangedSecretFields }),
  }), { params: { id } })
}

beforeEach(() => {
  jest.clearAllMocks()
  clearRegisteredIntegrations()
  registerIntegration(integration)
  registerMutationGuards([{ moduleId: 'storage_s3', guards }])
  resolveCredentials.mockResolvedValue(null)
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve(key: string) {
      if (key === 'integrationCredentialsService') return {
        getSchema: () => integration.credentials,
        resolve: resolveCredentials,
        resolveUpdatedAt: async () => null,
        save,
      }
      if (key === 'rbacService') return { getGrantedFeatures: async () => ['integrations.credentials.manage'] }
      return undefined
    },
  })
})

afterEach(() => {
  registerMutationGuards([])
  clearRegisteredIntegrations()
})

it.each([
  {},
  { ...credentials, authMode: 'ambient' },
  { ...credentials, accessKeyId: '' },
  { ...credentials, secretAccessKey: '   ' },
  { ...credentials, credentialsEnvPrefix: 'AWS' },
  { ...credentials, pathPrefix: 'foreign/' },
  { ...credentials, tenantId: 'other-tenant' },
  { ...credentials, unexpected: 'injected' },
])('rejects unsafe credentials before persistence: %j', async (values) => {
  const response = await putCredentials(values)
  expect(response.status).toBe(422)
  expect(save).not.toHaveBeenCalled()
})

it('persists explicit tenant credentials within the authenticated scope', async () => {
  const response = await putCredentials(credentials)
  expect(response.status).toBe(200)
  expect(save).toHaveBeenCalledWith('storage_s3', credentials, { tenantId: 'tenant-1', organizationId: 'org-1' })
})

it.each(['mask', 'omitted'])('preserves a configured secret through the %s update protocol', async (protocol) => {
  resolveCredentials.mockResolvedValue(credentials)
  const { secretAccessKey: unusedSecret, ...nonSecretValues } = credentials
  const response = protocol === 'mask'
    ? await putCredentials({ ...nonSecretValues, secretAccessKey: MASKED_SECRET_VALUE })
    : await putCredentials(nonSecretValues, ['secretAccessKey'])
  expect(response.status).toBe(200)
  expect(save).toHaveBeenCalledWith('storage_s3', credentials, { tenantId: 'tenant-1', organizationId: 'org-1' })
  expect(resolveCredentials).toHaveBeenCalledWith('storage_s3', { tenantId: 'tenant-1', organizationId: 'org-1' })
})

it('rejects a masked secret that has no stored value', async () => {
  const response = await putCredentials({ ...credentials, secretAccessKey: MASKED_SECRET_VALUE })
  expect(response.status).toBe(422)
  expect(save).not.toHaveBeenCalled()
})

it('requires re-entry of a preserved secret after changing endpoint', async () => {
  resolveCredentials.mockResolvedValue({ ...credentials, endpoint: 'https://old.example.com' })
  const response = await putCredentials({ ...credentials, endpoint: 'https://new.example.com', secretAccessKey: MASKED_SECRET_VALUE })
  expect(response.status).toBe(422)
  expect(save).not.toHaveBeenCalled()
})

it('leaves other integration credential contracts alone', async () => {
  registerIntegration({ id: 'unrelated', title: 'Unrelated' })
  const response = await putCredentials({ arbitrary: 'provider-owned' }, undefined, 'unrelated')
  expect(response.status).toBe(200)
  expect(save).toHaveBeenCalledWith('unrelated', { arbitrary: 'provider-owned' }, { tenantId: 'tenant-1', organizationId: 'org-1' })
})
