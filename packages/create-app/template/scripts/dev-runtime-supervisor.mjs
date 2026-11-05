import fs from 'node:fs'
import path from 'node:path'

import {
  browserReportToSignal,
  createDevRuntimeToken,
  createDiagnosticsSink,
  validateActionRequest,
} from './dev-runtime-diagnostics.mjs'
import { createRuntimeProbe } from './dev-runtime-probe.mjs'
import { createRuntimeStateStore } from './dev-runtime-state.mjs'

export const RUNTIME_STATUS_FILE_NAME = 'dev-runtime-status.json'
export const RUNTIME_DIAGNOSTICS_FILE_NAME = 'dev-runtime-diagnostics.ndjson'
export const RUNTIME_ACTIONS_FILE_NAME = 'dev-runtime-actions.ndjson'
export const RUNTIME_LOGS_FILE_NAME = 'dev-runtime-logs.json'

const SYNC_INTERVAL_MS = 1000
const MAX_CHILD_SIGNALS_PER_SYNC = 50

// Owns the generation-aware runtime state for one supervisor process: it
// ingests app-runtime signals, drains browser reports, runs the continuous
// probe, and publishes an atomically written status file the dev-only app
// bridge can read.
export function createDevRuntimeSupervisor(options = {}) {
  const enabled = options.enabled !== false
  const stateDirectory = options.stateDirectory ?? path.join(process.cwd(), '.mercato')
  const config = options.config ?? {}
  const logger = options.logger ?? console
  const resolveBaseUrl = typeof options.resolveBaseUrl === 'function' ? options.resolveBaseUrl : () => null
  const readChildState = typeof options.readChildState === 'function' ? options.readChildState : () => null

  const token = createDevRuntimeToken()
  const statusFilePath = path.join(stateDirectory, RUNTIME_STATUS_FILE_NAME)
  const diagnosticsFilePath = path.join(stateDirectory, RUNTIME_DIAGNOSTICS_FILE_NAME)
  const actionsFilePath = path.join(stateDirectory, RUNTIME_ACTIONS_FILE_NAME)
  const logsFilePath = path.join(stateDirectory, RUNTIME_LOGS_FILE_NAME)

  const store = createRuntimeStateStore({
    cwd: process.cwd(),
    configuredPort: options.configuredPort,
    publicUrl: options.publicUrl,
  })
  const sink = createDiagnosticsSink({ filePath: diagnosticsFilePath })
  // The in-app banner cannot call the supervisor directly, so the dev-only app
  // route queues an allowlisted action here and the supervisor drains it.
  const actionSink = createDiagnosticsSink({ filePath: actionsFilePath, validate: validateActionRequest })
  const runAction = typeof options.runAction === 'function' ? options.runAction : null

  let lastIngestedChildSignalSeq = 0
  let lastPublishedPayload = null
  let lastPublishedLogsPayload = null
  let syncTimer = null

  const probe = createRuntimeProbe({
    config: config.probe,
    resolveBaseUrl,
    shouldRun: () => store.isReadySeen() && !store.isRecoveryBusy(),
    onDegraded: (result) => {
      store.recordSignal({
        source: 'probe',
        generation: store.getGeneration(),
        code: 'probe_unhealthy',
        title: 'Runtime health check is failing',
        detail: result?.status
          ? `The runtime answered /api/healthz with HTTP ${result.status}`
          : 'The runtime stopped answering /api/healthz',
        blocking: false,
      })
      publish()
    },
    onRecovered: () => {
      store.clearIncidentsBySource('probe')
      publish()
    },
  })

  function writeStatusFile(status) {
    if (!enabled) return
    const payload = JSON.stringify({ token, status, pid: process.pid })
    if (payload === lastPublishedPayload) return
    lastPublishedPayload = payload
    const temporaryPath = `${statusFilePath}.${process.pid}.tmp`
    try {
      fs.mkdirSync(stateDirectory, { recursive: true })
      fs.writeFileSync(temporaryPath, payload, 'utf8')
      fs.renameSync(temporaryPath, statusFilePath)
    } catch {
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {
        // Publishing status is best-effort; the terminal stays authoritative.
      }
    }
  }

  // The bounded log tail lives in its own file so the 2s status poll stays small
  // and the app only pays for lines when a developer opens the logs view.
  function writeLogsFile() {
    if (!enabled) return
    const snapshot = store.getDiagnosticLines(0)
    const payload = JSON.stringify({ token, generation: snapshot.generation, lines: snapshot.lines })
    if (payload === lastPublishedLogsPayload) return
    lastPublishedLogsPayload = payload
    const temporaryPath = `${logsFilePath}.${process.pid}.tmp`
    try {
      fs.mkdirSync(stateDirectory, { recursive: true })
      fs.writeFileSync(temporaryPath, payload, 'utf8')
      fs.renameSync(temporaryPath, logsFilePath)
    } catch {
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {
        // Publishing logs is best-effort; the terminal stays authoritative.
      }
    }
  }

  function publish() {
    const status = store.getStatus()
    writeStatusFile(status)
    writeLogsFile()
    return status
  }

  function drainBrowserReports() {
    if (!enabled) return
    for (const report of sink.drain()) {
      store.recordSignal(browserReportToSignal(report, store.getGeneration()))
    }
  }

  // Requests carrying a stale generation are dropped: the runtime they were
  // raised against no longer exists.
  function drainActionRequests() {
    if (!enabled || !runAction) return
    for (const request of actionSink.drain()) {
      if (Number.isInteger(request.generation) && request.generation !== store.getGeneration()) continue
      void runAction(request.action)
    }
  }

  // The app runtime wrapper publishes classified signals through its splash
  // child-state file. Sequence numbers make ingestion idempotent.
  function ingestChildState(childState) {
    if (!enabled || !childState || typeof childState !== 'object') return
    const signals = Array.isArray(childState.runtimeSignals) ? childState.runtimeSignals : []
    let ingested = 0
    for (const signal of signals) {
      if (!signal || typeof signal !== 'object') continue
      if (!Number.isInteger(signal.seq) || signal.seq <= lastIngestedChildSignalSeq) continue
      if (ingested >= MAX_CHILD_SIGNALS_PER_SYNC) break
      lastIngestedChildSignalSeq = signal.seq
      ingested += 1
      store.recordSignal({ ...signal, generation: store.getGeneration() })
    }
    if (childState.ready === true && !store.isReadySeen()) {
      store.markReady()
    }
  }

  // One collection cycle: pull the child's typed signals, drain browser
  // reports, and republish. Runs on an interval and is safe to call directly.
  function sync() {
    ingestChildState(readChildState())
    drainBrowserReports()
    drainActionRequests()
    return publish()
  }

  return {
    enabled,
    token,
    statusFilePath,
    diagnosticsFilePath,
    actionsFilePath,
    logsFilePath,
    getStatus: store.getStatus,
    getGeneration: store.getGeneration,
    isReadySeen: store.isReadySeen,
    ingestChildState,
    publish,
    sync,

    // Env passed to the managed app process so its dev-only routes can find the
    // status file, the diagnostic sink, and the per-run token.
    childEnv() {
      if (!enabled) return {}
      return {
        OM_DEV_RUNTIME_TOKEN: token,
        OM_DEV_RUNTIME_STATUS_FILE: statusFilePath,
        OM_DEV_RUNTIME_DIAGNOSTICS_FILE: diagnosticsFilePath,
        OM_DEV_RUNTIME_ACTIONS_FILE: actionsFilePath,
        OM_DEV_RUNTIME_LOGS_FILE: logsFilePath,
        OM_DEV_RUNTIME_DIAGNOSTICS: '1',
        OM_DEV_RUNTIME_BANNER: config.bannerEnabled === false ? '0' : '1',
      }
    },

    recordSignal(signal) {
      if (!enabled) return store.getStatus()
      store.recordSignal({ generation: store.getGeneration(), ...signal })
      return publish()
    },

    beginGeneration(reason) {
      if (!enabled) return 0
      lastIngestedChildSignalSeq = 0
      probe.reset()
      sink.clear()
      actionSink.clear()
      const generation = store.beginGeneration(reason)
      publish()
      return generation
    },

    setUpstream(patch) {
      if (!enabled) return
      store.setUpstream(patch)
      publish()
    },

    beginRecovery(action) {
      if (!enabled) return null
      const status = store.beginRecovery(action)
      publish()
      return status
    },

    completeRecovery(exitCode, options) {
      if (!enabled) return null
      const status = store.completeRecovery(exitCode, options)
      publish()
      return status
    },

    getDiagnosticLines(cursor) {
      return store.getDiagnosticLines(cursor)
    },

    start() {
      if (!enabled || syncTimer) return
      sink.clear()
      actionSink.clear()
      publish()
      syncTimer = setInterval(sync, SYNC_INTERVAL_MS)
      syncTimer.unref?.()
      probe.start()
    },

    stop() {
      if (syncTimer) {
        clearInterval(syncTimer)
        syncTimer = null
      }
      probe.stop()
      if (!enabled) return
      try {
        fs.rmSync(statusFilePath, { force: true })
        fs.rmSync(logsFilePath, { force: true })
      } catch {
        logger?.debug?.('[dev-runtime] Unable to remove the runtime status file during shutdown.')
      }
      sink.clear()
      actionSink.clear()
    },
  }
}
