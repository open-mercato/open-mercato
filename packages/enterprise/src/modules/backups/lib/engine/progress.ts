import type { ProgressEvent, ProgressSink } from './types'
import { backupTranslation } from './locale'
export function progressRenderer(mode: 'tty' | 'plain' | 'json' | 'verbose' | 'none', output: Pick<NodeJS.WriteStream, 'write'> = process.stderr): ProgressSink {
  const last = new Map<string, number>()
  const started = Date.now()
  let lastOverall = 0
  return (event: ProgressEvent) => {
    if (mode === 'none') return
    const key = `${event.entity ?? ''}:${event.type}`
    const now = Date.now()
    if (event.type === 'entity.progress' && now - (last.get(key) ?? 0) < 500) return
    last.set(key, now)
    if (last.size > 10000) last.clear()
    if (mode === 'json') { output.write(JSON.stringify(event) + '\n'); return }
    const label = (event.entity ?? event.phase ?? event.type).replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 120)
    const prefix = event.rowsTotalExact ? '' : '~'
    if (mode === 'tty') {
      const total = Number(event.rowsTotal), done = Number(event.rowsDone)
      const ratio = total > 0 ? Math.min(1, done / total) : ['entity.done','run.finished'].includes(event.type) ? 1 : 0
      const elapsed = Math.max(0.1, (now - started) / 1000)
      const rate = Number(event.bytesDone) / elapsed
      const eta = ratio > 0 && ratio < 1 ? Math.ceil(elapsed * (1 - ratio) / ratio) : 0
      const bar = '█'.repeat(Math.floor(ratio * 16)) + '░'.repeat(16 - Math.floor(ratio * 16))
      const text = `${label} ${bar} ${Math.floor(ratio * 100)}% ${event.rowsDone}/${prefix}${event.rowsTotal} ${backupTranslation('backups.progress.rows')} ${Math.round(rate / 1048576)}MiB/s ETA ${eta}s`
      output.write(`\r\u001b[2K${text}${event.type === 'entity.done' || event.type === 'run.finished' ? '\n' : ''}`)
    } else {
      if (mode === 'plain' && event.type === 'entity.progress' && now - lastOverall < 10000) return
      lastOverall = now
      output.write(`${label}: ${event.rowsDone}/${prefix}${event.rowsTotal} ${backupTranslation('backups.progress.rows')} · ${event.bytesDone} ${backupTranslation('backups.progress.bytes')} · ${event.chunksDone} ${backupTranslation('backups.progress.chunks')}\n`)
    }
  }
}
