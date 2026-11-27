/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import {
  buildExtensionHeader,
  parseExtensionHeaders,
  getExtensionHeaderValue,
} from '../extension-headers'

describe('buildExtensionHeader', () => {
  it('builds correct header name', () => {
    expect(buildExtensionHeader('record-locks', 'token')).toBe('x-om-ext-record-locks-token')
  })

  it('handles single-word module', () => {
    expect(buildExtensionHeader('loyalty', 'points')).toBe('x-om-ext-loyalty-points')
  })
})

describe('parseExtensionHeaders', () => {
  it('parses extension headers from mixed headers (snake_case module IDs)', () => {
    const result = parseExtensionHeaders({
      'content-type': 'application/json',
      'x-om-ext-record_locks-token': 'abc123',
      'x-om-ext-business_rules-override': 'skip-credit-check',
      'authorization': 'Bearer xyz',
    })

    expect(Object.getPrototypeOf(result)).toBeNull()
    expect(Object.getPrototypeOf(result.record_locks)).toBeNull()
    expect(result).toEqual({
      record_locks: { token: 'abc123' },
      business_rules: { override: 'skip-credit-check' },
    })
  })

  it('returns empty null-prototype object for no extension headers', () => {
    const result = parseExtensionHeaders({
      'content-type': 'application/json',
    })
    expect(Object.getPrototypeOf(result)).toBeNull()
    expect(result).toEqual({})
  })

  it('handles array header values and mixed-case header names', () => {
    const result = parseExtensionHeaders({
      'X-OM-EXT-Test_Mod-Key': ['value1', 'value2'],
      'X-Om-Ext-Record_Locks-Lock-Token': 'lock-42',
    })
    expect(result).toEqual({
      test_mod: { key: 'value1' },
      record_locks: { 'lock-token': 'lock-42' },
    })
  })

  it('ignores empty and malformed extension headers', () => {
    const result = parseExtensionHeaders({
      'x-om-ext-': 'a',
      'x-om-ext-nodash': 'b',
      'x-om-ext--missing_module': 'c',
      'x-om-ext-missing_key-': 'd',
      'x-om-ext-valid-empty': '',
      'x-om-ext-valid-undef': undefined,
      'x-om-ext-valid-emptyarr': [],
      'x-om-ext-valid-emptyfirst': ['', 'second'],
      'x-om-ext-valid-ok': 'good',
    })
    expect(result).toEqual({
      valid: { ok: 'good' },
    })
  })

  it('rejects reserved prototype-related module and key segments across casings', () => {
    const result = parseExtensionHeaders({
      'x-om-ext-__proto__-polluted': 'yes',
      'X-OM-EXT-__PROTO__-Schema': 'evil schema',
      'x-om-ext-constructor-prototype': 'yes',
      'X-OM-EXT-Constructor-Injected': 'yes',
      'x-om-ext-prototype-polluted': 'yes',
      'x-om-ext-record_locks-__proto__': 'no',
      'x-om-ext-record_locks-constructor': 'no',
      'x-om-ext-record_locks-prototype': 'no',
      'x-om-ext-record_locks-token': 'safe-token',
    })

    expect(result).toEqual({
      record_locks: { token: 'safe-token' },
    })
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'schema')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(Object.prototype.constructor, 'injected')).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).schema).toBeUndefined()
  })

  it('does not resolve inherited Object.prototype property names as pre-existing buckets', () => {
    const originalToString = Object.prototype.toString
    const originalValueOf = Object.prototype.valueOf

    const result = parseExtensionHeaders({
      'x-om-ext-tostring-marker': 'isolated-1',
      'x-om-ext-valueof-marker': 'isolated-2',
      'x-om-ext-hasownproperty-marker': 'isolated-3',
    })

    expect(Object.prototype.toString).toBe(originalToString)
    expect(Object.prototype.valueOf).toBe(originalValueOf)
    expect((Object.prototype.toString as unknown as Record<string, unknown>).marker).toBeUndefined()
    expect((Object.prototype.valueOf as unknown as Record<string, unknown>).marker).toBeUndefined()
    expect(result).toEqual({
      tostring: { marker: 'isolated-1' },
      valueof: { marker: 'isolated-2' },
      hasownproperty: { marker: 'isolated-3' },
    })
    expect(Object.getPrototypeOf(result.tostring)).toBeNull()
  })

  it('keeps independent parsed results isolated and does not mutate prototypes in an isolated VM realm', () => {
    const first = parseExtensionHeaders({
      'x-om-ext-__proto__-marker': 'contaminated',
      'x-om-ext-record_locks-token': 'req-1',
    })
    const second = parseExtensionHeaders({
      'x-om-ext-record_locks-token': 'req-2',
    })

    expect(first).toEqual({ record_locks: { token: 'req-1' } })
    expect(second).toEqual({ record_locks: { token: 'req-2' } })
    expect((second as Record<string, unknown>).marker).toBeUndefined()

    const parserPath = require.resolve('../extension-headers')
    const { code } = transformSync(readFileSync(parserPath, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
      sourcefile: parserPath,
    })
    const realm = vm.createContext({
      module: { exports: {} },
      __stryker__: Reflect.get(globalThis, '__stryker__'),
    })
    vm.runInContext(code, realm, { filename: parserPath })
    const outcome = vm.runInContext(
      `
      const { parseExtensionHeaders: parseInRealm } = module.exports
      const beforeProtoKeys = Object.getOwnPropertyNames(Object.prototype)
      const beforeCtorKeys = Object.getOwnPropertyNames(Object.prototype.constructor)
      const parsed = parseInRealm({
        'x-om-ext-__proto__-schema': 'evil schema',
        'x-om-ext-constructor-prototype': 'evil',
        'x-om-ext-constructor-polluted': 'evil',
        'x-om-ext-prototype-polluted': 'evil',
        'x-om-ext-tostring-nested': 'ok',
        'x-om-ext-record_locks-token': 'tok-1',
      })
      const fresh = {}
      const afterProtoKeys = Object.getOwnPropertyNames(Object.prototype)
      const afterCtorKeys = Object.getOwnPropertyNames(Object.prototype.constructor)
      JSON.stringify({
        protoUnchanged: JSON.stringify(beforeProtoKeys) === JSON.stringify(afterProtoKeys),
        ctorUnchanged: JSON.stringify(beforeCtorKeys) === JSON.stringify(afterCtorKeys),
        freshSchema: fresh.schema === undefined,
        freshPolluted: fresh.polluted === undefined,
        hasNullProto: Object.getPrototypeOf(parsed) === null,
        hasNullInnerProto: Object.getPrototypeOf(parsed.record_locks) === null,
        token: parsed.record_locks && parsed.record_locks.token,
        tostringNested: parsed.tostring && parsed.tostring.nested,
        toStringUntouched: Object.prototype.toString.nested === undefined,
        hasProtoOwn: Object.prototype.hasOwnProperty.call(parsed, '__proto__'),
        hasCtorOwn: Object.prototype.hasOwnProperty.call(parsed, 'constructor'),
      })
      `,
      realm,
    )

    expect(JSON.parse(outcome)).toEqual({
      protoUnchanged: true,
      ctorUnchanged: true,
      freshSchema: true,
      freshPolluted: true,
      hasNullProto: true,
      hasNullInnerProto: true,
      token: 'tok-1',
      tostringNested: 'ok',
      toStringUntouched: true,
      hasProtoOwn: false,
      hasCtorOwn: false,
    })
  })
})

describe('getExtensionHeaderValue', () => {
  it('retrieves a specific extension header value', () => {
    const headers = {
      'x-om-ext-record-locks-token': 'abc123',
    }
    expect(getExtensionHeaderValue(headers, 'record-locks', 'token')).toBe('abc123')
  })

  it('returns undefined for missing header', () => {
    const headers = {
      'content-type': 'application/json',
    }
    expect(getExtensionHeaderValue(headers, 'record-locks', 'token')).toBeUndefined()
  })
})
