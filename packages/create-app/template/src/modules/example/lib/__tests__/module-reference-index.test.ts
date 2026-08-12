import {
  getModuleReferenceIndexEntry,
  registerModuleReferenceIndexEntries,
  validateModuleReferenceIndexEntries,
  type ModuleReferenceIndexEntry,
} from '../module-reference-index'

const validEntry: ModuleReferenceIndexEntry = {
  moduleId: 'example',
  references: [
    {
      capabilityId: 'module.generator-plugin',
      inventoryPath: 'src/modules/example/references/surface-inventory.json',
      surfaceMapPath: 'src/modules/example/references/surface-map.md',
      sourcePaths: ['src/modules/example/generators.ts'],
    },
  ],
}

describe('module reference index', () => {
  it('registers portable reference declarations for runtime consumers', () => {
    registerModuleReferenceIndexEntries([validEntry])
    expect(getModuleReferenceIndexEntry('example')).toEqual(validEntry)
  })

  it('rejects duplicate module and capability entries', () => {
    expect(() => validateModuleReferenceIndexEntries([validEntry, validEntry])).toThrow(
      'Duplicate module reference index entry: example',
    )
    expect(() => validateModuleReferenceIndexEntries([
      { ...validEntry, references: [validEntry.references[0], validEntry.references[0]] },
    ])).toThrow('Duplicate module reference capability for example: module.generator-plugin')
  })

  it('rejects non-portable paths', () => {
    expect(() => validateModuleReferenceIndexEntries([
      {
        ...validEntry,
        references: [{ ...validEntry.references[0], sourcePaths: ['../apps/mercato/generators.ts'] }],
      },
    ])).toThrow('Module reference path must stay under src/modules/example/')
  })
})
