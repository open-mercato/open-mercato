import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { startDashboardServer } from '../server.mjs'
import { parseArgs, extractFoundations } from '../cli.mjs'
import { loadExperiment, loadCaseDetail } from '../adapters.mjs'

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'experiment-dashboard-test-'))
  try { return await run(root) } finally { await fs.rm(root, { recursive: true, force: true }) }
}
async function write(root, file, data) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await fs.writeFile(path.join(root, file), JSON.stringify(data))
}
function snapshot(overrides = {}) {
  return {
    schemaVersion: 1, id: 'producer:arbitrary', name: 'Fixture evaluation', status: 'running',
    updatedAt: new Date().toISOString(), metadata: { model: 'local/model', runner: 'custom' },
    lanes: [{ id: 'quality/品質', label: 'Quality', total: 3 }, { id: 'latency', label: 'Latency' }],
    cases: [
      { id: 'case/α', title: 'A hostile-looking but inert case', lanes: { 'quality/品質': { status: 'pass', attempts: 1 }, latency: { status: 'skipped' } } },
      { id: 'second:case', title: 'Still running', lanes: { 'quality/品質': { status: 'running' }, latency: { status: 'not-applicable' } } },
    ],
    active: [{ caseId: 'second:case', laneId: 'quality/品質', phase: 'generating' }], ...overrides,
  }
}

test('generic experiments derive dynamic lane counts and preserve arbitrary identifiers', () => fixture(async root => {
  await write(root, 'experiment.json', snapshot())
  const run = await loadExperiment(root)
  assert.equal(run.producerId, 'producer:arbitrary')
  assert.equal(run.metadata.model, 'local/model')
  assert.equal(run.cases[0].id, 'case/α')
  const quality = run.lanes.find(lane => lane.id === 'quality/品質')
  assert.equal(quality.counts.pass, 1)
  assert.equal(quality.counts.running, 1)
  assert.equal(quality.total, 3)
  assert.equal(quality.observedTotal, 2)
  assert.equal(quality.completed, 1)
  assert.equal(quality.totalSource, 'declared')
  assert.equal(run.lanes.find(lane => lane.id === 'latency').observedTotal, 1)
  assert.equal(run.active[0].phase, 'generating')
}))

test('generic case artifacts retain visible responses, source text, and evaluator diagnostics', () => fixture(async root => {
  const run = snapshot()
  run.cases[0].prompt = 'Write a function'
  run.cases[0].lanes['quality/品質'] = { status: 'fail', artifactIds: ['output-one'], diagnostics: ['Typecheck failed'] }
  await write(root, 'experiment.json', run)
  await write(root, 'artifacts/output-one.json', { schemaVersion: 1, responses: [{ text: 'Here is my implementation.' }], files: [{ path: 'src/example.ts', content: '<script>must remain inert</script>' }], tools: [{ name: 'write', path: 'src/example.ts', isError: false }] })
  const detail = await loadCaseDetail(root, 'case/α', 'quality/品質')
  assert.equal(detail.prompt, 'Write a function')
  assert.equal(detail.responses[0].text, 'Here is my implementation.')
  assert.equal(detail.files[0].content, '<script>must remain inert</script>')
  assert.equal(detail.tools[0].name, 'write')
  assert.deepEqual(detail.outcome.diagnostics, ['Typecheck failed'])
}))

test('inline producer artifacts work without artifact files', () => fixture(async root => {
  const run = snapshot()
  run.cases[0].lanes['quality/品質'].responses = [{ text: 'Visible answer' }]
  run.cases[0].lanes['quality/品質'].files = [{ path: 'output.txt', content: 'hello' }]
  await write(root, 'experiment.json', run)
  const detail = await loadCaseDetail(root, 'case/α', 'quality/品質')
  assert.equal(detail.responses[0].text, 'Visible answer')
  assert.equal(detail.files[0].content, 'hello')
}))

