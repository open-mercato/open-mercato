import type { ProgressEvent, ProgressSink } from './types'
import { backupTranslation } from './locale'
import { humanTerminalEnabled } from './cli-presentation'

type Output = Pick<NodeJS.WriteStream, 'write'> & Partial<Pick<NodeJS.WriteStream, 'rows' | 'columns' | 'isTTY'>>
type EntityState = { startedAt: number; lastProgressAt?: number; status: 'running' | 'queued' | 'done' | 'failed' }
type View = { key: string; event: ProgressEvent; state: EntityState; finishedAt?: number }
const maximumEntities = 10000
const maximumRunning = 8
const clean = (value: string) => value.slice(0, 1024).replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*?(?:\u0007|\u001b\\))/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '')
const combiningMark = /\p{Mark}/u
function cells(character: string): number {
  const code = character.codePointAt(0)!
  if (code < 0x0300) return 1
  if (combiningMark.test(character)) return 0
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff) || code >= 0x20000) ? 2 : 1
}
function clip(value: string, width: number): string {
  let result = '', used = 0
  for (const character of clean(value)) { const size = cells(character); if (used + size > width) break; result += character; used += size }
  return result
}
const numeric = (value: string) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0 }
const ratio = (done: string, total: string, finished: boolean) => numeric(total) > 0 ? Math.max(0, Math.min(1, numeric(done) / numeric(total))) : finished ? 1 : 0
const bar = (fraction: number) => '█'.repeat(Math.floor(fraction * 16)) + '░'.repeat(16 - Math.floor(fraction * 16))

export type RenderedProgressSink = ProgressSink & { suspend(): void }

