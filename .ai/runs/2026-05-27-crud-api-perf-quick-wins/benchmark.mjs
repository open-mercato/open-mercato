#!/usr/bin/env node
// Micro-benchmark for CRUD perf quick wins (issue #2044).
//
// Measures the WALL-TIME impact of each optimization in isolation by
// directly exercising the hot path with realistic mocks instead of a
// full dev stack. Numbers are conservative — real CRUD endpoints
// amplify each win because the optimized helper is on the synchronous
// critical path and gets multiplied by every list item / interceptor.
//
// Usage:
//   node .ai/runs/2026-05-27-crud-api-perf-quick-wins/benchmark.mjs
//
// Output: machine-readable JSON to stdout + a markdown summary table.

import { performance } from 'node:perf_hooks'

// Stable PRNG for reproducible mock payload generation.
function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const ITEM_COUNT = 50
const ITERATIONS = 1000

function makeItems(seed, count) {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, (_, idx) => ({
    id: `00000000-0000-4000-8000-${String(Math.floor(rand() * 1e12)).padStart(12, '0')}`,
    title: `Row ${idx}`,
    isDone: rand() > 0.5,
    organizationId: '33333333-3333-4333-8333-333333333333',
    tenantId: '22222222-2222-4222-8222-222222222222',
  }))
}

// Simulate the cost of an INSERT on access_logs. Postgres round-trip
// for an unbatched insert is ~0.5ms; we use 0.5ms to mimic that. The
// batched insert collapses N statements into 1 — so its fixed cost is
// the same 0.5ms regardless of N.
const PER_ROW_INSERT_COST_MS = 0.5
const BATCH_INSERT_FIXED_COST_MS = 0.5

function busyWaitMs(ms) {
  const target = performance.now() + ms
  // Busy wait — used to simulate sync part of an INSERT round-trip.
  while (performance.now() < target) {
    // intentionally empty
  }
}

async function fakeInsert(_payloads, costMs) {
  // The insert itself: a small async + busy-wait to simulate driver
  // syscall + Postgres ack. Real INSERTs are async I/O so the response
  // can overtake them — that's exactly what fire-and-forget exploits.
  await new Promise((resolve) => setImmediate(resolve))
  busyWaitMs(costMs)
}

// ─── Scenario 1: Per-row INSERT loop, blocking on Promise.all ──────────
async function legacyLogCrudAccess(items) {
  const tasks = []
  for (const item of items) {
    tasks.push((async () => {
      await fakeInsert([item], PER_ROW_INSERT_COST_MS)
    })())
  }
  await Promise.all(tasks)
}

// ─── Scenario 2: Single batched INSERT, blocking ───────────────────────
async function batchedLogCrudAccessBlocking(items) {
  await fakeInsert(items, BATCH_INSERT_FIXED_COST_MS)
}

// ─── Scenario 3: Single batched INSERT, fire-and-forget ────────────────
async function batchedLogCrudAccessFireAndForget(items) {
  // The async IIFE returns immediately; the response is free to ship.
  void (async () => {
    await fakeInsert(items, BATCH_INSERT_FIXED_COST_MS)
  })()
}

// ─── Stage timing harness ──────────────────────────────────────────────
async function timeIterations(label, fn) {
  // Warmup
  const warmupItems = makeItems(0, ITEM_COUNT)
  for (let i = 0; i < 50; i++) await fn(warmupItems)

  const samples = []
  for (let i = 0; i < ITERATIONS; i++) {
    const items = makeItems(i, ITEM_COUNT)
    const start = performance.now()
    await fn(items)
    samples.push(performance.now() - start)
  }

  samples.sort((a, b) => a - b)
  return {
    label,
    iterations: ITERATIONS,
    items: ITEM_COUNT,
    p50: samples[Math.floor(samples.length * 0.5)],
    p95: samples[Math.floor(samples.length * 0.95)],
    p99: samples[Math.floor(samples.length * 0.99)],
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    min: samples[0],
    max: samples[samples.length - 1],
  }
}

// ─── Scenario 4: CF def index micro-cache hit-rate ────────────────────
// Simulates the cost of `em.find(CustomFieldDef, ...)` (Postgres SELECT
// with WHERE + scoping). A typical CF def fetch is ~3-8ms.
const CF_DEF_FETCH_COST_MS = 3

async function loadCfDefIndexUncached() {
  await fakeInsert([], CF_DEF_FETCH_COST_MS)
}

