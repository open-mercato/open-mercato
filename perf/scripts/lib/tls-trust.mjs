import tls from 'node:tls'
import { existsSync, readFileSync } from 'node:fs'
import { statePath } from './paths.mjs'

export const CADDY_ROOT_PATH_IN_CONTAINER = '/data/caddy/pki/authorities/local/root.crt'
export const CADDY_ROOT_STATE_FILE = 'caddy-root.crt'

const PEM_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/

export function extractPemCertificate(text) {
  const match = PEM_PATTERN.exec(String(text ?? ''))
  return match ? `${match[0]}\n` : null
}

export function usesInternalCa(sutEnv) {
  const caddyfile = sutEnv?.get?.('PERF_TLS_CADDYFILE') ?? 'Caddyfile.internal'
  return caddyfile === 'Caddyfile.internal'
}

export function canTrustInProcess() {
  return typeof tls.setDefaultCACertificates === 'function' && typeof tls.getCACertificates === 'function'
}

export function trustCertificate(pem) {
  if (!canTrustInProcess()) return false
  const current = tls.getCACertificates('default')
  if (current.includes(pem)) return true
  tls.setDefaultCACertificates([...current, pem])
  return true
}

export function trustStoredCaddyRoot() {
  const path = statePath(CADDY_ROOT_STATE_FILE)
  if (!existsSync(path)) return { trusted: false, path }
  const pem = extractPemCertificate(readFileSync(path, 'utf8'))
  if (!pem) return { trusted: false, path }
  return { trusted: trustCertificate(pem) || process.env.NODE_EXTRA_CA_CERTS === path, path }
}
