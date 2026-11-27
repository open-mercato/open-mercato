import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const warn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { warn: (...args: unknown[]) => warn(...args), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
  const withChild = { ...logger, child: () => withChild }
  return { createLogger: () => withChild }
})

import { collectArtifacts } from '../lib/runtime/artifactCollector'
import {
  ARTIFACT_CAPTURE_SPAN_NAME,
  readArtifactCaptureFailure,
  summarizeArtifactCaptureFailures,
} from '../lib/trace/artifactCaptureStatus'
import { AgentSpan } from '../data/entities'
import { createTestArtifactEncryption, passThroughArtifactEncryption } from './support/artifactEncryption'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const SECRET_NAMES = ['salary-report-jane.csv', 'board-minutes.pdf']

type CreatedSpan = Record<string, unknown>

function makeEm(existing: CreatedSpan[] = []) {
  const created: CreatedSpan[] = []
  const em = {
    fork: () => em,
    count: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
      [...existing, ...created].filter((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      ).length,
    ),
    create: jest.fn((entity: unknown, data: CreatedSpan) => {
      expect(entity).toBe(AgentSpan)
      return data
    }),
    persist: jest.fn((row: CreatedSpan) => {
      created.push(row)
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em, created }
}

function makeStorage() {
  let seq = 0
  return {
    _resolveService: async () => ({
      upload: async () => ({ key: `k-${++seq}` }),
      download: async () => ({ buffer: Buffer.alloc(0) }),
    }),
  }
}

function makeContainer(registrations: Record<string, unknown>) {
  return {
    hasRegistration: (name: string) => name in registrations,
    resolve<T = unknown>(name: string): T {
      if (!(name in registrations)) throw new Error(`[internal] unregistered ${name}`)
      return registrations[name] as T
    },
  }
}

function makeCommandBus() {
  const execute = jest.fn(async (_id: string, { input }: { input: { artifacts: unknown[] } }) => ({
    result: { artifactIds: input.artifacts.map((_row, index) => `a-${index}`) },
  }))
  return { bus: { execute } as unknown as CommandBus, execute }
}

async function run(registrations: Record<string, unknown>) {
  const { bus, execute } = makeCommandBus()
  const result = await collectArtifacts({
    commandBus: bus,
    commandCtx: { container: makeContainer(registrations) } as unknown as CommandRuntimeContext,
    outDir,
    runId: RUN_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  })
  return { result, execute }
}

let outDir: string

beforeEach(async () => {
  warn.mockReset()
  outDir = await mkdtemp(path.join(os.tmpdir(), 'om-artifact-collector-'))
  for (const name of SECRET_NAMES) await writeFile(path.join(outDir, name), 'confidential', 'utf8')
})

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('collectArtifacts — not-stored files', () => {
  it('reports encryption_unavailable, records count + reason on the run trace, and logs no file names', async () => {
    const { em, created } = makeEm()

    const { result, execute } = await run({
      em,
      storageService: makeStorage(),
      tenantEncryptionService: passThroughArtifactEncryption,
    })

    expect(result.capturedCount).toBe(0)
    expect(result.failure).toEqual({ count: 2, reason: 'encryption_unavailable' })
    expect(execute).not.toHaveBeenCalled()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      agentRunId: RUN_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      name: ARTIFACT_CAPTURE_SPAN_NAME,
      kind: 'system',
    })
    expect(readArtifactCaptureFailure(created[0] as { name: string; attributes: unknown })).toEqual({
      count: 2,
      reason: 'encryption_unavailable',
    })
    expect(JSON.stringify(created[0])).not.toMatch(/salary|board-minutes/)

    expect(warn).toHaveBeenCalledWith('agent artifact capture did not store files', {
      runId: RUN_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      count: 2,
      reason: 'encryption_unavailable',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/salary|board-minutes|confidential/)
  })

  it('reports storage_unavailable when storage is not configured', async () => {
    const { em, created } = makeEm()
    const encryption = createTestArtifactEncryption()

    const { result } = await run({ em, tenantEncryptionService: encryption.service })

    expect(result.failure).toEqual({ count: 2, reason: 'storage_unavailable' })
    expect(readArtifactCaptureFailure(created[0] as { name: string; attributes: unknown })).toEqual({
      count: 2,
      reason: 'storage_unavailable',
    })
  })

  it('records nothing when every file is stored', async () => {
    const { em, created } = makeEm()
    const encryption = createTestArtifactEncryption()

    const { result, execute } = await run({
      em,
      storageService: makeStorage(),
      tenantEncryptionService: encryption.service,
    })

    expect(result.failure).toBeNull()
    expect(result.capturedCount).toBe(2)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(0)
  })

  it('does not write a second record for the same run', async () => {
    const { em, created } = makeEm([
      {
        agentRunId: RUN_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        externalSpanId: `${RUN_ID}:artifact.capture`,
      },
    ])

    await run({ em, storageService: makeStorage(), tenantEncryptionService: passThroughArtifactEncryption })

    expect(created).toHaveLength(0)
  })

  it('never throws when recording the failure fails', async () => {
    const { em } = makeEm()
    em.flush.mockRejectedValueOnce(new Error('[internal] db down'))

    const { result } = await run({
      em,
      storageService: makeStorage(),
      tenantEncryptionService: passThroughArtifactEncryption,
    })

    expect(result.failure).toEqual({ count: 2, reason: 'encryption_unavailable' })
  })
})

describe('artifactCaptureStatus helpers', () => {
  it('prefers encryption_unavailable when reasons are mixed', () => {
    expect(summarizeArtifactCaptureFailures(['storage_unavailable', 'encryption_unavailable'])).toEqual({
      count: 2,
      reason: 'encryption_unavailable',
    })
    expect(summarizeArtifactCaptureFailures([])).toBeNull()
  })

  it('ignores spans with another name or malformed attributes', () => {
    expect(readArtifactCaptureFailure({ name: 'run.manifest', attributes: {} })).toBeNull()
    expect(
      readArtifactCaptureFailure({ name: ARTIFACT_CAPTURE_SPAN_NAME, attributes: { 'om.artifact_capture.reason': 'x' } }),
    ).toBeNull()
    expect(readArtifactCaptureFailure(null)).toBeNull()
  })
})