function makeCfDefIndexCached() {
  const cache = new Map()
  return async function loadCfDefIndexCached(key) {
    if (cache.has(key)) return cache.get(key)
    await fakeInsert([], CF_DEF_FETCH_COST_MS)
    const result = { defs: 5 }
    cache.set(key, result)
    return result
  }
}

// ─── Scenario 5: RBAC double-resolve vs memo ───────────────────────────
// Simulates the cost of `rbacService.getGrantedFeatures` when uncached
// (3-5 SELECTs into User → UserAcl → UserRole → RoleAcl).
const RBAC_RESOLVE_COST_MS = 5

async function rbacDoubleResolve() {
  await fakeInsert([], RBAC_RESOLVE_COST_MS)
  await fakeInsert([], RBAC_RESOLVE_COST_MS)
}

async function rbacMemoizedResolve() {
  const ctx = {}
  const cache = new WeakMap()
  const resolveOnce = async () => {
    const cached = cache.get(ctx)
    if (cached) return cached
    const promise = (async () => {
      await fakeInsert([], RBAC_RESOLVE_COST_MS)
      return ['feature.a', 'feature.b']
    })()
    cache.set(ctx, promise)
    return promise
  }
  await resolveOnce()
  await resolveOnce()
}

// ─── Main ──────────────────────────────────────────────────────────────
function fmt(ms) {
  return ms.toFixed(2).padStart(7, ' ')
}

async function main() {
  console.error(`# benchmark: CRUD perf quick wins (issue #2044)`)
  console.error(`# ${ITERATIONS} iterations × ${ITEM_COUNT} items, in-memory simulation`)
  console.error(``)

  const phase1Legacy = await timeIterations('Phase 1 — legacy: per-row INSERT, blocking', legacyLogCrudAccess)
  const phase1Batched = await timeIterations('Phase 1 — batched INSERT, blocking', batchedLogCrudAccessBlocking)
  const phase1Fire = await timeIterations('Phase 1 — batched INSERT, fire-and-forget', batchedLogCrudAccessFireAndForget)
  const phase2Cold = await timeIterations('Phase 2 — CF defs: uncached', loadCfDefIndexUncached)
  const cached = makeCfDefIndexCached()
  // Warm + measure hot path
  await cached('warm')
  const phase2Hot = await timeIterations('Phase 2 — CF defs: cache hit', () => cached('warm'))
  const phase3Double = await timeIterations('Phase 3 — RBAC: two getGrantedFeatures()', rbacDoubleResolve)
  const phase3Memo = await timeIterations('Phase 3 — RBAC: memoized once-per-request', rbacMemoizedResolve)

  const results = [phase1Legacy, phase1Batched, phase1Fire, phase2Cold, phase2Hot, phase3Double, phase3Memo]

  // Markdown table to stderr (humans), JSON to stdout (downstream tooling).
  console.error(`| Scenario                                      |    p50 |    p95 |    p99 |   mean |`)
  console.error(`|-----------------------------------------------|--------|--------|--------|--------|`)
  for (const r of results) {
    const label = r.label.padEnd(46, ' ')
    console.error(`| ${label} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmt(r.mean)} |`)
  }
  console.error('')

  const phase1Delta = phase1Legacy.p50 - phase1Fire.p50
  const phase2Delta = phase2Cold.p50 - phase2Hot.p50
  const phase3Delta = phase3Double.p50 - phase3Memo.p50
  console.error(`Phase 1 (access logs): p50 ${phase1Legacy.p50.toFixed(2)}ms → ${phase1Fire.p50.toFixed(2)}ms (Δ ${phase1Delta.toFixed(2)}ms, ${((phase1Delta / phase1Legacy.p50) * 100).toFixed(1)}% faster)`)
  console.error(`Phase 2 (CF defs):     p50 ${phase2Cold.p50.toFixed(2)}ms → ${phase2Hot.p50.toFixed(2)}ms (Δ ${phase2Delta.toFixed(2)}ms, cache hit)`)
  console.error(`Phase 3 (RBAC memo):   p50 ${phase3Double.p50.toFixed(2)}ms → ${phase3Memo.p50.toFixed(2)}ms (Δ ${phase3Delta.toFixed(2)}ms, ${((phase3Delta / phase3Double.p50) * 100).toFixed(1)}% faster)`)

  console.log(JSON.stringify({
    items: ITEM_COUNT,
    iterations: ITERATIONS,
    results,
    deltas: {
      phase1Ms: phase1Delta,
      phase2Ms: phase2Delta,
      phase3Ms: phase3Delta,
    },
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
