const NUL_CHARACTER = '\u0000'

/** PostgreSQL `text` columns cannot store U+0000, so extracted text must not carry it into a write. */
export function stripNulCharacters(text: string): string {
  return text.replaceAll(NUL_CHARACTER, '')
}
