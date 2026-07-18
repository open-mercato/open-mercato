import path from 'node:path'

import { readEnvValue } from './env-file.mjs'

// Single source of truth for the local stack topology. Every consumer (steps,
// doctor, status, supervision) resolves ports through here so a port override
// in the root .env is honored everywhere at once.

export const DEFAULT_PORTS = {
  app: 3000,
  mcp: 3001,
  splash: 4000,
  opencode: 4096,
  localstack: 4566,
  verdaccio: 4873,
  postgres: 5432,
  redis: 6379,
  meilisearch: 7700,
  keycloak: 8080,
}

const PORT_ENV_KEYS = {
  app: 'APP_PORT',
  mcp: 'MCP_PORT',
  splash: 'OM_DEV_SPLASH_PORT',
  opencode: 'OPENCODE_PORT',
  localstack: 'LOCALSTACK_PORT',
  verdaccio: 'VERDACCIO_PORT',
  postgres: 'POSTGRES_PORT',
  redis: 'REDIS_PORT',
  meilisearch: 'MEILISEARCH_PORT',
  keycloak: 'KEYCLOAK_PORT',
}

export function resolveStackPorts(repoRoot, env = process.env) {
  const rootEnvPath = path.join(repoRoot, '.env')
  const ports = {}
  for (const [service, fallback] of Object.entries(DEFAULT_PORTS)) {
    const key = PORT_ENV_KEYS[service]
    const raw = env[key] ?? readEnvValue(rootEnvPath, key) ?? ''
    const parsed = Number.parseInt(String(raw).trim(), 10)
    ports[service] = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback
  }
  return ports
}

// Host-side probes deliberately use 127.0.0.1, never `localhost`: on modern
// Windows (and some macOS setups) `localhost` resolves to ::1 first while the
// services listen on IPv4, which turns every health probe into a coin flip.
export const LOOPBACK_HOST = '127.0.0.1'

export function stackUrls(ports) {
  return {
    app: `http://${LOOPBACK_HOST}:${ports.app}`,
    appLogin: `http://${LOOPBACK_HOST}:${ports.app}/backend/login`,
    splash: `http://${LOOPBACK_HOST}:${ports.splash}`,
    mcpHealth: `http://${LOOPBACK_HOST}:${ports.mcp}/health`,
    mcp: `http://${LOOPBACK_HOST}:${ports.mcp}/mcp`,
    opencodeHealth: `http://${LOOPBACK_HOST}:${ports.opencode}/global/health`,
    opencodeMcpStatus: `http://${LOOPBACK_HOST}:${ports.opencode}/mcp`,
  }
}

// TLS-interception probe targets: one per critical egress class (yarn
// registry, git hosting, container registry). Probing several hosts matters —
// interception proxies keep per-host bypass lists, so a single clean probe
// proves nothing.
export const TLS_PROBE_HOSTS = ['registry.yarnpkg.com', 'github.com', 'registry-1.docker.io']

export const STARTER_STATE_DIR = path.join('.mercato', 'starter')
export const RUN_STATE_DIR = path.join('.mercato', 'run')
export const CAPTURED_CA_BUNDLE = path.join('.mercato', 'certs', 'corporate-ca.pem')
export const DOCKER_CERTS_DIR = path.join('docker', 'certs')
export const OPENCODE_CERTS_DIR = path.join('docker', 'opencode', 'certs')
export const DEV_LOG_DIR = path.join('.mercato', 'logs')

export const FULLAPP_DEV_COMPOSE_FILE = path.join('starters', 'docker', 'compose.fullapp.dev.yml')
