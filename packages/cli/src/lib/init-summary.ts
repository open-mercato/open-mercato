type InitSummaryUser = { icon: string; label: string; email: string; password: string }

type InitSummaryOptions = {
  users: InitSummaryUser[]
  autoStart: boolean
  columns?: number
  color?: boolean
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const panelStyle = '\u001b[48;2;57;62;70m\u001b[38;2;238;238;238m'
const reset = '\u001b[0m'

function cellWidth(value: string): number {
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(value)) return 2
  return /^\p{Mark}+$/u.test(value) ? 0 : 1
}

function wrapLine(line: string, width: number): string[] {
  const wrapped: string[] = []
  let current = ''
  let currentWidth = 0
  for (const { segment } of segmenter.segment(line)) {
    const segmentWidth = cellWidth(segment)
    if (currentWidth + segmentWidth > width && current) {
      wrapped.push(current)
      current = ''
      currentWidth = 0
    }
    current += segment
    currentWidth += segmentWidth
  }
  wrapped.push(current)
  return wrapped
}

export function formatInitSummary({ users, autoStart, columns = 80, color = false }: InitSummaryOptions): string[] {
  const width = Number.isFinite(columns) && columns >= 8 ? Math.floor(columns) : 80
  const lines = ['', '🔑 DEVELOPMENT ACCOUNTS', '']
  for (const user of users) {
    lines.push(`${user.icon} ${user.label}`, `   Email:     ${user.email}`, `   Password:  ${user.password}`, '')
  }
  lines.push(...(autoStart
    ? ['🚀 The dev server will start automatically.', '   Next time, run: yarn dev']
    : ['🚀 Start the dev server: yarn dev']))
  lines.push('')
  const rule = '━'.repeat(width)
  const content = lines.flatMap((line) => wrapLine(line, width - 4).map((part) => `  ${part}`))
  return [rule, ...content, rule].map((line) => {
    if (!color) return line
    const visibleWidth = [...segmenter.segment(line)].reduce((total, { segment }) => total + cellWidth(segment), 0)
    return `${panelStyle}${line}${' '.repeat(Math.max(0, width - visibleWidth))}${reset}`
  })
}
