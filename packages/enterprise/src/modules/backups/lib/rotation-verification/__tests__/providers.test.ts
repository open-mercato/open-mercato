import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDerivedKeyKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import type { RotationProtectionContext } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { resolveRotationProviders } from '../providers'
import { createVersionedVaultProvider } from '../vault-provider'

const tenants = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
let directory: string, server: Server, address: string
let data: Map<string, Map<number, string>>, requests: string[], malformed: string | undefined
let wrongVersion: boolean, latestKeyOverride: string | undefined
let redirect: string | undefined, httpFailure: boolean

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rotation-providers-'))
  data = new Map(tenants.map(tenant => [tenant, new Map([[1, randomBytes(32).toString('base64')], [2, randomBytes(32).toString('base64')]])]))
  requests = []; malformed = undefined; wrongVersion = false; latestKeyOverride = undefined; redirect = undefined; httpFailure = false
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    if (redirect) { response.writeHead(307, { location: redirect }).end(); return }
    if (httpFailure) { response.writeHead(500).end('private fixture-token and response body'); return }
    if (request.method !== 'GET' || request.headers['x-vault-token'] !== 'fixture-token') { response.writeHead(403).end('private rejection body'); return }
    const url = new URL(request.url!, address)
    const tenant = url.pathname.match(/^\/v1\/secret\/data\/tenant_key_([0-9a-f-]+)$/)?.[1]
    const versions = tenant ? data.get(tenant) : undefined
    const version = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : versions ? Math.max(...versions.keys()) : 0
    const key = versions?.get(version)
    if (!key) { response.writeHead(404).end('private missing-key body'); return }
    response.setHeader('content-type', 'application/json')
    response.end(malformed ?? JSON.stringify({ data: { data: { key: !url.searchParams.has('version') && latestKeyOverride ? latestKeyOverride : key }, metadata: { version: wrongVersion ? version + 1 : version, destroyed: false, deletion_time: '' } } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }) })

async function pins(name: string, selected: string[], version: number) {
  const file = join(directory, `${name}.json`)
  await writeFile(file, JSON.stringify({ schemaVersion: 1, versions: Object.fromEntries(selected.map(tenant => [tenant, version])) }), { mode: 0o600 })
  return file
}
async function options(selected = tenants, version = 1, target = false) {
  return { address, token: 'fixture-token', keyPath: 'secret/data', versionsFile: await pins('pins', selected, version), target }
}

test.each(['derived-derived', 'derived-vault', 'vault-derived', 'vault-vault'])('%s routes preserve plaintext for single and all-tenant selections', async route => {
  for (const selected of [[tenants[0]!], tenants]) {
    const [source, target] = route.split('-')
    const environment: NodeJS.ProcessEnv = {
      OM_ROTATION_SOURCE_PROVIDER: source, OM_ROTATION_TARGET_PROVIDER: target,
      TENANT_DATA_ENCRYPTION_KEY: 'fixture-new-derived-root',
      OM_ROTATION_SOURCE_VAULT_ADDR: address, OM_ROTATION_SOURCE_VAULT_TOKEN: 'fixture-token', OM_ROTATION_SOURCE_VAULT_KV_PATH: 'secret/data',
      OM_ROTATION_SOURCE_VAULT_VERSIONS_FILE: await pins('source', selected, 1),
      OM_ROTATION_TARGET_VAULT_ADDR: address, OM_ROTATION_TARGET_VAULT_TOKEN: 'fixture-token', OM_ROTATION_TARGET_VAULT_KV_PATH: 'secret/data',
      OM_ROTATION_TARGET_VAULT_VERSIONS_FILE: await pins('target', selected, 2),
    }
    const context = { previousKey: source === 'derived' ? 'fixture-old-derived-root' : null } as RotationProtectionContext
    const providers = await resolveRotationProviders(context, selected, environment)
    for (const tenant of selected) {
      const before = (await providers.previousKms!.getTenantDek(tenant))!.key
      const after = (await providers.kms.getTenantDek(tenant))!.key
      const expectedBefore = source === 'vault' ? data.get(tenant)!.get(1)! : (await createDerivedKeyKmsService('fixture-old-derived-root').getTenantDek(tenant))!.key
      const expectedAfter = target === 'vault' ? data.get(tenant)!.get(2)! : (await createDerivedKeyKmsService('fixture-new-derived-root').getTenantDek(tenant))!.key
      expect(before === expectedBefore && after === expectedAfter).toBe(true)
      const initial = encryptWithAesGcm('synthetic logical value', before).value!
      const rotated = encryptWithAesGcm(decryptWithAesGcm(initial, before)!, after).value!
      expect(decryptWithAesGcm(rotated, after) === 'synthetic logical value').toBe(true)
      expect(decryptWithAesGcm(rotated, before)).toBeNull()
    }
    await providers.refresh()
    expect(providers.provider).not.toContain('fixture-token')
  }
  expect(requests.every(request => request.startsWith('GET '))).toBe(true)
})

