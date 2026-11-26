import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import { executeConformanceRemoteOp, serveConformanceRemoteOps, type ConformanceRemoteOp } from '@open-mercato/cache/testing/remote'
import { runWithCacheTenant } from '@open-mercato/cache/tenantContext'
import { IGNITE_PROVIDER_ID, provider, type IgniteCacheProviderConfig } from '../../index'

const rawSettings = process.env.OM_IGNITE_TEST_SETTINGS
if (!rawSettings) {
  process.stderr.write('[internal] OM_IGNITE_TEST_SETTINGS is required\n')
  process.exit(2)
}

const registration = defineCacheProviderRegistration<IgniteCacheProviderConfig>({
  id: IGNITE_PROVIDER_ID,
  load: async () => provider,
  settings: () => JSON.parse(rawSettings) as unknown,
})

const resolved = await resolveCacheProvider([registration], { env: process.env })
if (!resolved) {
  process.stderr.write('[internal] CACHE_PROVIDER did not select the Ignite provider\n')
  process.exit(2)
}
const service = createCacheService({ provider: resolved })
await service.healthcheck!()

const mode = process.env.OM_IGNITE_CHILD_MODE ?? 'serve'
if (mode === 'serve') {
  process.stdout.write('ready\n')
  process.stdin.setEncoding('utf8')
  await serveConformanceRemoteOps(service, process.stdin, (line) => process.stdout.write(line))
} else if (mode === 'churn') {
  const tenant = process.env.OM_IGNITE_CHILD_TENANT ?? null
  const rounds = Number(process.env.OM_IGNITE_CHILD_ROUNDS ?? '50')
  const keys = Number(process.env.OM_IGNITE_CHILD_KEYS ?? '20')
  const label = process.env.OM_IGNITE_CHILD_LABEL ?? 'child'
  for (let round = 0; round < rounds; round++) {
    for (let index = 0; index < keys; index++) {
      const operation: ConformanceRemoteOp = {
        op: 'set',
        tenant,
        key: `churn:${index}`,
        value: { by: label, round },
        tags: [`gen-${round % 2}`, `${label}-${round}`],
      }
      await executeConformanceRemoteOp(service, operation)
    }
    await runWithCacheTenant(tenant, () => service.deleteByTags([`gen-${(round + 1) % 2}`]))
  }
  process.stdout.write('done\n')
}
await service.close!()
