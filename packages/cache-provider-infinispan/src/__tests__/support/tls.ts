import { execFileSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type TlsMaterial = {
  caFile: string
  foreignCaFile: string
  keystoreFile: string
  keystorePassword: string
}

function openssl(args: string[], cwd: string): void {
  execFileSync('openssl', args, { cwd, stdio: 'pipe', timeout: 60_000 })
}

export function generateTlsMaterial(directory: string): TlsMaterial {
  const keystorePassword = 'om-test-keystore'
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=om-infinispan-test-ca'], directory)
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'foreign-ca.key', '-out', 'foreign-ca.pem', '-days', '2', '-subj', '/CN=om-foreign-ca'], directory)
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'], directory)
  writeFileSync(path.join(directory, 'server.ext'), [
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    'basicConstraints=CA:FALSE',
    'keyUsage=digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
  ].join('\n'))
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '2', '-extfile', 'server.ext'], directory)
  openssl(['pkcs12', '-export', '-inkey', 'server.key', '-in', 'server.crt', '-name', 'server', '-out', 'server.p12', '-passout', `pass:${keystorePassword}`], directory)
  const keystoreFile = path.join(directory, 'server.p12')
  chmodSync(keystoreFile, 0o644)
  return {
    caFile: path.join(directory, 'ca.pem'),
    foreignCaFile: path.join(directory, 'foreign-ca.pem'),
    keystoreFile,
    keystorePassword,
  }
}