test('source reads retained old versions; target requires current latest version even when bytes are identical', async () => {
  const source = await createVersionedVaultProvider(tenants, await options())
  expect(Boolean(await source.service.getTenantDek(tenants[0]!))).toBe(true)
  const target = await createVersionedVaultProvider(tenants, await options(tenants, 2, true))
  data.get(tenants[0]!)!.set(3, data.get(tenants[0]!)!.get(2)!)
  await expect(target.service.getTenantDek(tenants[0]!)).rejects.toThrow('ROTATION_VAULT_TARGET_NOT_CURRENT')
  expect(Boolean(await source.service.getTenantDek(tenants[0]!))).toBe(true)
})

test('target refuses latest bytes that differ from the selected version', async () => {
  const provider = await createVersionedVaultProvider(tenants, await options(tenants, 2, true))
  latestKeyOverride = randomBytes(32).toString('base64')
  await expect(provider.service.getTenantDek(tenants[0]!)).rejects.toThrow('ROTATION_VAULT_TARGET_NOT_CURRENT')
})

test('redirects never forward credentials and HTTP provider errors reveal only fixed error codes', async () => {
  let forwarded = 0
  const destination = createServer((_request, response) => { forwarded++; response.end('{}') })
  await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve))
  try {
    const provider = await createVersionedVaultProvider(tenants, await options())
    redirect = `http://127.0.0.1:${(destination.address() as { port: number }).port}/recipient`
    await expect(provider.service.getTenantDek(tenants[0]!)).rejects.toThrow('[internal] ROTATION_VAULT_READ_FAILED')
    expect(forwarded).toBe(0)
    redirect = undefined; httpFailure = true
    const message = await provider.service.getTenantDek(tenants[0]!).then(() => '', error => String(error.message))
    expect(message).toBe('[internal] ROTATION_VAULT_READ_FAILED')
  } finally { destination.closeAllConnections(); await new Promise<void>(resolve => destination.close(() => resolve())) }
})

test('missing/destroyed versions and version mismatches fail without fallback or key disclosure', async () => {
  const provider = await createVersionedVaultProvider(tenants, await options())
  data.get(tenants[0]!)!.delete(1)
  await expect(provider.service.getTenantDek(tenants[0]!)).rejects.toThrow('[internal] ROTATION_VAULT_READ_FAILED')
  data.get(tenants[0]!)!.set(1, randomBytes(32).toString('base64')); wrongVersion = true
  await expect(provider.service.getTenantDek(tenants[0]!)).rejects.toThrow('ROTATION_VAULT_VERSION_MISMATCH')
  expect(requests.every(request => request.startsWith('GET '))).toBe(true)
})

test('response size/shape/key bounds and abort remain fail closed', async () => {
  const provider = await createVersionedVaultProvider(tenants, await options())
  malformed = 'x'.repeat(65537)
  await expect(provider.service.getTenantDek(tenants[0]!)).rejects.toThrow('ROTATION_VAULT_RESPONSE_INVALID')
  malformed = JSON.stringify({ data: { data: { key: 'not-a-key' }, metadata: { version: 1 } } })
  await expect(provider.service.getTenantDek(tenants[0]!)).rejects.toThrow('ROTATION_KEY_UNAVAILABLE')
  const controller = new AbortController(); controller.abort('private reason')
  const cancelled = await createVersionedVaultProvider(tenants, { ...await options(), signal: controller.signal })
  const before = requests.length
  await expect(cancelled.service.getTenantDek(tenants[0]!)).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
  expect(requests).toHaveLength(before)
  await expect(provider.service.createTenantDek(tenants[0]!)).rejects.toThrow('ROTATION_KEY_PROVISIONING_FORBIDDEN')
})

test.each(['http://vault:8200', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test/?version=1', 'https://example.test/#fragment'])('rejects ambiguous/insecure endpoint %s before requests', async endpoint => {
  await expect(createVersionedVaultProvider(tenants, { ...await options(), address: endpoint })).rejects.toThrow('ROTATION_VAULT_CONFIGURATION_INVALID')
  expect(requests).toHaveLength(0)
})

test('requires owner-only exact-scope manifests with no missing/default/extra versions', async () => {
  await expect(createVersionedVaultProvider(tenants, await options([tenants[0]!]))).rejects.toThrow('ROTATION_VAULT_PIN_SCOPE_MISMATCH')
  await expect(createVersionedVaultProvider([tenants[0]!], await options())).rejects.toThrow('ROTATION_VAULT_PIN_SCOPE_MISMATCH')
  const value = await options(); await chmod(value.versionsFile, 0o644)
  await expect(createVersionedVaultProvider(tenants, value)).rejects.toThrow('ROTATION_VAULT_PINS_INVALID')
})
