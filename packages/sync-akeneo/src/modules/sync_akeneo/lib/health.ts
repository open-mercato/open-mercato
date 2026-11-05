import { createAkeneoClient } from './client'

export const akeneoHealthCheck = {
  async check(credentials: Record<string, unknown>) {
    try {
      const client = createAkeneoClient(credentials)
      const probe = await client.collectDiscoveryData()
      return {
        status: 'healthy' as const,
        message: `Connected to Akeneo${probe.version ? ` ${probe.version}` : ''}`,
        details: {
          locales: probe.locales.length,
          channels: probe.channels.length,
          attributes: probe.attributes.length,
          families: probe.families.length,
          version: probe.version,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Akeneo error'
      return {
        status: 'unhealthy' as const,
        message: `Akeneo connection failed: ${message}`,
        details: { error: message },
      }
    }
  },
}
