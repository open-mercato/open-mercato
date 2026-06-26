/** @jest-environment node */

/**
 * Regression guard for issue #2112.
 *
 * The sales module declares SalesOrder, SalesQuote, SalesNote, SalesChannel and
 * SalesDocumentAddress as encrypted entities (see `../../encryption.ts`). Reads of
 * those entities MUST go through `findOneWithDecryption` / `findWithDecryption`
 * (from `@open-mercato/shared/lib/encryption/find`) so encrypted JSON/PII columns
 * are decrypted. A raw `em.findOne(Entity, ...)` / `em.find(Entity, ...)` returns
 * ciphertext, which then leaks into audit-log snapshots, undo payloads and recompute
 * paths — the exact defect reported in #2112.
 *
 * This is the lint/codemod-style guard the issue asked for: it scans every command
 * source file and asserts zero raw `(em|tx).find(One)?(<EncryptedEntity>, ...)` reads
 * remain, for each of the five encrypted entity classes. It covers all current and
 * future call sites at once and fails with the offending `file:line` so regressions
 * are easy to fix.
 *
 * Behavioural coverage of the decryption path (asserting the scope argument is
 * threaded through the helper) lives in `documents.scope.test.ts`.
 */

import * as fs from 'fs'
import * as path from 'path'

const commandsDir = path.resolve(__dirname, '..')

const ENCRYPTED_ENTITIES = [
  'SalesOrder',
  'SalesQuote',
  'SalesNote',
  'SalesChannel',
  'SalesDocumentAddress',
] as const

// Strip line comments, block comments and string literals so a mention inside a
// comment or string (e.g. documentation, error keys) never trips the guard.
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}

function listCommandSourceFiles(): string[] {
  return fs
    .readdirSync(commandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(commandsDir, entry.name))
}

function findRawReads(entity: string): string[] {
  // Matches `em.findOne(SalesOrder`, `em.find(SalesOrder`, `tx.findOne(SalesOrder`,
  // `tx.find(SalesOrder` — i.e. a raw EntityManager read that bypasses decryption.
  // `\s*` spans newlines, so multi-line calls (entity on a following line) are caught
  // too — those are exactly the reads a line-by-line grep silently misses.
  const pattern = new RegExp(`\\b(?:em|tx)\\.find(?:One)?\\s*\\(\\s*${entity}\\b`, 'g')
  const offenders: string[] = []

  for (const file of listCommandSourceFiles()) {
    const code = stripNonCode(fs.readFileSync(file, 'utf8'))
    let match: RegExpExecArray | null
    while ((match = pattern.exec(code)) !== null) {
      const line = code.slice(0, match.index).split('\n').length
      offenders.push(`${path.basename(file)}:${line}`)
    }
  }

  return offenders
}

describe('sales commands — encrypted entities must be read with decryption (issue #2112)', () => {
  it('discovers command source files to scan', () => {
    expect(listCommandSourceFiles().length).toBeGreaterThan(0)
  })

  it.each(ENCRYPTED_ENTITIES)(
    'has no raw em/tx.find(One)? reads of %s in any command file',
    (entity) => {
      const offenders = findRawReads(entity)
      expect(offenders).toEqual([])
    },
  )
})
