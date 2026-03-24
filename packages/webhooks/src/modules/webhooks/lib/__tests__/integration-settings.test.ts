import { resolveWebhookIntegrationSettings } from '../integration-settings'

describe('resolveWebhookIntegrationSettings', () => {
  it('returns false when the integration credentials are missing', async () => {
    const resolve = jest.fn(<T,>(name: string): T => {
      if (name === 'integrationCredentialsService') {
        return {
          resolve: jest.fn(async () => null),
        } as T
      }

      throw new Error(`Unexpected dependency: ${name}`)
    })

    const settings = await resolveWebhookIntegrationSettings(
      { resolve },
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    )

    expect(settings).toEqual({
      notifyOnFailedDelivery: false,
    })
  })

  it('reads notifyOnFailedDelivery from the webhook integration credentials', async () => {
    const credentialsResolve = jest.fn(async () => ({
      notifyOnFailedDelivery: true,
    }))

    const settings = await resolveWebhookIntegrationSettings(
      {
        resolve: <T,>(name: string): T => {
          if (name === 'integrationCredentialsService') {
            return {
              resolve: credentialsResolve,
            } as T
          }

          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    )

    expect(credentialsResolve).toHaveBeenCalledWith('webhook_custom', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(settings).toEqual({
      notifyOnFailedDelivery: true,
    })
  })
})
