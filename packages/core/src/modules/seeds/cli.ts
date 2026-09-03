import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  decryptSeedEnvelope,
  encryptSeedDocument,
  generateSeedKey,
  resolveSeedKey,
  SEED_KEY_ENV,
} from '@open-mercato/shared/lib/seed/crypto'
import { loadSeedDocument } from '@open-mercato/shared/lib/seed/loader'
import { seedDocumentSchema, type SeedDocument } from '@open-mercato/shared/lib/seed/types'
import { createProgressBar, type ProgressBar } from '@open-mercato/shared/lib/cli/progress'

type ScopeRow = { id: string; tenant_id?: string | null }

type SeedLoadScopeInput = {
  tenantId?: string
  organizationId?: string
}

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part?.startsWith('--')) continue
    const [keyRaw, valueRaw] = part.slice(2).split('=')
    if (!keyRaw) continue
    if (valueRaw !== undefined) args[keyRaw] = valueRaw
    else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) args[keyRaw] = rest[i + 1]
    else args[keyRaw] = 'true'
  }
  return args
}

function flag(value: string | undefined): boolean {
  return value === 'true' || value === ''
}

function printableScopeUsage(): string {
  return 'Usage: mercato seeds load --in <file.enc.json> [--tenant <tenantId>] [--org <organizationId>] [--plain] [--dry-run] [--key <base64>]'
}

function requireSingleRow(rows: ScopeRow[], label: string, explicitFlag: string): ScopeRow {
  if (rows.length === 1) return rows[0]
  if (rows.length === 0) {
    throw new Error(`Cannot auto-detect ${label}: no active ${label} exists. Pass ${explicitFlag}.`)
  }
  throw new Error(
    `Cannot auto-detect ${label}: found multiple active ${label}s. Pass ${explicitFlag}.`,
  )
}

export async function resolveSeedLoadScope(
  em: EntityManager,
  input: SeedLoadScopeInput,
): Promise<{ tenantId: string; organizationId: string; inferred: boolean }> {
  const tenantId = input.tenantId?.trim() || ''
  const organizationId = input.organizationId?.trim() || ''
  if (tenantId && organizationId) return { tenantId, organizationId, inferred: false }

  const conn = em.getConnection()
  if (organizationId && !tenantId) {
    const orgRows = (await conn.execute(
      'select id, tenant_id from organizations where id = ? and deleted_at is null and is_active = true limit 1',
      [organizationId],
    )) as ScopeRow[]
    const org = requireSingleRow(orgRows, 'organization', '--tenant')
    if (!org.tenant_id) {
      throw new Error(`Cannot auto-detect tenant: organization ${organizationId} has no tenant_id.`)
    }
    return { tenantId: org.tenant_id, organizationId, inferred: true }
  }

  const resolvedTenantId = tenantId || requireSingleRow(
    (await conn.execute(
      'select id from tenants where deleted_at is null and is_active = true order by created_at asc, id asc limit 2',
    )) as ScopeRow[],
    'tenant',
    '--tenant',
  ).id

  const resolvedOrganizationId = organizationId || requireSingleRow(
    (await conn.execute(
      'select id from organizations where tenant_id = ? and deleted_at is null and is_active = true order by created_at asc, id asc limit 2',
      [resolvedTenantId],
    )) as ScopeRow[],
    'organization',
    '--org',
  ).id

  return { tenantId: resolvedTenantId, organizationId: resolvedOrganizationId, inferred: true }
}

async function readJsonFile(file: string): Promise<unknown> {
  const raw = await fs.readFile(path.resolve(file), 'utf8')
  return JSON.parse(raw)
}

const keygen: ModuleCli = {
  command: 'keygen',
  run() {
    const key = generateSeedKey()
    // Key to stdout (capturable); guidance to stderr so it does not pollute the value.
    console.log(key)
    console.error(
      `\nGenerated a 32-byte base64 seed key. Distribute it out-of-band and set it for every participant:\n  ${SEED_KEY_ENV}=${key}\n`,
    )
  },
}

const encrypt: ModuleCli = {
  command: 'encrypt',
  async run(rest) {
    const args = parseArgs(rest)
    const input = args.in ?? args.input
    const output = args.out ?? args.output
    if (!input || !output) {
      console.error(
        'Usage: mercato seeds encrypt --in <plaintext.json> --out <file.enc.json> [--key <base64>]',
      )
      process.exitCode = 1
      return
    }
    const key = resolveSeedKey(args.key)
    const document = seedDocumentSchema.parse(await readJsonFile(input))
    const envelope = encryptSeedDocument(document, key)
    await fs.writeFile(path.resolve(output), `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
    console.log(`Encrypted ${document.records.length} seed record(s) → ${output}`)
  },
}

const decrypt: ModuleCli = {
  command: 'decrypt',
  async run(rest) {
    const args = parseArgs(rest)
    const input = args.in ?? args.input
    const output = args.out ?? args.output
    if (!input) {
      console.error(
        'Usage: mercato seeds decrypt --in <file.enc.json> [--out <plaintext.json>] [--key <base64>]',
      )
      process.exitCode = 1
      return
    }
    const key = resolveSeedKey(args.key)
    const document = decryptSeedEnvelope(await readJsonFile(input), key)
    const json = `${JSON.stringify(document, null, 2)}\n`
    if (output) {
      await fs.writeFile(path.resolve(output), json, 'utf8')
      console.log(`Decrypted → ${output}`)
    } else {
      process.stdout.write(json)
    }
  },
}

const load: ModuleCli = {
  command: 'load',
  async run(rest) {
    const args = parseArgs(rest)
    const input = args.in ?? args.input ?? args.file
    const tenantId = String(args.tenant ?? args.tenantId ?? '')
    const organizationId = String(args.org ?? args.orgId ?? args.organizationId ?? '')
    const plain = flag(args.plain)
    const dryRun = flag(args['dry-run']) || flag(args.dryRun)
    if (!input) {
      console.error(printableScopeUsage())
      process.exitCode = 1
      return
    }

    const raw = await readJsonFile(input)
    let document: SeedDocument
    if (plain) {
      document = seedDocumentSchema.parse(raw)
    } else {
      const key = resolveSeedKey(args.key)
      document = decryptSeedEnvelope(raw, key)
    }

    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    let scope: { tenantId: string; organizationId: string; inferred: boolean }
    try {
      scope = await resolveSeedLoadScope(em, { tenantId, organizationId })
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      console.error(printableScopeUsage())
      process.exitCode = 1
      return
    }
    if (scope.inferred) {
      console.log(`Auto-detected seed scope: tenant=${scope.tenantId}, org=${scope.organizationId}`)
    }
    let bar: ProgressBar | null = null
    const result = await loadSeedDocument(
      em,
      document,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
      {
        dryRun,
        onProgress: ({ index, total }) => {
          if (!bar) bar = createProgressBar(dryRun ? 'Validating seed' : 'Loading seed', total)
          bar.update(index + 1)
        },
      },
    )
    ;(bar as ProgressBar | null)?.complete()
    console.log(
      `${dryRun ? '[dry-run] ' : ''}Seed load complete: ${result.created} created, ${result.skipped} skipped (of ${result.total}).`,
    )
  },
}

const seedsCliCommands: ModuleCli[] = [keygen, encrypt, decrypt, load]

export default seedsCliCommands
