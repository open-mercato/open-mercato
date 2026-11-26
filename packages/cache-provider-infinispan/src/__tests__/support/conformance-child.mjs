import { pathToFileURL } from 'node:url'

const bundle = process.env.CACHE_CONFORMANCE_BUNDLE
const settingsJson = process.env.CACHE_CONFORMANCE_SETTINGS
if (!bundle || !settingsJson) {
  process.stderr.write('[internal] missing CACHE_CONFORMANCE_BUNDLE or CACHE_CONFORMANCE_SETTINGS\n')
  process.exit(2)
}

const host = await import(pathToFileURL(bundle).href)
const registration = host.defineCacheProviderRegistration({
  id: 'open-mercato/infinispan',
  load: async () => host.provider,
  settings: () => JSON.parse(settingsJson),
})
const resolved = await host.resolveCacheProvider([registration], { env: process.env })
if (!resolved) {
  process.stderr.write('[internal] CACHE_PROVIDER did not select the infinispan provider\n')
  process.exit(2)
}
const service = host.createCacheService({ provider: resolved })
await service.healthcheck()
process.stdout.write('ready\n')
process.stdin.setEncoding('utf8')
await host.serveConformanceRemoteOps(service, process.stdin, (line) => process.stdout.write(line))
await service.close()
process.exit(0)
