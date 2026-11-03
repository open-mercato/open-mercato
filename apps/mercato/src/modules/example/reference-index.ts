export type ModuleReferenceDeclaration = {
  capabilityId: string
  inventoryPath: string
  surfaceMapPath: string
  sourcePaths: readonly string[]
}

export const moduleReferenceDeclarations: readonly ModuleReferenceDeclaration[] = [
  {
    capabilityId: 'module.generator-plugin',
    inventoryPath: 'src/modules/example/references/surface-inventory.json',
    surfaceMapPath: 'src/modules/example/references/surface-map.md',
    sourcePaths: [
      'src/modules/example/generators.ts',
      'src/modules/example/reference-index.ts',
      'src/modules/example/lib/module-reference-index.ts',
    ],
  },
]

export default moduleReferenceDeclarations