export function progressRenderer(mode: 'tty' | 'plain' | 'json' | 'verbose' | 'none', output: Output = process.stderr): RenderedProgressSink {
  const rich = humanTerminalEnabled(output, mode)
  if (mode === 'tty' && !rich) mode = 'plain'
  let paintedRows = 0
  const suspend = () => {
    if (paintedRows) output.write((paintedRows > 1 ? `\u001b[${paintedRows - 1}B` : '') + '\r\n')
    paintedRows = 0
  }
  const paint = (code: number, text: string) => rich ? `\u001b[${code}m${text}\u001b[0m` : text
  const last = new Map<string, number>()
  const states = new Map<string, EntityState>()
  const active = new Map<string, View>()
  const failures = new Map<string, View>()
  const plainStates = new Map<string, string>()
  let recent: View[] = []
  let startedAt = Date.now(), lastOverall = 0, lastPaint = 0, completed = 0, failed = 0
  let runId: string | undefined, phase: string | undefined
  let aggregate: Pick<ProgressEvent, 'overallRowsDone' | 'overallRowsTotal' | 'overallRowsTotalExact'> = {}
  let entitiesTotal: number | undefined, entitiesDone: number | undefined
  const reset = (event: ProgressEvent, now: number) => {
    states.clear(); active.clear(); failures.clear(); recent = []; completed = 0; failed = 0
    aggregate = {}; entitiesTotal = undefined; entitiesDone = undefined; startedAt = now; phase = event.phase; runId = event.runId
  }
  const render = (event: ProgressEvent) => {
    if (mode === 'none') return
    const now = Date.now(), token = (event.entityKey ?? event.entity)?.slice(0, 1024)
    if (mode !== 'tty') {
      if (mode === 'plain') {
        if (event.type === 'run.started' || (runId !== undefined && runId !== event.runId)) plainStates.clear()
        runId = event.runId
        const state = event.type === 'entity.progress' ? 'running' : event.type === 'entity.done' ? 'done' : event.type === 'entity.failed' ? 'failed' : undefined
        const changed = token !== undefined && state !== undefined && plainStates.get(token) !== state
        if (token !== undefined && state !== undefined) { plainStates.delete(token); plainStates.set(token, state); if (plainStates.size > maximumEntities) plainStates.delete(plainStates.keys().next().value!) }
        const overallDue = now - lastOverall >= 10000 || event.type === 'run.started' || event.type === 'run.finished'
        const hasOverall = event.overallRowsDone !== undefined && event.overallRowsTotal !== undefined
        if (event.type !== 'entity.progress' || changed || (overallDue && !hasOverall)) output.write(`${clean(event.entity ?? event.phase ?? event.type).slice(0, 120)}: ${event.rowsDone}/${event.rowsTotalExact ? '' : '~'}${event.rowsTotal} ${backupTranslation('backups.progress.rows')} · ${event.bytesDone} ${backupTranslation('backups.progress.bytes')} · ${event.chunksDone} ${backupTranslation('backups.progress.chunks')}\n`)
        if (overallDue) {
          lastOverall = now
          if (hasOverall) {
            const entities = event.entitiesDone !== undefined && event.entitiesTotal !== undefined ? ` · ${event.entitiesDone}/${event.entitiesTotal} ${backupTranslation('backups.progress.completed')}` : ''
            output.write(`${backupTranslation('backups.progress.overall')}: ${event.overallRowsDone}/${event.overallRowsTotalExact ? '' : '~'}${event.overallRowsTotal} ${backupTranslation('backups.progress.rows')}${entities}\n`)
          }
        }
        return
      }
      const key = `${token ?? ''}:${event.type}`
      if (event.type === 'entity.progress' && now - (last.get(key) ?? 0) < 500) return
      last.set(key, now); if (last.size > maximumEntities) last.clear()
      if (mode === 'json') { output.write(JSON.stringify(event) + '\n'); return }
      output.write(`${clean(event.entity ?? event.phase ?? event.type).slice(0, 120)}: ${event.rowsDone}/${event.rowsTotalExact ? '' : '~'}${event.rowsTotal} ${backupTranslation('backups.progress.rows')} · ${event.bytesDone} ${backupTranslation('backups.progress.bytes')} · ${event.chunksDone} ${backupTranslation('backups.progress.chunks')}\n`)
      return
    }
    if (event.type === 'run.started' || (runId !== undefined && event.runId !== runId) || (phase !== undefined && event.phase !== undefined && phase !== event.phase && ['baseline', 'verification'].includes(phase) && ['baseline', 'verification'].includes(event.phase))) reset(event, now)
    runId = event.runId
    if (event.phase !== undefined) phase = event.phase
    if (event.overallRowsDone !== undefined && event.overallRowsTotal !== undefined) aggregate = event
    if (event.entitiesTotal !== undefined) entitiesTotal = event.entitiesTotal
    if (event.entitiesDone !== undefined) entitiesDone = event.entitiesDone
    let isNew = false, throttled = false
    if (token !== undefined && event.type.startsWith('entity.')) {
      let state = states.get(token)
      if (!state) { state = { startedAt: numeric(event.bytesDone) > 0 ? startedAt : now, status: 'queued' }; isNew = true }
      states.delete(token); states.set(token, state)
      if (event.type === 'entity.progress') {
        isNew ||= state.status !== 'running'
        throttled = state.lastProgressAt !== undefined && now - state.lastProgressAt < 500 && !isNew
        if (!throttled) state.lastProgressAt = now
        if (state.status === 'done') completed--
        if (state.status === 'failed') failed--
        state.status = 'running'; failures.delete(token); recent = recent.filter(view => view.key !== token)
        active.set(token, { key: token, event, state })
        if (active.size > maximumRunning) { const oldest = active.keys().next().value!; states.get(oldest)!.status = 'queued'; active.delete(oldest) }
      } else {
        if (state.status === 'done' && event.type !== 'entity.done') completed--
        if (state.status === 'failed' && event.type !== 'entity.failed') failed--
        if (event.type === 'entity.done' && state.status !== 'done') completed++
        if (event.type === 'entity.failed' && state.status !== 'failed') failed++
        state.status = event.type === 'entity.failed' ? 'failed' : 'done'
        active.delete(token)
        recent = recent.filter(view => view.key !== token)
        if (state.status === 'failed') {
          failures.set(token, { key: token, event, state, finishedAt: now })
          if (failures.size > maximumRunning) failures.delete(failures.keys().next().value!)
        } else { failures.delete(token); recent = [{ key: token, event, state, finishedAt: now }, ...recent].slice(0, 3) }
      }
      while (states.size > maximumEntities) {
        const oldest = states.keys().next().value!
        if (active.has(oldest) || failures.has(oldest)) { const value = states.get(oldest)!; states.delete(oldest); states.set(oldest, value) } else states.delete(oldest)
      }
    }
    if (event.type === 'entity.progress' && !isNew && (throttled || now - lastPaint < 100)) return
    if (event.type === 'run.finished') {
      entitiesDone = failed ? entitiesDone ?? completed : entitiesTotal ?? completed + active.size
      completed = entitiesDone; active.clear()
    }
    lastPaint = now
    const width = Math.max(9, Math.min(299, Math.floor(output.columns ?? 100) - 1))
    const height = Math.max(1, Math.min(199, Math.floor(output.rows ?? 24) - 1))
    const finished = event.type === 'run.finished'
    const lines: string[] = []
    if (aggregate.overallRowsDone !== undefined && aggregate.overallRowsTotal !== undefined) {
      const fraction = ratio(aggregate.overallRowsDone, aggregate.overallRowsTotal, finished)
      lines.push(aggregate.overallRowsTotalExact && !failed ? `${backupTranslation('backups.progress.overall')} ${bar(fraction)} ${Math.floor(fraction * 100)}% ${aggregate.overallRowsDone}/${aggregate.overallRowsTotal}` : `${backupTranslation('backups.progress.overall')} ${aggregate.overallRowsDone}/~${aggregate.overallRowsTotal}`)
    }
    const done = Math.max(0, entitiesDone ?? completed)
    const queued = finished ? '0' : entitiesTotal === undefined ? '?' : String(Math.max(0, entitiesTotal - done - active.size - failed))
    lines.push(`${active.size} ${backupTranslation('backups.progress.running')} · ${queued} ${backupTranslation('backups.progress.queued')} · ${done} ${backupTranslation('backups.progress.completed')}${failed ? ` · ${failed} ${backupTranslation('backups.progress.failed')}` : ''}`)
    if (phase) lines.push(`${backupTranslation('backups.progress.phase')}: ${clean(phase)}`)
    const entityLine = (view: View) => {
      const item = view.event, fraction = ratio(item.rowsDone, item.rowsTotal, view.state.status === 'done')
      const elapsed = Math.max(0.1, ((view.finishedAt ?? now) - view.state.startedAt) / 1000)
      const rate = Math.round(numeric(item.bytesDone) / elapsed / 1048576)
      const eta = fraction > 0 && fraction < 1 ? Math.ceil(elapsed * (1 - fraction) / fraction) : 0
      const suffix = item.rowsTotalExact && view.state.status !== 'failed' ? `${bar(fraction)} ${Math.floor(fraction * 100)}% ${item.rowsDone}/${item.rowsTotal} ${backupTranslation('backups.progress.rows')} ${rate}MiB/s ETA ${eta}s` : `${item.rowsDone}/~${item.rowsTotal} ${backupTranslation('backups.progress.rows')} ${rate}MiB/s ${Math.floor(elapsed)}s`
      const label = clip(item.entity ?? view.key, Math.max(4, width - Array.from(suffix).reduce((size, character) => size + cells(character), 0) - 3))
      return `${view.state.status === 'done' ? '✅' : view.state.status === 'failed' ? '❌' : '🔧'} ${label} ${suffix}`
    }
    if (failures.size) lines.unshift(`❌ ${failed} ${backupTranslation('backups.progress.failed')}`, ...[...failures.values()].map(entityLine))
    for (const view of active.values()) lines.push(entityLine(view))
    for (const view of recent) lines.push(entityLine(view))
    const panel = lines.slice(0, height).map(line => {
      const visible = clip(line, width)
      return paint(line.startsWith('❌') ? 31 : line.startsWith('✅') ? 32 : line.startsWith('🔧') || line.startsWith(backupTranslation('backups.progress.overall')) ? 36 : 34, visible)
    })
    const clear = paintedRows ? '\r\u001b[2K' + ('\u001b[1B\r\u001b[2K').repeat(paintedRows - 1) + (paintedRows > 1 ? `\u001b[${paintedRows - 1}A\r` : '') : '\r'
    output.write(clear + panel.join('\r\n') + (finished ? '\r\n' : panel.length > 1 ? `\u001b[${panel.length - 1}A\r` : '\r'))
    paintedRows = finished ? 0 : panel.length
  }
  return Object.assign(render, { suspend })
}
