import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractModuleFacts } from '../module-facts'

/**
 * A DI token registered through a computed key must still reach module facts.
 *
 * `container.register({ [SERVICE_TOKEN]: asFunction(...) })` — reading the token from an
 * exported const — is the idiomatic, type-safe registration. `getPropertyName` returned
 * undefined for a `ts.ComputedPropertyName`, so the whole registration vanished with NO
 * diagnostic: the unresolved-token path is only reached for a NAMED token whose Awilix kind
 * is unrecognised, so a computed key failed silently rather than being reported.
 *
 * That produced a capability the inventory claimed and the extractor scored zero for. Found
 * by an agent that ran the real extractor instead of trusting the row.
 */

function write(filePath: string, source: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source)
}

function factsFor(diSource: string): Array<{ id: string; metadata?: Record<string, unknown> }> {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-computed-di-'))
  try {
    write(path.join(moduleRoot, 'di.ts'), diSource)
    const facts = extractModuleFacts({
      moduleId: 'probe',
      moduleRoot,
      sourceRoot: 'src/modules/probe',
    }) as { ownedContracts?: Record<string, Array<{ id: string; metadata?: Record<string, unknown> }>> }
    return facts.ownedContracts?.['di-registration'] ?? []
  } finally {
    fs.rmSync(moduleRoot, { recursive: true, force: true })
  }
}

describe('module-facts DI registration with a computed token', () => {
  it('resolves a token declared as a same-file const', () => {
    const facts = factsFor(`
      import { asFunction } from 'awilix'
      export const PROBE_SERVICE = 'probeService' as const
      export function register(container: any) {
        container.register({ [PROBE_SERVICE]: asFunction(createProbeService).scoped() })
      }
    `)

    expect(facts).toHaveLength(1)
    expect(facts[0].id).toBe('probeService')
    expect(facts[0].metadata).toMatchObject({ registrationKind: 'function', lifetime: 'scoped' })
  })

  it('resolves a token written as a computed string literal', () => {
    const facts = factsFor(`
      import { asValue } from 'awilix'
      export function register(container: any) {
        container.register({ ['literalToken']: asValue(42) })
      }
    `)

    expect(facts.map((fact) => fact.id)).toEqual(['literalToken'])
  })

  it('still resolves plain identifier and string keys', () => {
    const facts = factsFor(`
      import { asValue } from 'awilix'
      export function register(container: any) {
        container.register({ plainKey: asValue(1), 'quotedKey': asValue(2) })
      }
    `)

    expect(facts.map((fact) => fact.id).sort()).toEqual(['plainKey', 'quotedKey'])
  })

  it('leaves a genuinely dynamic token unresolved rather than inventing one', () => {
    // A key the reader cannot know statically must NOT be guessed. Emitting a wrong token
    // would be worse than emitting none.
    const facts = factsFor(`
      import { asValue } from 'awilix'
      export function register(container: any, name: string) {
        container.register({ [name]: asValue(1) })
      }
    `)

    expect(facts).toEqual([])
  })
})
