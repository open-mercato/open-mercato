import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A GDPR-erased subject must never be re-linked by a later inbound post.
 *
 * Erasure (`lib/gdpr.ts` → `eraseSubjectData`) unlinks every row that named a person so a subject access
 * request's answer stays true going forward. The inbound hook resolves a subject by `customerId` or
 * `email` against `customer_entities`, which erasure never touches — the row, and the match, both still
 * exist. Without a check here, a partner's next post about the same address would write a fresh
 * `subject_entity_id` straight back onto a new inbound-request row and quietly undo the erasure the next
 * time anybody looked.
 *
 * A structural test rather than a behavioural one, matching the convention this route's other tests use:
 * `resolveSubject` is not exported, and the route module pulls in enough of the request-container stack
 * that importing it directly is avoided throughout this file's siblings.
 */
const ROUTE = join(__dirname, '..', 'inbound', 'route.ts')
const source = readFileSync(ROUTE, 'utf8')

function resolveSubjectBody(): string {
  const start = source.indexOf('async function resolveSubject(')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('\nexport const openApi', start)
  return source.slice(start, end === -1 ? undefined : end)
}

describe('resolveSubject never re-links an erased subject', () => {
  const body = resolveSubjectBody()

  it('imports the erasure check', () => {
    expect(source).toContain("import { isErasedSubject } from '../../lib/gdpr.js'")
  })

  it('checks erasure before returning a customerId match', () => {
    const idMatch = body.match(/const found = await em\.findOne\(CustomerEntity[\s\S]*?\n[^\n]*\n/)
    expect(idMatch).not.toBeNull()
    expect(idMatch?.[0]).toMatch(/isErasedSubject\(em, found\.id, scope\)/)
  })

  it('checks erasure before returning an email match', () => {
    const emailMatch = body.match(/const matches = await findPeopleByAddresses[\s\S]*?\n[^\n]*\n/)
    expect(emailMatch).not.toBeNull()
    expect(emailMatch?.[0]).toMatch(/isErasedSubject\(em, matches\[0\]\.id, scope\)/)
  })
})
