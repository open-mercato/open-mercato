import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import tls from 'node:tls'

import { CAPTURED_CA_BUNDLE, DOCKER_CERTS_DIR, OPENCODE_CERTS_DIR, TLS_PROBE_HOSTS } from './constants.mjs'

// Corporate TLS interception handling. Managed devices (Zscaler, Netskope,
// Palo Alto, ...) resign every TLS connection with a company root CA that the
// OS trusts but Node/yarn/docker builds do not. The strategy:
//   detect  — probe well-known hosts with Node's default trust store
//   capture — export the interception root(s) from the presented chain
//   provision — drop the bundle everywhere the stack needs it:
//     * NODE_EXTRA_CA_CERTS for every host-side child process (yarn, corepack,
//       node scripts)
//     * docker/certs/ + docker/opencode/certs/ (baked into image builds and
//       runtime container trust by the existing Dockerfiles)
//   guide  — engine-level trust (Docker Desktop reads the Windows cert store;
//     Rancher Desktop needs the CA inside its WSL distro) is reported by the
//     doctor with exact commands, since it touches machine state we do not own.

const PROBE_TIMEOUT_MS = 5000

const INTERCEPTION_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
])

function connectOnce(host, { rejectUnauthorized }) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized,
      // Only the platform trust matters for classification — an inherited
      // NODE_EXTRA_CA_CERTS would mask the interception we are looking for,
      // but Node bakes it in at process start, so run detection before we
      // inject the bundle into our own environment (see provisionHostTrust).
      timeout: PROBE_TIMEOUT_MS,
    })
    const finish = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.once('secureConnect', () => {
      finish({ host, status: 'ok', authorized: socket.authorized, peer: socket.getPeerCertificate(true) })
    })
    socket.once('timeout', () => finish({ host, status: 'unreachable', reason: 'timeout' }))
    socket.once('error', (error) => {
      const code = error?.code ?? ''
      if (INTERCEPTION_ERROR_CODES.has(code)) {
        finish({ host, status: 'intercepted', reason: code })
      } else {
        finish({ host, status: 'unreachable', reason: code || String(error?.message ?? 'unknown error') })
      }
    })
  })
}

// Classify egress per host: 'ok' | 'intercepted' | 'unreachable'.
export async function probeTlsInterception(hosts = TLS_PROBE_HOSTS) {
  const results = []
  for (const host of hosts) {
    const strict = await connectOnce(host, { rejectUnauthorized: true })
    if (strict.status !== 'intercepted') {
      results.push({ host, status: strict.status, reason: strict.reason ?? '' })
      continue
    }
    results.push({ host, status: 'intercepted', reason: strict.reason ?? '' })
  }
  return results
}

function derToPem(raw) {
  const base64 = Buffer.from(raw).toString('base64')
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

function walkToRoots(peer) {
  // The presented chain ends at the interception root (self-signed: the cert
  // whose issuerCertificate points at itself). Collect every CA cert above the
  // leaf — proxies often present an intermediate + root and both are needed.
  const collected = []
  const seen = new Set()
  let current = peer
  let hops = 0
  while (current && typeof current === 'object' && hops < 10) {
    hops += 1
    const isSelfIssued = current.issuerCertificate === current
    const fingerprint = current.fingerprint256 ?? current.fingerprint ?? ''
    const isCa = current.ca === true || isSelfIssued
    if (isCa && fingerprint && !seen.has(fingerprint)) {
      seen.add(fingerprint)
      collected.push({ fingerprint, subject: current.subject?.CN ?? current.subject?.O ?? 'unknown', raw: current.raw })
    }
    if (isSelfIssued) break
    current = current.issuerCertificate
  }
  return collected
}

// Capture the interception CA chain from every intercepted host, deduped by
// fingerprint. Returns [{ fingerprint, subject, pem }].
export async function captureInterceptionCas(hosts) {
  const captured = new Map()
  for (const host of hosts) {
    const relaxed = await connectOnce(host, { rejectUnauthorized: false })
    if (relaxed.status !== 'ok' || !relaxed.peer) continue
    for (const cert of walkToRoots(relaxed.peer)) {
      if (!cert.raw || captured.has(cert.fingerprint)) continue
      captured.set(cert.fingerprint, { fingerprint: cert.fingerprint, subject: cert.subject, pem: derToPem(cert.raw) })
    }
  }
  return [...captured.values()]
}

function readBundleText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim()
  } catch {
    return ''
  }
}

// Netskope agents ship a ready-made combined PEM on disk — the cheapest and
// most reliable source when present.
// https://community.netskope.com/next-gen-swg-2/configuring-cli-based-tools-and-development-frameworks-to-work-with-netskope-ssl-interception-7015
export function findVendorCaBundles() {
  if (process.platform !== 'win32') return []
  const programData = process.env.ProgramData ?? 'C:\\ProgramData'
  return [
    path.join(programData, 'Netskope', 'STAgent', 'data', 'nscacert_combined.pem'),
    path.join(programData, 'Netskope', 'STAgent', 'download', 'nscacert_combined.pem'),
  ].filter((candidate) => fs.existsSync(candidate))
}

const WINDOWS_INTERCEPTION_SUBJECT_PATTERN = 'Zscaler|Netskope|Palo Alto|Blue Coat|Forcepoint|Fortinet|McAfee Web|SSL Inspection|TLS Inspection|Decryption'

