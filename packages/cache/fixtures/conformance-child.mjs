// Independent-process runner for the cache provider conformance kit.
// CACHE_CONFORMANCE_HOST: ESM module exporting createCacheService,
//   defineCacheProviderRegistration, resolveCacheProvider and
//   serveConformanceRemoteOps (see build-conformance-host.mjs).
// CACHE_CONFORMANCE_PROVIDER_ENTRY: installed entry of the packed fixture provider.
// CACHE_CONFORMANCE_DIRECTORY: backing directory shared with the parent process.
// CACHE_PROVIDER / CACHE_PROVIDER_NAMESPACE: normal provider selection.
// Serves newline-delimited conformance operations on stdin/stdout.
import { pathToFileURL } from 'node:url'

const hostModule = process.env.CACHE_CONFORMANCE_HOST
const providerEntry = process.env.CACHE_CONFORMANCE_PROVIDER_ENTRY
const directory = process.env.CACHE_CONFORMANCE_DIRECTORY
if (!hostModule || !providerEntry || !directory) {
  process.stderr.write('[internal] missing CACHE_CONFORMANCE_HOST, CACHE_CONFORMANCE_PROVIDER_ENTRY or CACHE_CONFORMANCE_DIRECTORY\n')
  process.exit(2)
}

const {
  createCacheService,
  defineCacheProviderRegistration,
  resolveCacheProvider,
  serveConformanceRemoteOps,
} = await import(pathToFileURL(hostModule).href)

const registration = defineCacheProviderRegistration({
  id: 'acme/fixture-fs',
  load: () => import(pathToFileURL(providerEntry).href).then((module) => module.provider),
  settings: () => ({ directory, maxBatch: 64 }),
})
const provider = await resolveCacheProvider([registration], { env: process.env })
if (!provider) {
  process.stderr.write('[internal] CACHE_PROVIDER did not select the fixture provider\n')
  process.exit(2)
}
const service = createCacheService({ provider })
await service.healthcheck()
process.stdout.write('ready\n')
process.stdin.setEncoding('utf8')
await serveConformanceRemoteOps(service, process.stdin, (line) => process.stdout.write(line))
await service.close()
