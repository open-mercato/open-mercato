import fs from 'node:fs'
import path from 'node:path'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'

export const DEV_SUPERVISOR_MANIFEST_FILE = 'dev-supervisor.generated.json'
export const DEV_SUPERVISOR_MANIFEST_VERSION = 1

export type DevSupervisorWorkerDescriptor = Pick<
  ModuleWorker,
  'id' | 'moduleId' | 'queue' | 'concurrency'
>

export type DevSupervisorSchedulerStartStatus =
  | 'ok'
  | 'missing-module'
  | 'missing-cli'
  | 'missing-command'

export type DevSupervisorManifest = {
  version: typeof DEV_SUPERVISOR_MANIFEST_VERSION
  workers: DevSupervisorWorkerDescriptor[]
  schedulerStartStatus: DevSupervisorSchedulerStartStatus
}

let registeredManifest: DevSupervisorManifest | null = null

function manifestError(filePath: string, detail: string): Error {
  return new Error(
    `Invalid generated dev supervisor manifest at ${filePath}: ${detail}. ` +
      'Run `yarn generate` and retry.',
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseWorkerDescriptor(
  value: unknown,
  index: number,
  filePath: string,
): DevSupervisorWorkerDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw manifestError(filePath, `workers[${index}] must be an object`)
  }

  const worker = value as Record<string, unknown>
  if (!isNonEmptyString(worker.id)) {
    throw manifestError(filePath, `workers[${index}].id must be a non-empty string`)
  }
  if (!isNonEmptyString(worker.queue)) {
    throw manifestError(filePath, `workers[${index}].queue must be a non-empty string`)
  }
  if (typeof worker.concurrency !== 'number' || !Number.isFinite(worker.concurrency)) {
    throw manifestError(filePath, `workers[${index}].concurrency must be a finite number`)
  }
  if (worker.moduleId !== undefined && !isNonEmptyString(worker.moduleId)) {
    throw manifestError(filePath, `workers[${index}].moduleId must be a non-empty string when present`)
  }

  return {
    id: worker.id,
    ...(worker.moduleId === undefined ? {} : { moduleId: worker.moduleId }),
    queue: worker.queue,
    concurrency: worker.concurrency,
  }
}

function parseManifest(value: unknown, filePath: string): DevSupervisorManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw manifestError(filePath, 'root value must be an object')
  }

  const manifest = value as Record<string, unknown>
  if (manifest.version !== DEV_SUPERVISOR_MANIFEST_VERSION) {
    throw manifestError(
      filePath,
      `unsupported version ${String(manifest.version)} (expected ${DEV_SUPERVISOR_MANIFEST_VERSION})`,
    )
  }
  if (!Array.isArray(manifest.workers)) {
    throw manifestError(filePath, 'workers must be an array')
  }

  const schedulerStartStatus = manifest.schedulerStartStatus
  if (
    schedulerStartStatus !== 'ok' &&
    schedulerStartStatus !== 'missing-module' &&
    schedulerStartStatus !== 'missing-cli' &&
    schedulerStartStatus !== 'missing-command'
  ) {
    throw manifestError(filePath, 'schedulerStartStatus is invalid')
  }

  return {
    version: DEV_SUPERVISOR_MANIFEST_VERSION,
    workers: manifest.workers.map((worker, index) => parseWorkerDescriptor(worker, index, filePath)),
    schedulerStartStatus,
  }
}

export function loadDevSupervisorManifest(appDir: string): DevSupervisorManifest {
  const filePath = path.join(appDir, '.mercato', 'generated', DEV_SUPERVISOR_MANIFEST_FILE)
  let source: string
  try {
    source = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw manifestError(filePath, `file could not be read (${detail})`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw manifestError(filePath, `JSON could not be parsed (${detail})`)
  }

  return parseManifest(parsed, filePath)
}

export function registerDevSupervisorManifest(manifest: DevSupervisorManifest): void {
  registeredManifest = manifest
}

export function getRegisteredDevSupervisorManifest(): DevSupervisorManifest | null {
  return registeredManifest
}

export function resetDevSupervisorManifestForTests(): void {
  registeredManifest = null
}
