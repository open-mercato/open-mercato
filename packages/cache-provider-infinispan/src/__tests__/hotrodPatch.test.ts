import protocols from 'infinispan/lib/protocols.js'
import { guardDecodeNextEntries, guardDecodeWithMeta, patchHotRodProtocols, type HotRodDecoder } from '../hotrodPatch'

type Protocol = { decodeWithMeta: () => HotRodDecoder }
type ProtocolsModule = { resolve: (version: string, options: unknown) => Protocol }

const clientOptions = { dataFormat: { keyType: 'text/plain', valueType: 'text/plain' } }

function truncatedVersionedResponse(): { buf: Buffer; offset: number } {
  const flags = Buffer.from([0x03])
  const version = Buffer.alloc(8, 7)
  const value = Buffer.from([10, 0x61, 0x62, 0x63])
  return { buf: Buffer.concat([flags, version, value]), offset: 0 }
}

function completeVersionedResponse(): { buf: Buffer; offset: number } {
  const flags = Buffer.from([0x03])
  const version = Buffer.alloc(8, 7)
  const value = Buffer.from([3, 0x61, 0x62, 0x63])
  return { buf: Buffer.concat([flags, version, value]), offset: 0 }
}

function truncatedLifespanResponse(): { buf: Buffer; offset: number } {
  return { buf: Buffer.from([0x02, 0x00, 0x00, 0x01]), offset: 0 }
}

describe('infinispan getWithMetadata decode guard', () => {
  const protocolsModule = protocols as unknown as ProtocolsModule
  const original = protocolsModule.resolve

  it('reproduces the upstream defect on a truncated value', () => {
    const decoder = original('4.1', clientOptions).decodeWithMeta()
    const decoded = decoder({ status: 0 }, truncatedVersionedResponse())
    expect(decoded.continue).toBe(true)
    expect(decoded.result).toMatchObject({ value: undefined })
  })

  it('reproduces the upstream throw on a truncated lifespan timestamp', () => {
    const decoder = original('4.1', clientOptions).decodeWithMeta()
    expect(() => decoder({ status: 0 }, truncatedLifespanResponse())).toThrow(TypeError)
    expect(guardDecodeWithMeta(decoder)({ status: 0 }, truncatedLifespanResponse())).toEqual({ continue: false })
  })

  it('asks the transport for more bytes instead of returning an undefined value', () => {
    const guarded = guardDecodeWithMeta(original('4.1', clientOptions).decodeWithMeta())
    expect(guarded({ status: 0 }, truncatedVersionedResponse())).toEqual({ continue: false })
    expect(guarded({ status: 0 }, completeVersionedResponse())).toMatchObject({ continue: true, result: { value: 'abc' } })
    expect(guarded({ status: 2 }, completeVersionedResponse())).toEqual({ result: undefined, continue: true })
  })

  it('patches the shared protocol module idempotently for every pinned protocol version', () => {
    expect(patchHotRodProtocols({ default: protocolsModule })).toBe(true)
    expect(patchHotRodProtocols({ default: protocolsModule })).toBe(true)
    for (const version of ['4.1', '4.0', '3.1']) {
      const decoder = protocolsModule.resolve(version, clientOptions).decodeWithMeta()
      expect(decoder({ status: 0 }, truncatedVersionedResponse())).toEqual({ continue: false })
    }
    expect(patchHotRodProtocols({})).toBe(false)
  })

  it('rethrows decoder errors that are not an incomplete frame', () => {
    const broken: HotRodDecoder = () => { throw new Error('protocol violation') }
    expect(() => guardDecodeWithMeta(broken)({ status: 0 }, completeVersionedResponse())).toThrow('protocol violation')
    const outOfRange: HotRodDecoder = () => Buffer.alloc(1).readUInt32BE(0) as never
    expect(guardDecodeWithMeta(outOfRange)({ status: 0 }, completeVersionedResponse())).toEqual({ continue: false })
  })

  it('refuses to patch a client whose protocols lack decodeWithMeta', () => {
    expect(patchHotRodProtocols({ resolve: () => ({}) })).toBe(false)
    expect(patchHotRodProtocols({ resolve: () => { throw new Error('unknown version') } })).toBe(false)
  })

  it('guards iterator pages against split frames as well', () => {
    const truncatedTimestamp: HotRodDecoder = () => { throw new TypeError("Cannot read properties of undefined (reading 'length')") }
    expect(guardDecodeNextEntries(truncatedTimestamp)({ status: 0 }, completeVersionedResponse())).toEqual({ continue: false })
    const truncatedValue: HotRodDecoder = () => ({ continue: true, result: [{ key: 'a', value: 'x' }, { key: 'b', value: undefined }] })
    expect(guardDecodeNextEntries(truncatedValue)({ status: 0 }, completeVersionedResponse())).toEqual({ continue: false })
    const complete: HotRodDecoder = () => ({ continue: true, result: [{ key: 'a', value: 'x' }] })
    expect(guardDecodeNextEntries(complete)({ status: 0 }, completeVersionedResponse())).toEqual({ continue: true, result: [{ key: 'a', value: 'x' }] })
  })
})
