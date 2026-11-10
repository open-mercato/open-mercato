import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

type DatabaseIdentity = { database_name: unknown; ownership_marker: unknown }

export type EphemeralDatabaseConnection = {
  query: (statement: string) => Promise<{ rows: DatabaseIdentity[] }>
}

export type EphemeralDatabaseGuard = {
  version: 1
  databaseName: string
  connectionDigest: string
  ownershipMarker: string
}

const identityQuery = "SELECT current_database() AS database_name, shobj_description(oid, 'pg_database') AS ownership_marker FROM pg_database WHERE datname = current_database()"

function connectionDigest(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('[internal] Ephemeral initialization requires an explicit database connection.')
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('[internal] Ephemeral database connection is invalid.')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) {
    throw new Error('[internal] Ephemeral database connection is invalid.')
  }
  return createHash('sha256').update(databaseUrl).digest('hex')
}

export function readEphemeralDatabaseGuard(args: string[]): EphemeralDatabaseGuard | null {
  const prefix = '--ephemeral-database-guard='
  const values = args.filter((argument) => argument === '--ephemeral-database-guard' || argument.startsWith(prefix))
  if (values.length === 0) return null
  if (values.length !== 1 || !values[0].startsWith(prefix) || !values[0].slice(prefix.length)) {
    throw new Error('[internal] Ephemeral initialization requires one database ownership proof file.')
  }
  const proofPath = values[0].slice(prefix.length)
  const metadata = lstatSync(proofPath)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096
    || (process.platform !== 'win32' && ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.()))) {
    throw new Error('[internal] Ephemeral database ownership proof must be a private regular file.')
  }
  const value: unknown = JSON.parse(readFileSync(proofPath, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[internal] Ephemeral database ownership proof is invalid.')
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.databaseName !== 'string' || !record.databaseName
    || typeof record.connectionDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.connectionDigest)
    || typeof record.ownershipMarker !== 'string' || !/^open-mercato-ephemeral:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.ownershipMarker)) {
    throw new Error('[internal] Ephemeral database ownership proof is invalid.')
  }
  return { version: 1, databaseName: record.databaseName, connectionDigest: record.connectionDigest, ownershipMarker: record.ownershipMarker }
}

export function assertEphemeralDatabaseConnection(guard: EphemeralDatabaseGuard, databaseUrl: string | undefined): void {
  if (connectionDigest(databaseUrl) !== guard.connectionDigest) {
    throw new Error('[internal] Refusing initialization: the effective database connection is not the owned disposable target.')
  }
}

export async function assertEphemeralDatabaseOwnership(guard: EphemeralDatabaseGuard, client: EphemeralDatabaseConnection): Promise<void> {
  const identity = (await client.query(identityQuery)).rows[0]
  if (identity?.database_name !== guard.databaseName || identity?.ownership_marker !== guard.ownershipMarker) {
    throw new Error('[internal] Refusing initialization: database ownership could not be verified.')
  }
}

export async function createEphemeralDatabaseGuard(databaseUrl: string, databaseName: string, directory: string): Promise<string> {
  const digest = connectionDigest(databaseUrl)
  if (decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) !== databaseName) {
    throw new Error('[internal] Disposable database identity does not match its allocation.')
  }
  const { Client } = await import('pg')
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 })
  const ownershipMarker = `open-mercato-ephemeral:${randomUUID()}`
  try {
    await client.connect()
    const identity = (await client.query<DatabaseIdentity>(identityQuery)).rows[0]
    if (identity?.database_name !== databaseName) {
      throw new Error('[internal] Connected database identity does not match its allocation.')
    }
    const quotedName = `"${databaseName.replace(/"/g, '""')}"`
    await client.query(`COMMENT ON DATABASE ${quotedName} IS '${ownershipMarker}'`)
    const guard: EphemeralDatabaseGuard = { version: 1, databaseName, connectionDigest: digest, ownershipMarker }
    await assertEphemeralDatabaseOwnership(guard, client)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const proofPath = path.join(directory, `${randomUUID()}.json`)
    await writeFile(proofPath, JSON.stringify(guard), { mode: 0o600, flag: 'wx' })
    return proofPath
  } finally {
    await client.end()
  }
}
