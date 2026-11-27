import { createHash, randomUUID } from 'node:crypto'
import { link, open, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'

const journalSchema = z.object({
  target: z.string(),
  transactionId: z.string().regex(/^\d+$/),
  ids: z.array(z.string().uuid()),
})

export type Journal = z.infer<typeof journalSchema>

export function journalTarget(em: EntityManager, tenant: string, org: string): string {
  const config = em.config
  return createHash('sha256').update(JSON.stringify([
    config.get('clientUrl'), config.get('host'), config.get('port'), config.get('dbName'), tenant, org,
  ])).digest('hex')
}

export async function readJournal(path: string, target: string): Promise<Journal | undefined> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }

  const journal = journalSchema.parse(JSON.parse(contents))
  if (journal.target !== target) throw new Error('The recovery journal belongs to another database or scope.')
  return journal
}

export async function writeJournal(path: string, journal: Journal): Promise<void> {
  const pending = `${path}.${randomUUID()}.tmp`
  const file = await open(pending, 'wx', 0o600)
  try {
    try {
      await file.writeFile(JSON.stringify(journal))
      await file.sync()
    } finally {
      await file.close()
    }
    await link(pending, path)
    const directory = await open(dirname(path), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await unlink(pending)
  }
}
