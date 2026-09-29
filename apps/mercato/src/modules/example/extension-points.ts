import {
  componentExtensionHost,
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

/**
 * Extension hosts this module exposes to OTHER modules.
 *
 * Every host below is CONSUMED by its declared source file — the call site reads
 * `extensionPoints.hosts.<key>` rather than repeating the id. That direction is what
 * `hasDeclarationBinding` (packages/cli/.../module-extension-facts.ts) looks for; a
 * duplicated literal leaves the host `unbound-declaration` in generated module facts
 * even though the spot appears to work at runtime.
 * `__tests__/extension-points.test.ts` pins both the consumption pattern and the
 * extractor's own "no unbound declarations" verdict.
 *
 * `todoForm.entityId` is dot-separated because `CrudForm` normalizes its
 * `entityId` prop (`example:todo`) to `example.todo` when it derives the spot id.
 */
export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'example',
  hosts: {
    todosTable: dataTableExtensionHost({
      tableId: 'example.todos.list',
      source: 'components/TodosTable.tsx',
    }),
    todoForm: crudFormExtensionHost({
      entityId: 'example.todo',
      spotId: 'crud-form:example.todo',
      source: 'components/TodoForm.tsx',
    }),
    handlersForm: injectionExtensionHost({
      family: 'generic',
      spotId: 'example:phase-c-handlers',
      supported: ['render-widget'],
      source: 'backend/umes-handlers/page.tsx',
    }),
    overrideShowcase: componentExtensionHost({
      componentId: 'section:example.overrides.showcase',
      propsContract: 'OverrideShowcaseProps',
      source: 'components/ComponentOverrideShowcase.tsx',
    }),
  },
})

export default extensionPoints