// Harvest GPO-deployed interception roots from the Windows certificate store
// (readable without admin; CurrentUser\Root inherits the machine store). The
// interception root often is NOT sent on the wire — the store is the only
// place to get it. Cmdlet-only PowerShell, safe under Constrained Language.
export function harvestWindowsStoreCas() {
  if (process.platform !== 'win32') return []
  const script = [
    `$pattern = '${WINDOWS_INTERCEPTION_SUBJECT_PATTERN}'`,
    "Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Subject -match $pattern } | ForEach-Object {",
    "  'FINGERPRINT:' + $_.Thumbprint",
    "  'SUBJECT:' + $_.Subject",
    "  '-----BEGIN CERTIFICATE-----'",
    "  [Convert]::ToBase64String($_.RawData, [Base64FormattingOptions]::InsertLineBreaks)",
    "  '-----END CERTIFICATE-----'",
    '}',
  ].join('; ')
  const run = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  if (run.error || run.status !== 0) return []
  const certs = []
  const blocks = String(run.stdout ?? '').split('FINGERPRINT:').slice(1)
  for (const block of blocks) {
    const [fingerprint] = block.split(/\r?\n/, 1)
    const subject = block.match(/SUBJECT:(.*)/)?.[1]?.trim() ?? 'unknown'
    const pemMatch = block.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
    if (!pemMatch) continue
    certs.push({ fingerprint: fingerprint.trim(), subject, pem: `${pemMatch[0].replace(/\r\n/g, '\n')}\n` })
  }
  return certs
}

// Build the effective CA bundle from company-provided files plus captured CAs
// and write it to .mercato/certs/corporate-ca.pem. Returns the bundle path or
// null when there is nothing to trust.
export function writeCaBundle(repoRoot, { companyBundles = [], capturedPems = [] } = {}) {
  const sections = []
  for (const bundlePath of companyBundles) {
    const text = readBundleText(bundlePath)
    if (text) sections.push(`# source: ${bundlePath}\n${text}`)
  }
  for (const cert of capturedPems) {
    sections.push(`# captured interception CA: ${cert.subject} (${cert.fingerprint})\n${cert.pem.trim()}`)
  }
  if (sections.length === 0) return null
  const bundlePath = path.join(repoRoot, CAPTURED_CA_BUNDLE)
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true })
  fs.writeFileSync(bundlePath, `${sections.join('\n\n')}\n`)
  return bundlePath
}

// Copy the bundle into the gitignored image-build drop zones. The root
// Dockerfile and docker/opencode/Dockerfile append everything in these dirs to
// the container trust store (build-time AND runtime egress).
export function provisionDockerCerts(repoRoot, bundlePath) {
  const targets = [
    path.join(repoRoot, DOCKER_CERTS_DIR, 'corporate-root-ca.crt'),
    path.join(repoRoot, OPENCODE_CERTS_DIR, 'corporate-root-ca.crt'),
  ]
  const written = []
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const next = fs.readFileSync(bundlePath, 'utf8')
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
    if (current !== next) fs.writeFileSync(target, next)
    written.push(target)
  }
  return written
}

// Environment for host-side child processes so node/yarn/corepack trust the
// corporate CA and traverse the corporate proxy:
//   * NODE_EXTRA_CA_CERTS — additive to Node's bundled roots (safe everywhere)
//   * --use-system-ca (Node >= 24) — additively trusts the OS store, which on
//     managed Windows contains the GPO-deployed interception root; this makes
//     host tooling work even when nothing could be captured
//   * NODE_USE_ENV_PROXY=1 — corepack 0.35+ (bundled since Node 24.16) dropped
//     its own proxy handling; without this flag HTTP(S)_PROXY is ignored
export function hostTrustEnv(bundlePath, baseEnv = process.env) {
  const env = { ...baseEnv }
  if (bundlePath) env.NODE_EXTRA_CA_CERTS = bundlePath
  const nodeOptions = String(env.NODE_OPTIONS ?? '')
  if (!nodeOptions.includes('--use-system-ca')) {
    env.NODE_OPTIONS = `${nodeOptions} --use-system-ca`.trim()
  }
  const hasProxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((key) => env[key])
  if (hasProxy && !env.NODE_USE_ENV_PROXY) env.NODE_USE_ENV_PROXY = '1'
  return env
}

// Rancher Desktop imports Windows-store CAs into its WSL distro on start, but
// the mechanism is undocumented and has regressed more than once — the
// documented, deterministic channel is a provisioning script that runs as root
// inside the distro BEFORE dockerd starts. It must use LF line endings.
// https://docs.rancherdesktop.io/how-to-guides/provisioning-scripts
export function provisionRancherDesktopCa(repoRoot, bundlePath) {
  if (process.platform !== 'win32') return null
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData || !fs.existsSync(path.join(localAppData, 'rancher-desktop'))) return null
  const provisioningDir = path.join(localAppData, 'rancher-desktop', 'provisioning')
  const scriptPath = path.join(provisioningDir, 'open-mercato-corp-ca.start')
  // /mnt/c/... path of the bundle as seen from inside the WSL distro.
  const driveMatch = /^([A-Za-z]):[\\/](.*)$/.exec(bundlePath)
  if (!driveMatch) return null
  const wslBundlePath = `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replace(/\\/g, '/')}`
  const script = [
    '#!/bin/sh',
    '# Written by the Open Mercato starter: trust the corporate CA before dockerd starts.',
    `cp "${wslBundlePath}" /usr/local/share/ca-certificates/open-mercato-corp-ca.crt && update-ca-certificates`,
    '',
  ].join('\n')
  fs.mkdirSync(provisioningDir, { recursive: true })
  const current = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : null
  if (current !== script) fs.writeFileSync(scriptPath, script)
  return scriptPath
}

export function summarizeProbeResults(results) {
  return {
    intercepted: results.filter((entry) => entry.status === 'intercepted'),
    unreachable: results.filter((entry) => entry.status === 'unreachable'),
    clean: results.filter((entry) => entry.status === 'ok'),
  }
}
