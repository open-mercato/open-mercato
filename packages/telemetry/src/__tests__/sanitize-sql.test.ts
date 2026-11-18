import { PostgreSqlPlatform } from '@mikro-orm/postgresql'
import { sanitizeSqlStatement } from '../provider/sanitize-sql'
import { PG_INSTRUMENTATION_OPTIONS, PG_STATEMENT_ATTRIBUTE_KEYS } from '../provider/otlp-provider'

const SENTINEL = 'pii-sentinel-value'
const platform = new PostgreSqlPlatform()

describe('sanitizeSqlStatement', () => {
  it('strips values MikroORM inlines into an insert, keeping the shape', () => {
    const formatted = platform.formatQuery(
      'insert into "comments" ("tenant_id", "body", "attempts", "is_public", "created_at") values (?, ?, ?, ?, ?) returning "id"',
      ['c68d875e-b431-48c4-85ef-a8ce6d1c5540', SENTINEL, 42, true, new Date('2026-11-18T08:04:43.385Z')],
    )
    expect(formatted).toContain(SENTINEL)
    expect(sanitizeSqlStatement(formatted)).toBe(
      'insert into "comments" ("tenant_id", "body", "attempts", "is_public", "created_at") values (?, ?, ?, ?, ?) returning "id"',
    )
  })

  it('strips an id literal from a MikroORM findOne-style select', () => {
    const formatted = platform.formatQuery(
      'select "s0".* from "sessions" as "s0" where "s0"."id" = ? and "s0"."user_id" = ? limit ?',
      [SENTINEL, '405da1c6-ddf1-4c4b-9f1e-a7cdead1749c', 1],
    )
    const sanitized = sanitizeSqlStatement(formatted)
    expect(sanitized).toBe('select "s0".* from "sessions" as "s0" where "s0"."id" = ? and "s0"."user_id" = ? limit ?')
    expect(sanitized).not.toContain(SENTINEL)
  })

  it('strips escape strings that MikroORM emits for values with quotes and backslashes', () => {
    const formatted = platform.formatQuery('update "notes" set "body" = ? where "id" = ?', [`O'Brien \\ ${SENTINEL} '`, 7])
    expect(formatted).toContain(" E'")
    expect(sanitizeSqlStatement(formatted)).toBe('update "notes" set "body" =  ? where "id" = ?')
  })

  it('strips JSON and array literals', () => {
    const formatted = platform.formatQuery('select * from "t" where "data" @> ? and "id" in (?)', [
      JSON.stringify({ email: SENTINEL }),
      [SENTINEL, 'other'],
    ])
    const sanitized = sanitizeSqlStatement(formatted)
    expect(sanitized).toBe('select * from "t" where "data" @> ? and "id" in (?, ?)')
  })

  it('keeps placeholders, quoted identifiers, and numbers inside identifiers', () => {
    const statement = `select "u1"."id", t0.x$1 from "it's ""odd"""."x" as t0 where id = $1 and n = $12`
    expect(sanitizeSqlStatement(statement)).toBe(statement)
  })

  it('strips numeric, boolean, prefixed and dollar-quoted literals', () => {
    expect(sanitizeSqlStatement("select 1, -2.5, .5e3, TRUE, false, B'0101', X'ff', N'abc', $$x$$, $tag$y$tag$")).toBe(
      'select ?, -?, ?, ?, ?, ?, ?, ?, ?, ?',
    )
  })

  it('strips non-decimal, underscored and suffixed numbers whole', () => {
    expect(sanitizeSqlStatement('select 0x1F, 0o17, 0b101, 1_000_000, 123abc, 1.5e3')).toBe('select ?, ?, ?, ?, ?, ?')
  })

  it('strips dollar-quoted strings with non-ASCII tags and keeps non-ASCII identifiers whole', () => {
    expect(sanitizeSqlStatement(`select $é$ ${SENTINEL} $é$ from zamówienia1`)).toBe('select ? from zamówienia1')
  })

  it('drops nested block comments in full', () => {
    expect(sanitizeSqlStatement(`select 1 /* outer /* inner */ ${SENTINEL} */ from t`)).toBe('select ?   from t')
  })

  it('drops comments, which can carry arbitrary text', () => {
    expect(sanitizeSqlStatement(`select 1 -- ${SENTINEL}\nfrom t /* ${SENTINEL} */ where a = b`)).toBe(
      'select ? \nfrom t   where a = b',
    )
  })

  it.each([
    `select '${SENTINEL}`,
    `select E'${SENTINEL}\\'`,
    'select "unterminated',
    `select $$${SENTINEL}`,
    `select 1 /* ${SENTINEL}`,
    `select 1 /* a /* b */ ${SENTINEL}`,
  ])('fails closed on %s', (text) => {
    expect(sanitizeSqlStatement(text)).toBeUndefined()
  })
})

describe('PG_INSTRUMENTATION_OPTIONS.requestHook', () => {
  function runHook(text: unknown) {
    const attributes: Record<string, unknown> = {}
    const span = { setAttribute: (key: string, value: unknown) => { attributes[key] = value } }
    const hook = PG_INSTRUMENTATION_OPTIONS.requestHook as (span: unknown, info: unknown) => void
    hook(span, { connection: {}, query: { text } })
    return attributes
  }

  it('overwrites every statement attribute key with the sanitized text', () => {
    const attributes = runHook(`select * from "users" where "id" = '${SENTINEL}'`)
    for (const key of PG_STATEMENT_ATTRIBUTE_KEYS) {
      expect(attributes[key]).toBe('select * from "users" where "id" = ?')
    }
  })

  it('writes a fixed marker when the text cannot be tokenized', () => {
    const attributes = runHook(`select '${SENTINEL}`)
    expect(JSON.stringify(attributes)).not.toContain(SENTINEL)
    expect(attributes['db.query.text']).toBe('[redacted]')
  })

  it('leaves the span alone when there is no statement text', () => {
    expect(runHook(undefined)).toEqual({})
  })
})
