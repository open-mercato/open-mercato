const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  dagger: '†',
  permil: '‰',
  prime: '′',
  Prime: '″',
  times: '×',
  divide: '÷',
  minus: '−',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  larr: '←',
  rarr: '→',
  harr: '↔',
  darr: '↓',
  uarr: '↑',
}

function codePointToString(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ''
  // Surrogate halves are not valid standalone scalar values.
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return '�'
  return String.fromCodePoint(codePoint)
}

/**
 * Decodes HTML character references in a single forward pass. Unterminated or
 * unknown references are emitted verbatim, matching how browsers treat them.
 */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input
  let output = ''
  let position = 0
  while (position < input.length) {
    const start = input.indexOf('&', position)
    if (start === -1) {
      output += input.slice(position)
      break
    }
    output += input.slice(position, start)
    const end = input.indexOf(';', start + 1)
    if (end === -1 || end - start > 32) {
      output += '&'
      position = start + 1
      continue
    }
    const reference = input.slice(start + 1, end)
    if (reference.startsWith('#')) {
      const isHex = reference[1] === 'x' || reference[1] === 'X'
      const digits = isHex ? reference.slice(2) : reference.slice(1)
      const valid = isHex ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits)
      if (valid) {
        output += codePointToString(Number.parseInt(digits, isHex ? 16 : 10))
        position = end + 1
        continue
      }
    } else if (Object.hasOwn(NAMED, reference)) {
      output += NAMED[reference]
      position = end + 1
      continue
    }
    output += '&'
    position = start + 1
  }
  return output
}
