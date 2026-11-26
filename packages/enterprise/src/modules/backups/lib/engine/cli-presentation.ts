import { backupTranslation } from './locale'

export type CliProgressMode = 'tty' | 'plain' | 'json' | 'verbose' | 'none'
export type CliPresentationOutput = Pick<NodeJS.WriteStream, 'write'> & Partial<Pick<NodeJS.WriteStream, 'isTTY' | 'columns' | 'rows'>>
type StatusKind = 'ok' | 'warn' | 'fail' | 'info' | 'working'

export function humanTerminalEnabled(output: CliPresentationOutput, mode: CliProgressMode): boolean {
  return mode === 'tty' && output.isTTY === true && !Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb'
}

const clean = (value: string) => value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*?(?:\u0007|\u001b\\))/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '')

export function createCliPresentation({ mode, output = process.stderr, suspend = () => {} }: { mode: CliProgressMode; output?: CliPresentationOutput; suspend?: () => void }) {
  const rich = humanTerminalEnabled(output, mode)
  const paint = (code: number, text: string) => rich ? `\u001b[${code}m${text}\u001b[0m` : text
  const icons: Record<StatusKind, string> = { ok: '✅', warn: '❗', fail: '❌', info: '💡', working: '🔧' }
  const colors: Record<StatusKind, number> = { ok: 32, warn: 33, fail: 31, info: 36, working: 36 }
  const labels = { ok: 'backups.presentation.ok', warn: 'backups.presentation.warn', fail: 'backups.presentation.error', info: 'backups.presentation.info', working: 'backups.presentation.working' } as const
  const prefix = (kind: StatusKind) => rich ? paint(colors[kind], icons[kind]) : `[${backupTranslation(labels[kind])}]`
  const write = (lines: string[]) => {
    if (mode === 'json') return
    suspend()
    output.write(lines.join('\n') + '\n')
  }
  const rule = (kind: StatusKind) => paint(colors[kind], (rich ? '─' : '-').repeat(Math.max(8, Math.min(60, (output.columns ?? 80) - 4))))
  return {
    title(text: string) { if (mode !== 'none') write(['', `   ${paint(36, clean(text))}`]) },
    step(index: number, total: number, title: string, expected?: string) {
      if (mode === 'none') return
      write(['', `   ${paint(1, paint(34, `${rich ? '──' : '--'} ${backupTranslation('backups.presentation.step')} ${index}/${total}`))} ${paint(1, clean(title))}`, ...(expected ? [`   ${paint(33, backupTranslation('backups.presentation.expected') + ':')} ${clean(expected)}`] : [])])
    },
    status(kind: StatusKind, text: string) { if (mode !== 'none' || kind === 'fail' || kind === 'warn') write([`   ${prefix(kind)} ${paint(colors[kind], clean(text))}`]) },
    result(title: string, lines: string[], kind: 'ok' | 'warn' = 'ok') { write(['', `   ${rule(kind)}`, `   ${prefix(kind)} ${paint(colors[kind], paint(1, clean(title)))}`, ...lines.map(line => `   ${clean(line)}`), `   ${rule(kind)}`, '']) },
    error(title: string, lines: string[]) { write(['', `   ${rule('fail')}`, `   ${prefix('fail')} ${paint(31, paint(1, clean(title)))}`, ...lines.map(line => `   ${clean(line)}`), `   ${rule('fail')}`, '']) },
    notice(text: string) { write([`   ${clean(text)}`]) },
  }
}
