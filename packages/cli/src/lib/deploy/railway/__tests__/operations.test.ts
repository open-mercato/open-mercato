import { createHash } from 'node:crypto'
import {
  railwayOperations,
  railwaySchemaFingerprintSource,
} from '../operations'

describe('Railway GraphQL operation contract', () => {
  it('matches the verified operation fingerprint', () => {
    const fingerprint = createHash('sha256')
      .update(railwaySchemaFingerprintSource())
      .digest('hex')
    expect(fingerprint).toBe('01e3c5feaa163ebe626a1cb9ae5f22b5e7ea316162fed9353375f34c25ebc522')
  })

  it('uses template-backed databases and singular service variable upserts', () => {
    const source = railwaySchemaFingerprintSource()
    expect(source).toContain('templateDeployV2')
    expect(source).not.toContain('pluginCreate')
    expect(railwayOperations.variableUpsert.query).toContain('VariableCollectionUpsertInput')
  })
})
