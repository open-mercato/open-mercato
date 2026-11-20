export type CrudFormSectionDescriptorIdentity = {
  id: string
  roundTripId: string
}

export type CrudFormSectionRuntimeModule = {
  crudFormSectionRuntime: CrudFormSectionDescriptorIdentity
}

export type CrudFormSectionRuntimeLoader<Runtime extends CrudFormSectionRuntimeModule = CrudFormSectionRuntimeModule> = () => Promise<Runtime>

export type CrudFormSectionRuntimeDeclaration = CrudFormSectionDescriptorIdentity & {
  load: CrudFormSectionRuntimeLoader
}

export type CrudFormSectionRuntimeEntry = CrudFormSectionRuntimeDeclaration & {
  kind: 'host' | 'contribution'
  moduleId: string
}

export type CrudFormSectionFactEntry = {
  kind: CrudFormSectionRuntimeEntry['kind']
  moduleId: string
  fact: CrudFormSectionDescriptorIdentity
}

export type CrudFormSectionsDeclaration = {
  hostFacts?: readonly CrudFormSectionDescriptorIdentity[]
  contributionFacts?: readonly CrudFormSectionDescriptorIdentity[]
  runtimes?: readonly CrudFormSectionRuntimeDeclaration[]
}

export function defineCrudFormSections<const Declaration extends CrudFormSectionsDeclaration>(
  declaration: Declaration,
): Declaration {
  return declaration
}

export function lazyCrudFormSectionRuntime<Runtime extends CrudFormSectionRuntimeModule>(
  load: CrudFormSectionRuntimeLoader<Runtime>,
): CrudFormSectionRuntimeLoader<Runtime> {
  return load
}
