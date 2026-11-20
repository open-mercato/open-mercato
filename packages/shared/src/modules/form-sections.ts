import type { CrudFormSectionContributionFact } from './form-section-facts'

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

export type CrudFormSectionFactEntry =
  | { kind: 'host'; moduleId: string; fact: CrudFormSectionDescriptorIdentity }
  | { kind: 'contribution'; moduleId: string; fact: CrudFormSectionContributionFact }

export type CrudFormSectionsDeclaration = {
  hostFacts?: readonly CrudFormSectionDescriptorIdentity[]
  contributionFacts?: readonly CrudFormSectionContributionFact[]
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
