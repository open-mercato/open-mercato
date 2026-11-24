import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export type ThrowawayTls = {
  directory: string
  caPem: string
  keystorePath: string
  keystorePassword: string
}

function openssl(args: string[], cwd: string): void {
  execFileSync('openssl', args, { cwd, stdio: 'pipe', timeout: 60_000 })
}

export function createThrowawayTls(): ThrowawayTls {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'om-ignite-tls-'))
  const keystorePassword = randomBytes(12).toString('hex')
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=om-ignite-test-ca'], directory)
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'], directory)
  writeFileSync(path.join(directory, 'server.ext'), [
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    'basicConstraints=CA:FALSE',
    'keyUsage=digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    '',
  ].join('\n'))
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '2', '-extfile', 'server.ext'], directory)
  openssl(['pkcs12', '-export', '-inkey', 'server.key', '-in', 'server.pem', '-certfile', 'ca.pem', '-out', 'server.p12', '-passout', `pass:${keystorePassword}`, '-name', 'server'], directory)
  return {
    directory,
    caPem: readFileSync(path.join(directory, 'ca.pem'), 'utf8'),
    keystorePath: path.join(directory, 'server.p12'),
    keystorePassword,
  }
}
