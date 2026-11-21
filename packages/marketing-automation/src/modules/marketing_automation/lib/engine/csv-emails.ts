/**
 * Reading a suppression list somebody exported from another tool.
 *
 * The commonest migration task there is: a shop leaving Mailchimp, Klaviyo or a spreadsheet arrives with a list of
 * people who must never be mailed again, and honouring it is the first thing they need. The operator consent
 * endpoint could already record one such decision at a time; this is the parser for the batch.
 *
 * Pure, and deliberately forgiving about SHAPE while strict about CONTENT: the file comes from a tool nobody here
 * controls, so a BOM, CRLF endings, a quoted header, a trailing blank line and extra columns are all expected.
 * What is not forgiven is a value that is not an address — a row that cannot be an email is REPORTED rather than
 * guessed at, because the alternative is suppressing whoever the guess lands on.
 */

export type SuppressionList = {
  /** Lower-cased, trimmed, de-duplicated, in the order the file listed them. */
  emails: string[]
  /** Rows that held no usable address. Reported, never silently dropped. */
  skipped: number
  /** True when the file held more rows than the caller allowed. */
  truncated: boolean
}

/**
 * One CSV line into fields, honouring double quotes and escaped quotes.
 *
 * Hand-rolled rather than a dependency: this reads one column out of a flat export, and adding a CSV library to a
 * marketing module to do that is a production dependency nobody should have to review.
 */
function splitLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    // Comma or semicolon: European exports use the latter, and a list of addresses has no ambiguity either way.
    if (char === ',' || char === ';') {
      fields.push(current)
      current = ''
      continue
    }
    current += char
  }
  fields.push(current)
  return fields.map((field) => field.trim())
}

/**
 * Whether this looks like an address at all.
 *
 * Deliberately not a full RFC 5322 validator: the address is about to be LOOKED UP, so a wrong-but-plausible one
 * matches nobody and costs nothing, while a strict validator that rejects a legitimate unusual address would fail
 * to suppress somebody who asked to be suppressed. The bar is "could be looked up".
 */
function looksLikeEmail(value: string): boolean {
  if (value.length < 3 || value.length > 320) return false
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const domain = value.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && !/\s/.test(value)
}

/** A header row is detected rather than assumed: plenty of exports have none. */
function headerEmailColumn(fields: string[]): number | null {
  const index = fields.findIndex((field) => /^"?e-?mail(\s*address)?"?$/i.test(field.trim()))
  return index >= 0 ? index : null
}

export function parseSuppressionCsv(text: string, limit: number): SuppressionList {
  // A BOM on the first field would make "email" not match "email", and would be prepended to the first address.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const seen = new Set<string>()
  const emails: string[] = []
  let skipped = 0
  let truncated = false
  let column: number | null = null
  let examined = 0

  for (const [position, line] of lines.entries()) {
    if (line.trim().length === 0) continue
    const fields = splitLine(line)

    if (position === 0) {
      const header = headerEmailColumn(fields)
      if (header !== null) {
        column = header
        continue
      }
    }

    examined += 1
    if (emails.length >= limit) {
      truncated = true
      break
    }

    /**
     * The named column when the header gave one, otherwise the first field that could be an address.
     *
     * Scanning is what makes a headerless two-column export work — `"Smith, John",john@example.com` is a real
     * shape, and taking the first column blindly would suppress nobody and report every row as skipped.
     */
    const candidate = column !== null
      ? (fields[column] ?? '').toLowerCase()
      : (fields.find((field) => looksLikeEmail(field.toLowerCase())) ?? '').toLowerCase()

    if (!looksLikeEmail(candidate)) {
      skipped += 1
      continue
    }
    if (seen.has(candidate)) continue
    seen.add(candidate)
    emails.push(candidate)
  }

  return { emails, skipped, truncated: truncated || examined > limit }
}