test('legacy summaries and supplemental artifacts are observed without reading writable targets', () => fixture(async root => {
  await write(root, 'summary.json', { model: 'different-model', status: 'running', cases: { 'trial:7': { id: 'trial:7', title: 'Trial', family: 'module', routing: { status: 'pass', attempts: 2, corrections: 1 }, coding: { status: 'fail', writable: { changedPaths: ['/outside/secret.ts'] }, evidence: 'evidence/coding-trial7.json' } } } })
  await write(root, 'evidence/coding-trial7.json', { selectedRouter: ['module-data'], selectedSkills: [], selectedContext: [], decisions: [], status: 'fail' })
  await write(root, 'generated-files/stored.json', { caseId: 'trial:7', lane: 'coding', files: [{ path: 'src/local.ts', content: 'export const answer = 7' }] })
  const run = await loadExperiment(root)
  assert.equal(run.metadata.model, 'different-model')
  assert.equal(run.lanes.find(lane => lane.id === 'coding').total, 1)
  const detail = await loadCaseDetail(root, 'trial:7', 'coding')
  assert.equal(detail.files[0].path, 'src/local.ts')
  assert.equal(detail.responses.length, 0)
  assert.match(detail.responseNote, /not retained|unavailable/i)
  assert.deepEqual(detail.structuredResponse.selectedRouter, ['module-data'])
}))

test('official result directories expose recorded evidence without inventing process liveness', () => fixture(async root => {
  await write(root, 'one-result.json', { schemaVersion: 1, caseId: 'OMH-017', evaluationKind: 'routing', runner: 'codex', model: 'model-x', status: 'error', violations: ['provider unavailable'], durationMs: 30, actualContext: { paths: ['AGENTS.md'] } })
  const run = await loadExperiment(root)
  assert.equal(run.source, 'harness-results')
  assert.equal(run.status, 'unknown')
  assert.deepEqual(run.active, [])
  assert.equal(run.cases[0].lanes.routing.status, 'error')
  const detail = await loadCaseDetail(root, 'OMH-017', 'routing')
  assert.equal(detail.evidence.model, 'model-x')
  assert.equal(detail.responses.length, 0)
  assert.equal(detail.files.length, 0)
}))

test('malformed or oversized snapshots are explicit errors, not empty successful experiments', () => fixture(async root => {
  await fs.writeFile(path.join(root, 'experiment.json'), '{')
  assert.equal((await loadExperiment(root)).status, 'error')
  await fs.writeFile(path.join(root, 'experiment.json'), ' '.repeat(5 * 1024 * 1024))
  assert.equal((await loadExperiment(root)).status, 'error')
}))

test('artifact traversal, credential filenames, symlinks and oversized source never disclose bytes', () => fixture(async root => {
  const run = snapshot()
  run.cases[0].lanes['quality/品質'].artifactIds = ['../private', 'credentials', 'linked', 'large']
  await write(root, 'experiment.json', run)
  await write(root, 'private.json', { responses: [{ text: 'PRIVATE_SENTINEL' }] })
  await write(root, 'artifacts/credentials.json', { responses: [{ text: 'CREDENTIAL_SENTINEL' }] })
  await fs.symlink(path.join(root, 'private.json'), path.join(root, 'artifacts/linked.json'))
  await fs.writeFile(path.join(root, 'artifacts/large.json'), ' '.repeat(5 * 1024 * 1024))
  const detail = await loadCaseDetail(root, 'case/α', 'quality/品質')
  assert.equal(detail.responses.length, 0)
  assert.equal(detail.files.length, 0)
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_SENTINEL|CREDENTIAL_SENTINEL/)
  assert.ok(detail.notices.length > 0)
}))

test('symlinked snapshots are rejected', () => fixture(async root => {
  await write(root, 'other.json', snapshot())
  await fs.symlink(path.join(root, 'other.json'), path.join(root, 'experiment.json'))
  const run = await loadExperiment(root)
  assert.equal(run.status, 'error')
}))

test('duplicate case/lane identities and unknown statuses are rejected', () => fixture(async root => {
  const run = snapshot()
  run.cases.push(run.cases[0])
  await write(root, 'experiment.json', run)
  assert.equal((await loadExperiment(root)).status, 'error')
  await write(root, 'experiment.json', snapshot({ lanes: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] }))
  assert.equal((await loadExperiment(root)).status, 'error')
}))

