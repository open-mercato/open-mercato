import protocols from 'infinispan/lib/protocols.js'
import { guardDecodeWithMeta, patchHotRodProtocols, type HotRodDecoder } from '../hotrodPatch'

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
})
