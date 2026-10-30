import { parseSuppressionCsv } from '../csv-emails'

const LIMIT = 1_000

describe('parseSuppressionCsv', () => {
  it('reads a bare list of addresses', () => {
    const list = parseSuppressionCsv('a@example.com\nb@example.com\n', LIMIT)
    expect(list).toEqual({ emails: ['a@example.com', 'b@example.com'], skipped: 0, truncated: false })
  })

  it('recognises a header and takes the named column', () => {
    const csv = 'First name,Email Address,Country\nJohn,john@example.com,PL\nJane,jane@example.com,DE\n'
    expect(parseSuppressionCsv(csv, LIMIT).emails).toEqual(['john@example.com', 'jane@example.com'])
  })

  /** Exports from a tool nobody here controls: a BOM, CRLF endings and a trailing blank line are all normal. */
  it('survives a BOM, CRLF endings and a trailing newline', () => {
    const csv = '﻿email\r\nA@Example.com\r\n\r\n'
    expect(parseSuppressionCsv(csv, LIMIT).emails).toEqual(['a@example.com'])
  })

  /**
   * A headerless two-column export with a quoted name containing a comma is a real shape.
   *
   * Taking the first column blindly would suppress nobody and report every row as skipped, which looks exactly
   * like a file with no addresses in it.
   */
  it('finds the address in a headerless row whose first field is a quoted name', () => {
    const csv = '"Smith, John",john@example.com\n"Doe, Jane",jane@example.com\n'
    expect(parseSuppressionCsv(csv, LIMIT).emails).toEqual(['john@example.com', 'jane@example.com'])
  })

  it('accepts semicolons, which European exports use', () => {
    expect(parseSuppressionCsv('name;email\nJohn;john@example.com\n', LIMIT).emails).toEqual(['john@example.com'])
  })

  it('unescapes a doubled quote inside a quoted field', () => {
    const csv = '"He said ""hi""",quoted@example.com\n'
    expect(parseSuppressionCsv(csv, LIMIT).emails).toEqual(['quoted@example.com'])
  })

  /**
   * A row that cannot be an address is REPORTED, never guessed at.
   *
   * The alternative is suppressing whoever the guess lands on, which is the one mistake this endpoint must not
   * make — an unsubscribe cannot be undone by an import, because there is no way to import "subscribed".
   */
  it('counts rows with nothing usable rather than guessing', () => {
    const list = parseSuppressionCsv('email\nnot-an-address\n@nodomain\nuser@\nreal@example.com\n', LIMIT)
    expect(list.emails).toEqual(['real@example.com'])
    expect(list.skipped).toBe(3)
  })

  it('de-duplicates case-insensitively without inflating the skipped count', () => {
    const list = parseSuppressionCsv('a@example.com\nA@EXAMPLE.COM\na@example.com\n', LIMIT)
    expect(list.emails).toEqual(['a@example.com'])
    expect(list.skipped).toBe(0)
  })

  /** A count that stops at a ceiling must never be reported as a total — the module's rule. */
  it('says when the file was longer than the caller allows', () => {
    const csv = Array.from({ length: 5 }, (_, index) => `person${index}@example.com`).join('\n')
    const list = parseSuppressionCsv(csv, 3)
    expect(list.emails).toHaveLength(3)
    expect(list.truncated).toBe(true)
  })

  it('does not claim truncation when the file exactly fills the limit', () => {
    const csv = Array.from({ length: 3 }, (_, index) => `person${index}@example.com`).join('\n')
    expect(parseSuppressionCsv(csv, 3).truncated).toBe(false)
  })

  it('answers empty for an empty file rather than throwing', () => {
    expect(parseSuppressionCsv('', LIMIT)).toEqual({ emails: [], skipped: 0, truncated: false })
    expect(parseSuppressionCsv('\n\n\n', LIMIT)).toEqual({ emails: [], skipped: 0, truncated: false })
  })

  /** A file that is ONLY a header has no rows, and no skipped rows either. */
  it('treats a header-only file as empty', () => {
    expect(parseSuppressionCsv('email\n', LIMIT)).toEqual({ emails: [], skipped: 0, truncated: false })
  })
})