test('HTTP APIs observe multiple registered experiments and atomic producer updates', () => fixture(async root => {
  const first = path.join(root, 'first'), second = path.join(root, 'second'), assets = path.join(root, 'assets')
  await write(first, 'experiment.json', snapshot())
  await write(second, 'experiment.json', snapshot({ name: 'Other model', metadata: { model: 'model-b' } }))
  await fs.mkdir(assets)
  await fs.writeFile(path.join(assets, 'index.html'), '<h1>Dashboard</h1>')
  await fs.writeFile(path.join(assets, 'app.js'), 'console.log("dashboard")')
  const server = await startDashboardServer({ experiments: [first, second], port: 0, assetsDir: assets })
  try {
    const listing = await (await fetch(server.url + 'api/experiments')).json()
    assert.equal(listing.experiments.length, 2)
    assert.notEqual(listing.experiments[0].id, listing.experiments[1].id)
    const id = listing.experiments[0].id
    const detailUrl = server.url + 'api/experiments/' + encodeURIComponent(id)
    assert.equal((await (await fetch(detailUrl)).json()).cases[0].lanes['quality/品質'].status, 'pass')
    const newer = snapshot()
    newer.cases[0].lanes['quality/品質'].status = 'fail'
    await write(first, 'experiment.next.json', newer)
    await fs.rename(path.join(first, 'experiment.next.json'), path.join(first, 'experiment.json'))
    assert.equal((await (await fetch(detailUrl)).json()).cases[0].lanes['quality/品質'].status, 'fail')
    const caseResponse = await fetch(detailUrl + '/cases/' + encodeURIComponent('case/α') + '?lane=' + encodeURIComponent('quality/品質'))
    assert.equal(caseResponse.status, 200)
    assert.equal((await caseResponse.json()).caseId, 'case/α')
    await fs.writeFile(path.join(first, 'experiment.json'), '{')
    const partial = await (await fetch(server.url + 'api/experiments')).json()
    assert.equal(partial.experiments[0].status, 'error')
    assert.equal(partial.experiments[1].name, 'Other model')
  } finally { await server.close() }
}))

