import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGeneratorResult } from '../../utils'
import { writeCrudFormSectionRegistries } from '../form-sections'

const externalFact = {
  integrationId: 'example.erp',
  contractId: 'example.brand_mirror@v1',
  maxAttempts: 3,
  preCommitValidation: 'read-only',
  coalesce: 'latest-state',
  fencing: 'remote-monotonic-revision/v1',
}

function fixture(atomicity: string, externalDelivery?: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'form-section-outbox-'))
  const source = path.join(root, 'form-sections.ts')
  const fact = {
    id: 'example.brand', roundTripId: 'example.brand@v1', ownerModuleId: 'example',
    targetEntityId: 'example.brand_mirror', atomicity, externalDelivery,
  }
  fs.writeFileSync(source, `
    export const crudFormSections = defineCrudFormSections({
      sinks: [defineCrudFormSectionSink({ fact: ${JSON.stringify(fact)}, schema: serverSchema })],
    })
  `)
  const build = () => writeCrudFormSectionRegistries({
    modules: [{
      modId: 'example', roots: { appBase: root, pkgBase: root },
      resolve: (relative) => relative === 'form-sections.ts'
        ? { fromApp: true, absolutePath: source, importPath: '@/modules/example/form-sections' } : null,
    }],
    identities: [{ id: 'example' }], requiresByModule: new Map(), outputDir: root,
    structureChecksum: 'test', result: createGeneratorResult(), quiet: true,
  })
  return { build, clean: () => fs.rmSync(root, { force: true, recursive: true }) }
}

it.each([
  ['outbox', undefined, /requires a literal externalDelivery/],
  ['outbox', { ...externalFact, fencing: 'lease-only' }, /remote-monotonic-revision\/v1/],
  ['outbox', { ...externalFact, contractId: 'example.other@v1' }, /requires contractId/],
  ['host-transaction', externalFact, /invalid atomicity or externalDelivery/],
] as const)('rejects %s declarations with invalid delivery facts', (atomicity, external, error) => {
  const { build, clean } = fixture(atomicity, external)
  try { expect(build).toThrow(error) } finally { clean() }
})

it('accepts a literal monotonic outbox provider contract', () => {
  const { build, clean } = fixture('outbox', externalFact)
  try { expect(build).not.toThrow() } finally { clean() }
})
