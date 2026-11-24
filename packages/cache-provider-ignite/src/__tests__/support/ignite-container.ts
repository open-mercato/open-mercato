import path from 'node:path'
import type { StartedTestContainer } from 'testcontainers'

export const IGNITE_IMAGE = process.env.OM_IGNITE_IMAGE ?? 'apacheignite/ignite:2.17.0-arm64'
export const IGNITE_THIN_CLIENT_PORT = 10800
export const PACKAGE_DIR = path.resolve(__dirname, '../../..')
export const DOCKER_DIR = path.join(PACKAGE_DIR, 'docker')

export const containerTestsEnabled = process.env.OM_CACHE_PROVIDER_CONTAINER_TESTS === '1'

export type IgniteContainerOptions = {
  configFile?: string
  maxTtlSeconds?: number
  regionMb?: number
  extraFiles?: Array<{ source: string; target: string }>
  env?: Record<string, string>
  readyPattern?: RegExp
}

export type StartedIgnite = {
  container: StartedTestContainer
  endpoint: string
  host: string
  port: number
}

export async function startIgnite(options: IgniteContainerOptions = {}): Promise<StartedIgnite> {
  const { GenericContainer, Wait } = await import('testcontainers')
  const configFile = options.configFile ?? 'ignite-config.xml'
  const container = await new GenericContainer(IGNITE_IMAGE)
    .withExposedPorts(IGNITE_THIN_CLIENT_PORT)
    .withEnvironment({
      JVM_OPTS: '-Xms256m -Xmx512m -XX:MaxMetaspaceSize=256m',
      CONFIG_URI: `/opt/om/${configFile}`,
      OM_IGNITE_MAX_TTL_SECONDS: String(options.maxTtlSeconds ?? 86_400),
      OM_IGNITE_REGION_MB: String(options.regionMb ?? 128),
      ...(options.env ?? {}),
    })
    .withCopyFilesToContainer([
      { source: path.join(DOCKER_DIR, configFile), target: `/opt/om/${configFile}` },
      ...(options.extraFiles ?? []),
    ])
    .withWaitStrategy(Wait.forLogMessage(options.readyPattern ?? /Topology snapshot \[ver=1, .*state=ACTIVE/))
    .withStartupTimeout(180_000)
    .start()
  const host = container.getHost()
  const port = container.getMappedPort(IGNITE_THIN_CLIENT_PORT)
  return { container, host, port, endpoint: `${host === 'localhost' ? '127.0.0.1' : host}:${port}` }
}
