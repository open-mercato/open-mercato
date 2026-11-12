import type { ProgressEvent, ProgressSink } from './types'
import { backupTranslation } from './locale'
export function progressRenderer(mode: 'tty' | 'plain' | 'json' | 'verbose' | 'none', output: Pick<NodeJS.WriteStream, 'write'> = process.stderr): ProgressSink {
  const last = new Map<string, number>()
  return (event: ProgressEvent) => {
    if (mode === 'none') return
    const key = `${event.entity ?? ''}:${event.type}`
    const now = Date.now()
    if (event.type === 'entity.progress' && now - (last.get(key) ?? 0) < 500) return
    last.set(key, now)
    if (last.size > 10000) last.clear()
    if (mode === 'json') output.write(JSON.stringify(event) + '\n')
    else {
      const label = (event.entity ?? event.phase ?? event.type).replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 200)
      const prefix = event.rowsTotalExact ? '' : '~'
      output.write(`${label}: ${event.rowsDone}/${prefix}${event.rowsTotal} ${backupTranslation('backups.progress.rows')} · ${event.bytesDone} ${backupTranslation('backups.progress.bytes')} · ${event.chunksDone} ${backupTranslation('backups.progress.chunks')}\n`)
    }
  }
}
