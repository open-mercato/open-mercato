// Independent-process runner for RESP cache provider conformance.
// CACHE_CONFORMANCE_HOST: bundled host module (see host.ts buildConformanceHost).
// CACHE_CONFORMANCE_SETTINGS: JSON settings for the provider under test.
// CACHE_PROVIDER / CACHE_PROVIDER_NAMESPACE: normal provider selection.
import { pathToFileURL } from 'node:url'

const hostModule = process.env.CACHE_CONFORMANCE_HOST
const rawSettings = process.env.CACHE_CONFORMANCE_SETTINGS
if (!hostModule || !rawSettings) {
  process.stderr.write('[internal] missing CACHE_CONFORMANCE_HOST or CACHE_CONFORMANCE_SETTINGS\n')
  process.exit(2)
}

const host = await import(pathToFileURL(hostModule).href)
const registration = host.defineCacheProviderRegistration({
  id: host.provider.id,
  load: async () => host.provider,
  settings: () => JSON.parse(rawSettings),
})
const provider = await host.resolveCacheProvider([registration], { env: process.env })
if (!provider) {
  process.stderr.write('[internal] CACHE_PROVIDER did not select the provider under test\n')
  process.exit(2)
}
const service = host.createCacheService({ provider })
await service.healthcheck()
process.stdout.write('ready\n')
process.stdin.setEncoding('utf8')
await host.serveConformanceRemoteOps(service, process.stdin, (line) => process.stdout.write(line))
await service.close()
