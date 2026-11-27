import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const consumerRequire = createRequire(require.resolve('@parse/node-apn'))
const forge = consumerRequire('node-forge')

function createClient(errors = []) {
  return forge.tls.createConnection({
    server: false,
    connected() {},
    tlsDataReady() {},
    dataReady() {},
    closed() {},
    error(connection, error) { errors.push(error) },
  })
}

test('GHSA-j8rw-jp99-435v: TLS records without a client session do not throw', () => {
  const serverHello = forge.util.hexToBytes('160301000402000000')
  const beforeHandshake = createClient()
  assert.doesNotThrow(() => beforeHandshake.process(serverHello))
  const afterClose = createClient()
  afterClose.handshake()
  afterClose.process(forge.util.hexToBytes('15030100020100'))
  assert.doesNotThrow(() => afterClose.process(serverHello))
})

test('GHSA-w4xr-hqv8-ch44: unoffered TLS compression fails through the error callback', () => {
  const errors = []
  const client = createClient(errors)
  client.handshake()
  const body = forge.util.createBuffer()
  body.putBytes('\x03\x01' + '\x00'.repeat(32))
  body.putByte(0)
  body.putBytes('\x00\x2f')
  body.putByte(255)
  const handshake = forge.util.createBuffer()
  handshake.putByte(2)
  handshake.putInt24(body.length())
  handshake.putBuffer(body)
  const record = forge.util.createBuffer()
  record.putBytes('\x16\x03\x01')
  record.putInt16(handshake.length())
  record.putBuffer(handshake)
  assert.doesNotThrow(() => client.process(record.getBytes()))
  assert.equal(errors.length, 1)
  assert.equal(errors[0].alert.description, forge.tls.Alert.Description.illegal_parameter)
})

test('GHSA-6889-vf6x-f3g5: identity keys cannot forge Ed25519 signatures', () => {
  const publicKey = Buffer.alloc(32)
  publicKey[0] = 1
  const signature = Buffer.alloc(64)
  signature[0] = 1
  assert.equal(forge.ed25519.verify({ message: Buffer.from('untrusted message'), publicKey, signature }), false)
  const keyPair = forge.ed25519.generateKeyPair()
  const message = Buffer.from('valid APNs dependency crypto smoke')
  const validSignature = forge.ed25519.sign({ message, privateKey: keyPair.privateKey })
  assert.equal(forge.ed25519.verify({ message, publicKey: keyPair.publicKey, signature: validSignature }), true)
})

test('GHSA-6cv4-p8m7-4r25: adversarial HTTP headers finish within a bounded worker', () => {
  const worker = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `
    const assert = require('node:assert/strict')
    const forge = require(${JSON.stringify(consumerRequire.resolve('node-forge'))})
    require(${JSON.stringify(consumerRequire.resolve('node-forge/lib/http'))})
    const response = forge.http.createResponse()
    const value = 'a' + '\\t '.repeat(250000) + 'X'
    assert.equal(response.readHeader(forge.util.createBuffer('HTTP/1.1 200 OK\\r\\nX-Test: ' + value + '\\r\\n\\r\\n')), true)
    assert.equal(response.getField('X-Test'), value)
  `], { timeout: 3000, encoding: 'utf8' })
  assert.ifError(worker.error)
  assert.equal(worker.status, 0, worker.stderr)
})
