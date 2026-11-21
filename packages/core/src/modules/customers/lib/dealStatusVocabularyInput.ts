export function formatDealStatusAliases(aliases: readonly string[]): string {
  return aliases.map((alias) => /[,"\\]/.test(alias) ? JSON.stringify(alias) : alias).join(', ')
}

export function parseDealStatusAliases(input: string): string[] | null {
  const aliases: string[] = []
  let remaining = input.trim()
  while (remaining) {
    if (remaining.startsWith(',')) {
      remaining = remaining.slice(1).trimStart()
      continue
    }
    const quoted = remaining.startsWith('"')
    const match = quoted ? /^"(?:[^"\\]|\\.)*"/.exec(remaining) : /^[^,]+/.exec(remaining)
    if (!match) return null
    let alias: string
    try {
      alias = quoted ? JSON.parse(match[0]) as string : match[0]
    } catch {
      return null
    }
    if (alias.trim()) aliases.push(alias.trim())
    remaining = remaining.slice(match[0].length).trimStart()
    if (remaining && !remaining.startsWith(',')) return null
  }
  return aliases
}
