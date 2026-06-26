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
    if (!input || !tenantId || !organizationId) {
      console.error(
        'Usage: mercato seeds load --in <file.enc.json> --tenant <tenantId> --org <organizationId> [--plain] [--dry-run] [--key <base64>]',
      )
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
    let bar: ProgressBar | null = null
    const result = await loadSeedDocument(
      em,
      document,
      { tenantId, organizationId },
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
