import {
  clearModuleResourceUsageData,
  getModuleResourceUsageReport,
  resetModuleResourceUsage,
  withModuleResourceUsage,
} from '../resource-usage'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('module resource usage tracker', () => {
  const previousEnv = process.env.OM_MODULE_RESOURCE_USAGE
  const previousCpuThreshold = process.env.OM_MODULE_RESOURCE_HEAVY_CPU_MS
  const previousSnapshotEnv = process.env.OM_MODULE_RESOURCE_USAGE_SNAPSHOT
  const previousSnapshotDir = process.env.OM_MODULE_RESOURCE_USAGE_DIR
  let tempDir: string | null = null

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-module-usage-'))
    process.env.OM_MODULE_RESOURCE_USAGE_DIR = tempDir
    process.env.OM_MODULE_RESOURCE_USAGE_SNAPSHOT = 'off'
    resetModuleResourceUsage()
    delete process.env.OM_MODULE_RESOURCE_USAGE
    delete process.env.OM_MODULE_RESOURCE_HEAVY_CPU_MS
  })

  afterEach(() => {
    resetModuleResourceUsage()
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
    if (previousEnv === undefined) delete process.env.OM_MODULE_RESOURCE_USAGE
    else process.env.OM_MODULE_RESOURCE_USAGE = previousEnv
    if (previousCpuThreshold === undefined) delete process.env.OM_MODULE_RESOURCE_HEAVY_CPU_MS
    else process.env.OM_MODULE_RESOURCE_HEAVY_CPU_MS = previousCpuThreshold
    if (previousSnapshotEnv === undefined) delete process.env.OM_MODULE_RESOURCE_USAGE_SNAPSHOT
    else process.env.OM_MODULE_RESOURCE_USAGE_SNAPSHOT = previousSnapshotEnv
    if (previousSnapshotDir === undefined) delete process.env.OM_MODULE_RESOURCE_USAGE_DIR
    else process.env.OM_MODULE_RESOURCE_USAGE_DIR = previousSnapshotDir
  })

  it('aggregates successful module operations', async () => {
    await withModuleResourceUsage(
      { moduleId: 'customers', surface: 'api', operation: 'GET /api/customers/people' },
      async () => 'ok',
    )

    const report = getModuleResourceUsageReport()

    expect(report.enabled).toBe(true)
    expect(report.totals.calls).toBe(1)
    expect(report.modules).toHaveLength(1)
    expect(report.modules[0].moduleId).toBe('customers')
    expect(report.modules[0].calls).toBe(1)
    expect(report.modules[0].surfaces[0].surface).toBe('api')
    expect(report.modules[0].topOperations[0].operation).toBe('GET /api/customers/people')
    expect(report.bucketIntervalMs).toBe(5 * 60 * 1000)
    expect(report.buckets).toHaveLength(1)
    expect(new Date(report.buckets[0].bucketStart).getUTCMinutes() % 5).toBe(0)
    expect(report.buckets[0].bucketIntervalMs).toBe(5 * 60 * 1000)
    expect(report.buckets[0].stage).toBe('startup')
    expect(report.buckets[0].totals.calls).toBe(1)
    expect(report.buckets[0].modules[0].moduleId).toBe('customers')
    expect(report.buckets[0].modules[0].calls).toBe(1)
    expect(report.buckets[0].modules[0].surfaces[0].surface).toBe('api')
    expect(report.buckets[0].modules[0].topOperations[0].operation).toBe('GET /api/customers/people')
  })

  it('marks overlapping calls concurrentCalls-tainted, but not a call that runs alone', async () => {
    let releaseA: (() => void) | null = null
    const blockedA = new Promise<void>((resolve) => { releaseA = resolve })

    const callA = withModuleResourceUsage(
      { moduleId: 'customers', surface: 'api', operation: 'GET /api/customers/people' },
      async () => {
        await blockedA
      },
    )
    // Give callA's promise chain a tick to register itself as in-flight before callB starts.
    await Promise.resolve()

    await withModuleResourceUsage(
      { moduleId: 'catalog', surface: 'api', operation: 'GET /api/catalog/products' },
      async () => undefined,
    )

    releaseA!()
    await callA

    await withModuleResourceUsage(
      { moduleId: 'sales', surface: 'api', operation: 'GET /api/sales/orders' },
      async () => undefined,
    )

    const report = getModuleResourceUsageReport()
    const byModule = new Map(report.modules.map((module) => [module.moduleId, module]))

    // customers and catalog overlapped in wall-clock time, so both are tainted.
    expect(byModule.get('customers')?.topOperations[0].concurrentCalls).toBe(1)
    expect(byModule.get('catalog')?.topOperations[0].concurrentCalls).toBe(1)
    // sales ran entirely after both finished, so it's untainted.
    expect(byModule.get('sales')?.topOperations[0].concurrentCalls).toBe(0)
  })

  it('records errors and rethrows the original failure', async () => {
    await expect(
      withModuleResourceUsage(
        { moduleId: 'sales', surface: 'worker', operation: 'sales:workers:sync' },
        async () => {
          throw new Error('boom')
        },
      ),
    ).rejects.toThrow('boom')

    const report = getModuleResourceUsageReport()

    expect(report.totals.calls).toBe(1)
    expect(report.totals.errors).toBe(1)
    expect(report.modules[0].moduleId).toBe('sales')
    expect(report.modules[0].errors).toBe(1)
  })

  it('does not crash when hot reload keeps legacy bucket state without operation maps', () => {
    const now = Date.now()
    const bucketStartMs = Math.floor(now / (10 * 60 * 1000)) * (10 * 60 * 1000)
    ;(globalThis as Record<string, unknown>).__openMercatoModuleResourceUsage__ = {
      startedAt: new Date(bucketStartMs).toISOString(),
      entries: new Map(),
      buckets: new Map([
        [
          String(bucketStartMs),
          {
            bucketStartMs,
            bucketEndMs: bucketStartMs + 10 * 60 * 1000,
            modules: new Map([
              [
                'customers',
                {
                  moduleId: 'customers',
                  calls: 1,
                  errors: 0,
                  totalDurationMs: 12,
                  totalCpuMs: 4,
                  positiveHeapDeltaBytes: 1024,
                  positiveRssDeltaBytes: 2048,
                  recentDurationsMs: [12],
                },
              ],
            ]),
          },
        ],
      ]),
      lastSnapshotAt: 0,
      shutdownHookRegistered: false,
    }

    const report = getModuleResourceUsageReport()

    expect(report.buckets).toHaveLength(1)
    expect(new Date(report.buckets[0].bucketStart).getUTCMinutes() % 5).toBe(0)
    expect(report.buckets[0].modules[0].moduleId).toBe('customers')
    expect(report.buckets[0].modules[0].topOperations).toEqual([])
  })

  it('infers module id from resource id when explicit module id is absent', async () => {
    await withModuleResourceUsage(
      { surface: 'subscriber', operation: 'customers.person.created -> customers:subscribers:index', resourceId: 'customers:subscribers:index' },
      async () => undefined,
    )

    const report = getModuleResourceUsageReport()

    expect(report.modules[0].moduleId).toBe('customers')
  })

  it('does not record when tracking is disabled', async () => {
    process.env.OM_MODULE_RESOURCE_USAGE = 'off'

    await withModuleResourceUsage(
      { moduleId: 'customers', surface: 'api', operation: 'GET /api/customers/people' },
      async () => undefined,
    )

    const report = getModuleResourceUsageReport()

    expect(report.enabled).toBe(false)
    expect(report.totals.calls).toBe(0)
    expect(report.modules).toEqual([])
  })

  it('marks candidates when thresholds are crossed', async () => {
    process.env.OM_MODULE_RESOURCE_HEAVY_CPU_MS = '0'

    await withModuleResourceUsage(
      { moduleId: 'catalog', surface: 'api', operation: 'GET /api/catalog/products' },
      async () => undefined,
    )

    const report = getModuleResourceUsageReport()

    expect(report.candidates.map((entry) => entry.moduleId)).toContain('catalog')
  })

  it('clears in-memory telemetry data', async () => {
    await withModuleResourceUsage(
      { moduleId: 'customers', surface: 'api', operation: 'GET /api/customers/people' },
      async () => undefined,
    )

    expect(getModuleResourceUsageReport().totals.calls).toBe(1)

    clearModuleResourceUsageData()

    expect(getModuleResourceUsageReport().totals.calls).toBe(0)
  })

  it('skips re-migrating the buckets map on getState() when the bucket interval has not changed', async () => {
    await withModuleResourceUsage(
      { moduleId: 'customers', surface: 'api', operation: 'GET /api/customers/people' },
      async () => undefined,
    )
    const stateAfterFirst = (globalThis as Record<string, unknown>).__openMercatoModuleResourceUsage__ as { buckets: Map<string, unknown> }
    const bucketsMapAfterFirstCall = stateAfterFirst.buckets

    await withModuleResourceUsage(
      { moduleId: 'customers', surface: 'api', operation: 'GET /api/customers/people' },
      async () => undefined,
    )
    const stateAfterSecond = (globalThis as Record<string, unknown>).__openMercatoModuleResourceUsage__ as { buckets: Map<string, unknown> }

    // migrateMutableTimeBuckets always builds a brand new Map, so an unchanged reference proves
    // getState() skipped the rebuild on the second call.
    expect(stateAfterSecond.buckets).toBe(bucketsMapAfterFirstCall)
  })

  it('writes the snapshot file asynchronously and merges another process\'s snapshot into the report', async () => {
    process.env.OM_MODULE_RESOURCE_USAGE_SNAPSHOT = 'on'

    await withModuleResourceUsage(
      { moduleId: 'customers', surface: 'api', operation: 'GET /api/customers/people' },
      async () => undefined,
    )

    // The flush is fire-and-forget (no fs.*Sync calls on the hot path), so wait for the async
    // write to land instead of asserting on it synchronously.
    const ownSnapshotPath = path.join(tempDir!, `process-${process.pid}.json`)
    const start = Date.now()
    while (!fs.existsSync(ownSnapshotPath)) {
      if (Date.now() - start > 2000) throw new Error('Timed out waiting for async snapshot flush')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const ownPayload = JSON.parse(fs.readFileSync(ownSnapshotPath, 'utf8'))
    expect(ownPayload.entries.some((entry: { moduleId: string }) => entry.moduleId === 'customers')).toBe(true)

    // Simulate another process's snapshot file and confirm getModuleResourceUsageReport() merges
    // it in via a single consolidated directory scan.
    const otherPid = process.pid + 1
    fs.writeFileSync(
      path.join(tempDir!, `process-${otherPid}.json`),
      JSON.stringify({
        pid: otherPid,
        generatedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        entries: [{
          moduleId: 'sales',
          surface: 'worker',
          operation: 'sales:workers:sync',
          resourceId: null,
          calls: 3,
          errors: 0,
          concurrentCalls: 0,
          totalDurationMs: 30,
          maxDurationMs: 10,
          p95DurationMs: 10,
          totalCpuUserMs: 5,
          totalCpuSystemMs: 1,
          maxCpuMs: 2,
          totalHeapDeltaBytes: 1024,
          positiveHeapDeltaBytes: 1024,
          maxHeapDeltaBytes: 512,
          totalRssDeltaBytes: 2048,
          positiveRssDeltaBytes: 2048,
          maxRssDeltaBytes: 1024,
          firstSeenAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        }],
        buckets: [],
      }),
    )

    const report = getModuleResourceUsageReport()
    expect(report.modules.map((module) => module.moduleId)).toEqual(expect.arrayContaining(['customers', 'sales']))
    expect(report.modules.find((module) => module.moduleId === 'sales')?.calls).toBe(3)
  })
})
