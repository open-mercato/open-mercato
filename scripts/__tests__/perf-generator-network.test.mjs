import test from 'node:test'
import assert from 'node:assert/strict'
import { generatorCompose, resolveGeneratorNetwork } from '../../perf/scripts/commands/generator.mjs'
import { networkAssessment } from '../../perf/scripts/report.mjs'

test('generator network defaults keep the existing behaviour', () => {
  assert.equal(resolveGeneratorNetwork({ K6_NETWORK: 'mercato-network-perf-v2' }), 'sut')
  assert.equal(resolveGeneratorNetwork({}), 'host')
})

test('laptop mode selects the laptop overlay', () => {
  const args = generatorCompose({ GENERATOR_NETWORK: 'laptop' })
  assert.ok(args.includes('perf/generator/compose.generator.laptop.yml'))
  assert.ok(!args.includes('perf/generator/compose.generator.vps.yml'))
})

test('unknown generator network is rejected', () => {
  assert.throws(() => resolveGeneratorNetwork({ GENERATOR_NETWORK: 'wifi' }), /GENERATOR_NETWORK/)
})

test('network assessment flags remote and noisy generators', () => {
  assert.deepEqual(networkAssessment({ rtt: { p50: 4, p95: 7, failures: 0 } }), { remote: false, noisy: false, reasons: [] })
  const remote = networkAssessment({ rtt: { p50: 25, p95: 40, failures: 0 }, rttAfter: { p50: 26, p95: 45, failures: 0 } })
  assert.equal(remote.remote, true)
  assert.equal(remote.noisy, false)
  const noisy = networkAssessment({ rtt: { p50: 25, p95: 40, failures: 0 }, rttAfter: { p50: 60, p95: 120, failures: 2 } })
  assert.equal(noisy.noisy, true)
  assert.equal(noisy.reasons.length, 3)
})
