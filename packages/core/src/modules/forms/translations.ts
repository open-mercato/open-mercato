/**
 * Forms module translatable fields.
 *
 * Phase 1b registers `name` + `description` on `forms_form` and `changelog`
 * on `forms_form_version` as translatable. The TranslationManager widget is
 * automatically injected on each entity's CrudForm edit page once the
 * generator picks these declarations up.
 */
export const translatableFields: Record<string, string[]> = {
  'forms:form': ['name', 'description'],
  'forms:form_version': ['changelog'],
}

export default translatableFields
