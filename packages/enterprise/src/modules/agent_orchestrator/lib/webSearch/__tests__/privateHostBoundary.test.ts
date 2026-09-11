/**
 * `allowPrivateHosts` is the one guardrail a tenant may not set.
 *
 * Naming a host there lets an adapter — and `web_fetch` — resolve to a private
 * address, which is the deliberate hole in the SSRF guard. It was tenant-
 * writable from a settings form, so anyone with `agent_orchestrator.agents
 * .manage` could point the fetcher at `169.254.169.254` and read the cloud
 * metadata endpoint. Whether a private address is reachable is a property of
 * the network the deployment runs in, so it belongs to the operator's env.
 *
 * Two independent barriers, because either alone is one edit from being lost:
 * the write schema REJECTS the field, and the read path never consults a stored
 * value even if one exists from before this landed.
 */
import { guardrailsSchema, resolveWebSearchSettings } from '../policy'

describe('allowPrivateHosts is an instance decision', () => {
  it('rejects a body that tries to set it, rather than silently dropping it', () => {
    const parsed = guardrailsSchema.safeParse({
      denyDomains: ['evil.test'],
      allowPrivateHosts: ['169.254.169.254'],
    })
    // Silently stripping would leave an operator believing they had set it.
    expect(parsed.success).toBe(false)
  })

  it('still accepts the guardrails a tenant legitimately owns', () => {
    const parsed = guardrailsSchema.safeParse({
      allowDomains: ['example.com'],
      denyDomains: ['evil.test'],
      searchesPerRun: 5,
      fetchesPerRun: 5,
      callsPerTenantPerMinute: 30,
      maxFetchBytes: 2048,
    })
    expect(parsed.success).toBe(true)
  })

  it('ignores a stored value and reads env, so a legacy row cannot widen egress', async () => {
    const container = {
      resolve: (name: string) => {
        if (name !== 'moduleConfigService') throw new Error(`unexpected resolve: ${name}`)
        return {
          getRecord: async () => ({
            source: 'tenant',
            // A row written before the schema closed, or by any other writer.
            value: { guardrails: { allowPrivateHosts: ['169.254.169.254'], denyDomains: ['x.test'] } },
          }),
        }
      },
    } as never

    const settings = await resolveWebSearchSettings(container, 'tenant-1', {
      OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS: 'searxng.internal',
    } as NodeJS.ProcessEnv)

    expect(settings.guardrails.allowPrivateHosts).toEqual(['searxng.internal'])
    // The guardrails a tenant DOES own still come from the row.
    expect(settings.guardrails.denyDomains).toEqual(['x.test'])
  })

  it('refuses every private address when the deployment named none', async () => {
    const container = {
      resolve: (name: string) => {
        if (name !== 'moduleConfigService') throw new Error(`unexpected resolve: ${name}`)
        return {
          getRecord: async () => ({
            source: 'tenant',
            value: { guardrails: { allowPrivateHosts: ['10.0.0.1'] } },
          }),
        }
      },
    } as never

    const settings = await resolveWebSearchSettings(container, 'tenant-1', {} as NodeJS.ProcessEnv)
    expect(settings.guardrails.allowPrivateHosts).toEqual([])
  })
})
