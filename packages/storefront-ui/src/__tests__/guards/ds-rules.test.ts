import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const srcRoot = join(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      walk(full, out)
    } else if (/\.tsx$/.test(entry)) out.push(full)
  }
  return out
}

// Root AGENTS.md design-system rules, applied to the storefront package too (storefront-app spec §6).
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\b(?:text|bg|border|ring)-(?:red|green|emerald|amber|yellow|blue|indigo|orange|rose|pink|purple|violet|sky|teal|zinc|gray|slate|neutral|stone)-\d{2,3}\b/, 'hardcoded Tailwind colour shade'],
  [/\bdark:(?:text|bg|border)-/, 'dark: override on a semantic token'],
  [/\b(?:text|p|px|py|m|mx|my|rounded|z|w|h|gap)-\[[^\]]*\]/, 'arbitrary value'],
  [/#[0-9a-fA-F]{3,8}\b/, 'hex colour in className'],
]

// Allowed exceptions: CSS calc expressions for viewport math.
const ALLOWED = [/\[calc\(100dvh-2rem\)\]/, /\[calc\(100%-2rem\)\]/, /\[92dvh\]/, /\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/, /\[appearance:textfield\]/]

describe('storefront-ui design-system rules', () => {
  it('uses semantic tokens only', () => {
    const offenders: string[] = []
    for (const file of walk(srcRoot)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/className|cva\(|['"`]/.test(line)) return
        if (ALLOWED.some((pattern) => pattern.test(line))) return
        for (const [pattern, reason] of FORBIDDEN) {
          if (pattern.test(line)) offenders.push(`${relative(srcRoot, file)}:${index + 1} ${reason}: ${line.trim().slice(0, 100)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
