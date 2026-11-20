import type { CrudFormGroup } from '../CrudForm'

export type CrudFormSectionValidationResult<TParsed> =
  | { success: true; data: TParsed }
  | { success: false; fieldErrors: Record<string, string> }

export type CrudFormSectionValidationInput<TValues> = {
  sectionValues: Readonly<Record<string, unknown>>
  fullValues: Readonly<TValues>
}

type CrudFormSectionRuntimeFields = {
  id: string
  roundTripId: string
  group: CrudFormGroup
  ownedFieldPaths: readonly string[]
  ownedCustomFieldIds?: readonly string[] | 'all'
  customFieldDefinitionSetId?: string
  mutationSurfaceIds?: readonly string[]
  requiredSectionIds?: readonly string[]
  requiredDataContractIds?: readonly string[]
  providedDataContractIds?: readonly string[]
}

export type CrudFormSectionRuntimeDescriptor<TValues, TParsed, TPayload> = CrudFormSectionRuntimeFields & {
  validate: (input: CrudFormSectionValidationInput<TValues>) => CrudFormSectionValidationResult<TParsed>
  projectPayload: (parsed: TParsed, fullValues: Readonly<TValues>) => Partial<TPayload>
}

/** Form state can be incomplete while a section is being edited. */
export type CrudFormSectionValues<TValues extends Record<string, unknown>> = Partial<TValues> & Record<string, unknown>

export type CrudFormSectionCompositionValidator<TValues, TPayload> = (input: {
  activeSectionIds: ReadonlySet<string>
  parsedSections: ReadonlyMap<string, unknown>
  fullValues: Readonly<TValues>
  payload: Readonly<Partial<TPayload>>
}) => CrudFormSectionValidationResult<Partial<TPayload>>

/** Keeps each validator paired with its projector when sections have different parsed types. */
export type CrudFormSectionRuntime<TValues, TPayload> = CrudFormSectionRuntimeFields & {
  validateAndProject: (input: CrudFormSectionValidationInput<TValues>) => CrudFormSectionValidationResult<{
    parsed: unknown
    payload: Partial<TPayload>
  }>
}

export function defineCrudFormSectionRuntime<TValues, TParsed, TPayload>(
  descriptor: CrudFormSectionRuntimeDescriptor<TValues, TParsed, TPayload>,
): CrudFormSectionRuntimeDescriptor<TValues, TParsed, TPayload> & CrudFormSectionRuntime<TValues, TPayload> {
  const { validate, projectPayload } = descriptor
  return {
    ...descriptor,
    validateAndProject(input) {
      const parsed = validate(input)
      if (!parsed.success) return parsed
      return { success: true, data: { parsed: parsed.data, payload: projectPayload(parsed.data, input.fullValues) } }
    },
  }
}
