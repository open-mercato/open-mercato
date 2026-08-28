import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ErasureManifestEntry, ErasureManifestServiceContract } from './contracts'

const ENTRY_SUFFIX = '.erasure.json'

export class ErasureManifestService implements ErasureManifestServiceContract {
  constructor(private readonly directory: string) {}

  async append(input: {
    requestId: string
    tenantId: string
    organizationId: string
    subjectKind: string
    subjectId: string
    dataClassIds?: string[]
    executedAt: Date
  }): Promise<void> {
    const entry: ErasureManifestEntry = {
      version: 1,
      requestId: requireValue(input.requestId, 'requestId'),
      tenantId: requireValue(input.tenantId, 'tenantId'),
      organizationId: requireValue(input.organizationId, 'organizationId'),
      subjectKind: requireValue(input.subjectKind, 'subjectKind'),
      subjectId: requireValue(input.subjectId, 'subjectId'),
      ...(input.dataClassIds
        ? { dataClassIds: Array.from(new Set(input.dataClassIds.map((id) => requireValue(id, 'dataClassId')))).sort() }
        : {}),
      executedAt: input.executedAt.toISOString(),
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const key = createHash('sha256').update(entry.requestId).digest('hex')
    const destination = path.join(this.directory, `${key}${ENTRY_SUFFIX}`)
    const partial = `${destination}.partial`
    await writeFile(partial, `${JSON.stringify(entry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(partial, destination)
  }

  async listAfter(timestamp: Date): Promise<ErasureManifestEntry[]> {
    let names: string[]
    try {
      names = await readdir(this.directory)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith(ENTRY_SUFFIX))
        .map((name) => this.read(path.join(this.directory, name))),
    )
    return entries
      .filter((entry) => new Date(entry.executedAt).getTime() > timestamp.getTime())
      .sort((left, right) => left.executedAt.localeCompare(right.executedAt))
  }

  private async read(filePath: string): Promise<ErasureManifestEntry> {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (!isEntry(parsed)) throw new Error('[internal] Invalid erasure manifest entry')
    return parsed
  }
}

export function resolveErasureManifestDirectory(
  backupDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(
    environment.OM_ERASURE_MANIFEST_DIRECTORY?.trim()
      || path.join(backupDirectory, 'erasure-manifests'),
  )
}

function requireValue(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`[internal] Erasure manifest ${name} is required`)
  return normalized
}

function isEntry(value: unknown): value is ErasureManifestEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ErasureManifestEntry>
  return entry.version === 1
    && typeof entry.requestId === 'string'
    && typeof entry.tenantId === 'string'
    && typeof entry.organizationId === 'string'
    && typeof entry.subjectKind === 'string'
    && typeof entry.subjectId === 'string'
    && (entry.dataClassIds === undefined || (
      Array.isArray(entry.dataClassIds)
      && entry.dataClassIds.every((id) => typeof id === 'string' && id.trim().length > 0)
    ))
    && typeof entry.executedAt === 'string'
    && Number.isFinite(new Date(entry.executedAt).getTime())
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
