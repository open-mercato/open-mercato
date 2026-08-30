import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT_COMPOSE = 'docker-compose.fullapp.yml'
const TRAEFIK_COMPOSE = 'docker-compose.fullapp.traefik.yml'
const TEMPLATE_COMPOSE = 'packages/create-app/template/docker-compose.fullapp.yml'
const ROOT_COLLECTOR_CONFIG = 'docker/otel-collector-config.yaml'
const TEMPLATE_COLLECTOR_CONFIG = 'packages/create-app/template/docker/otel-collector-config.yaml'

const TELEMETRY_ENVIRONMENT = {
  TELEMETRY_BACKEND: '${TELEMETRY_BACKEND:-}',
  TELEMETRY_SAMPLING_RATIO: '${TELEMETRY_SAMPLING_RATIO:-}',
  TELEMETRY_TRUST_INBOUND_TRACE: '${TELEMETRY_TRUST_INBOUND_TRACE:-false}',
  OTEL_EXPORTER_OTLP_ENDPOINT: '${OTEL_EXPORTER_OTLP_ENDPOINT:-}',
  OTEL_EXPORTER_OTLP_HEADERS: '${OTEL_EXPORTER_OTLP_HEADERS:-}',
  OTEL_SERVICE_NAME: '${OTEL_SERVICE_NAME:-open-mercato}',
  OTEL_RESOURCE_ATTRIBUTES: '${OTEL_RESOURCE_ATTRIBUTES:-}',
}

function read(relativePath) {
  return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8')
}

function readYaml(relativePath) {
  return parse(read(relativePath))
}

for (const relativePath of [ROOT_COMPOSE, TRAEFIK_COMPOSE, TEMPLATE_COMPOSE]) {
  test(`${relativePath} forwards the complete telemetry environment contract`, () => {
    const compose = readYaml(relativePath)
    const environment = compose.services.app.environment

    for (const [name, value] of Object.entries(TELEMETRY_ENVIRONMENT)) {
      assert.equal(environment[name], value, `${relativePath} must forward ${name} without rewriting it`)
    }
  })
}

for (const [relativePath, expectedMount] of [
  [ROOT_COMPOSE, './docker/otel-collector-config.yaml:/etc/otelcol/config.yaml:ro'],
  [TEMPLATE_COMPOSE, './docker/otel-collector-config.yaml:/etc/otelcol/config.yaml:ro'],
]) {
  test(`${relativePath} keeps the diagnostic collector private and opt-in`, () => {
    const compose = readYaml(relativePath)
    const collector = compose.services['otel-collector']

    assert.deepEqual(collector.profiles, ['telemetry'])
    assert.equal(collector.image, 'otel/opentelemetry-collector:0.159.0')
    assert.deepEqual(collector.command, ['--config=/etc/otelcol/config.yaml'])
    assert.deepEqual(collector.networks, ['mercato-network-fullapp'])
    assert.deepEqual(collector.volumes, [expectedMount])
    assert.equal(collector.ports, undefined, 'collector ports must not be published to the host')
    assert.equal(compose.services.app.depends_on?.['otel-collector'], undefined)
  })
}

test('root and create-app collector configurations are byte-identical', () => {
  assert.equal(read(ROOT_COLLECTOR_CONFIG), read(TEMPLATE_COLLECTOR_CONFIG))
})

test('collector example receives and debugs traces, metrics, and logs over OTLP/HTTP', () => {
  const collector = readYaml(ROOT_COLLECTOR_CONFIG)

  assert.equal(collector.receivers.otlp.protocols.http.endpoint, '0.0.0.0:4318')
  assert.deepEqual(collector.processors.batch, {})
  assert.equal(collector.exporters.debug.verbosity, 'basic')

  for (const signal of ['traces', 'metrics', 'logs']) {
    assert.deepEqual(collector.service.pipelines[signal], {
      receivers: ['otlp'],
      processors: ['batch'],
      exporters: ['debug'],
    })
  }
})