test('loopback server rejects unregistered paths, hostile origins/hosts and write methods', () => fixture(async root => {
  await write(root, 'experiment.json', snapshot())
  const assets = path.join(root, 'assets')
  await fs.mkdir(assets)
  await fs.writeFile(path.join(assets, 'index.html'), '<h1>Dashboard</h1>')
  await fs.writeFile(path.join(assets, 'secrets.txt'), 'NOT_PUBLIC')
  const server = await startDashboardServer({ experiments: [root], port: 0, assetsDir: assets })
  try {
    assert.equal((await fetch(server.url)).status, 200)
    assert.equal((await fetch(server.url + 'api/experiments', { headers: { Origin: 'https://evil.invalid' } })).status, 403)
    assert.equal(await new Promise((resolve, reject) => { const request = http.get(server.url + 'api/experiments', { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode) }); request.on('error', reject) }), 403)
    assert.equal((await fetch(server.url + 'api/experiments', { method: 'POST' })).status, 405)
    assert.equal((await fetch(server.url + 'secrets.txt')).status, 404)
    assert.equal((await fetch(server.url + 'api/experiments/not-registered')).status, 404)
    assert.equal((await fetch(server.url + '%2e%2e%2fexperiment.json')).status, 404)
    const crossSite = headers => new Promise((resolve, reject) => { const request = http.get(server.url, { headers }, response => { response.resume(); resolve(response.statusCode) }); request.on('error', reject) })
    assert.equal(await crossSite({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }), 200)
    assert.equal(await crossSite({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'script' }), 403)
    assert.equal(await crossSite({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', Origin: 'https://evil.invalid' }), 403)
    const response = await fetch(server.url)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(response.headers.get('content-security-policy'), /object-src 'none'/)
  } finally { await server.close() }
}))


test('producer token metrics retain their actual scope and do not estimate missing throughput', () => fixture(async root => {
  const run = snapshot()
  await write(root, 'experiment.json', run)
  assert.deepEqual((await loadExperiment(root)).metrics, { availability: 'not-reported' })
  run.metrics = { inputTokens: 100, outputTokens: 50, generationSeconds: 2, sampledAt: new Date().toISOString(), measurementKind: 'completed-response' }
  run.active[0].metrics = { tokensPerSecond: 24.5, outputTokens: 49, windowSeconds: 2, measurementKind: 'live' }
  await write(root, 'experiment.json', run)
  const loaded = await loadExperiment(root)
  assert.equal(loaded.metrics.outputTokensPerSecond, 25)
  assert.equal(loaded.metrics.rateSource, 'counter-generation-time')
  assert.equal(loaded.metrics.measurementKind, 'completed-response')
  assert.equal(loaded.active[0].metrics.tokensPerSecond, 24.5)
  assert.equal(loaded.active[0].metrics.measurementKind, 'live')
  run.metrics = { outputTokens: 0 }
  await write(root, 'experiment.json', run)
  assert.equal((await loadExperiment(root)).metrics.outputTokensPerSecond, undefined)
  run.metrics = { tokensPerSecond: -1 }
  await write(root, 'experiment.json', run)
  assert.equal((await loadExperiment(root)).status, 'error')
  run.metrics = { tokensPerSecond: null }
  await write(root, 'experiment.json', run)
  assert.equal((await loadExperiment(root)).status, 'error')
}))


test('legacy metrics companions update independently and stale completed-response samples stay labelled', () => fixture(async root => {
  await write(root, 'summary.json', { status: 'running', cases: { one: { title: 'Case', check: { status: 'running' } } } })
  await write(root, 'metrics.json', { metrics: { outputTokens: 30, generationSeconds: 2, measurementKind: 'completed-response', rateSource: 'output-counter/response-duration', sampledAt: '2020-01-01T00:00:00Z' } })
  const first = await loadExperiment(root)
  assert.equal(first.metrics.outputTokensPerSecond, 15)
  assert.equal(first.metrics.measurementKind, 'completed-response')
  assert.equal(first.metrics.rateSource, 'output-counter/response-duration')
  assert.equal(first.metrics.stale, true)
  await write(root, 'metrics.json', { metrics: { tokensPerSecond: 21, measurementKind: 'live' }, updatedAt: new Date().toISOString() })
  assert.equal((await loadExperiment(root)).metrics.tokensPerSecond, 21)
  await write(root, 'metrics.json', { metrics: { outputTokens: 0, generationSeconds: 3, measurementKind: 'live' } })
  assert.equal((await loadExperiment(root)).metrics.outputTokensPerSecond, undefined)
}))

test('symlinked registered roots and hardlinked artifacts are not exposed', () => fixture(async root => {
  const real = path.join(root, 'real'), link = path.join(root, 'link')
  await write(real, 'experiment.json', snapshot())
  await fs.symlink(real, link)
  assert.equal((await loadExperiment(link)).status, 'error')
  const run = snapshot()
  run.cases[0].lanes['quality/品質'].artifactIds = ['hardlink']
  await write(real, 'experiment.json', run)
  await write(root, 'secret.json', { responses: [{ text: 'HARDLINK_SECRET' }] })
  await fs.mkdir(path.join(real, 'artifacts'))
  await fs.link(path.join(root, 'secret.json'), path.join(real, 'artifacts/hardlink.json'))
  assert.doesNotMatch(JSON.stringify(await loadCaseDetail(real, 'case/α', 'quality/品質')), /HARDLINK_SECRET/)
}))


test('CLI requires explicit registrations and emits only authoritative foundation blocks', () => {
  assert.throws(() => parseArgs([]), /explicit/)
  assert.throws(() => parseArgs(['--experiment', '.', '--host', '0.0.0.0']), /Use --experiment/)
  assert.throws(() => parseArgs(['--experiment', '.', '--port', '65536']), /port/)
  assert.equal(parseArgs(['--experiment', '.', '--experiment', '..', '--port', '0']).experiments.length, 2)
  const tokens = extractFoundations('@import "do-not-copy.css";\n:root { --background: white; }\n.dark { --background: black; }\n.secret { color: red; }')
  assert.match(tokens, /:root/)
  assert.match(tokens, /\.dark/)
  assert.doesNotMatch(tokens, /do-not-copy|secret/)
  assert.throws(() => extractFoundations(':root { --broken: true;'), /Unterminated/)
})
