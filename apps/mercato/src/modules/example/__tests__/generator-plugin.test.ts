/** @jest-environment node */
/**
 * The `example.todo-preview-fields` generator plugin, end to end.
 *
 * A `GeneratorPlugin` is only real when three independently-editable pieces agree:
 * the declaration in `generators.ts`, the module-root convention file it aggregates,
 * and the registry consumer the generated bootstrap call populates. Nothing imports
 * the convention file, and nothing in this repository compiles the string the plugin
 * emits, so a mismatch between them produces a broken generated file at
 * `yarn generate` time rather than a type error here. These tests close that gap.
 */
import fs from 'node:fs'
import path from 'node:path'
import { generatorPlugins } from '../generators'
import { todoPreviewFields } from '../example-todo-preview-fields'
import {
  buildTodoPreviewMetadata,
  clearTodoPreviewFieldEntries,
  listTodoPreviewFields,
  registerTodoPreviewFieldEntries,
  type TodoPreviewField,
  type TodoPreviewSubject,
} from '../lib/todoPreviewFields'

const moduleRoot = path.join(__dirname, '..')
const plugin = generatorPlugins[0]

const TODO: TodoPreviewSubject = {
  id: 'todo-1',
  title: 'Ship the plugin',
  isDone: false,
  organizationId: 'org-a1',
}

const identityTranslate = (key: string) => key

afterEach(() => {
  clearTodoPreviewFieldEntries()
})

describe('example.todo-preview-fields plugin declaration', () => {
  it('declares exactly one plugin with the id the emitted fact sheet names', () => {
    expect(generatorPlugins).toHaveLength(1)
    expect(plugin.id).toBe('example.todo-preview-fields')
  })

  it('names a convention file that actually exists at the module root and exports the aggregated array', () => {
    const conventionPath = path.join(moduleRoot, plugin.conventionFile)
    expect(fs.existsSync(conventionPath)).toBe(true)
    // The generator reads `<import>.default ?? <import>.todoPreviewFields`; both have to
    // resolve to the same array or a contributor gets silently dropped.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const conventionModule = require('../example-todo-preview-fields') as Record<string, unknown>
    expect(conventionModule.default).toBe(todoPreviewFields)
    expect(conventionModule.todoPreviewFields).toBe(todoPreviewFields)
    expect(todoPreviewFields.length).toBeGreaterThan(0)
  })

  it('emits an output file whose export name is the one bootstrapRegistration imports back', () => {
    const entriesLiteral = plugin.configExpr('EXAMPLE_TODO_PREVIEW_FIELDS_example_0', 'example')
    const output = plugin.buildOutput({
      importSection: `import * as EXAMPLE_TODO_PREVIEW_FIELDS_example_0 from "../../src/modules/example/example-todo-preview-fields"`,
      entriesLiteral,
    })

    const registration = plugin.bootstrapRegistration
    expect(registration).toBeDefined()
    // `module-registry.ts` writes `import { <entriesExportName> } from './<outputFileName>'`.
    // If the output does not export that binding the generated bootstrap file does not compile.
    expect(output).toContain(`export const ${registration!.entriesExportName}`)
    expect(output).toContain(entriesLiteral)
    expect(registration!.buildCall(registration!.entriesExportName)).toBe(
      `registerTodoPreviewFieldEntries(${registration!.entriesExportName})`,
    )
  })

  it('imports the registrar from the path the generated file sits two levels above, using the symbol the registry exports', () => {
    const registration = plugin.bootstrapRegistration!
    expect(registration.registrationImports).toHaveLength(1)
    const statement = registration.registrationImports[0]
    expect(statement).toContain('registerTodoPreviewFieldEntries')
    expect(statement).toContain('../../src/modules/example/lib/todoPreviewFields')
    expect(typeof registerTodoPreviewFieldEntries).toBe('function')

    // `<app>/.mercato/generated/` is always two levels below the app root, and the module
    // lives at `<app>/src/modules/example`, so the emitted specifier must resolve back to
    // the registry file this test imported.
    const resolved = path.resolve(moduleRoot, '..', '..', '..', '.mercato', 'generated', '../../src/modules/example/lib/todoPreviewFields')
    expect(fs.existsSync(`${resolved}.ts`)).toBe(true)
  })

  it('names an output file that is a generated sibling, not a source file it would overwrite', () => {
    expect(plugin.outputFileName).toMatch(/\.generated\.ts$/)
    expect(fs.existsSync(path.join(moduleRoot, plugin.outputFileName))).toBe(false)
  })
})

describe('todo preview field registry', () => {
  it('reports nothing before the generated bootstrap call runs', () => {
    expect(listTodoPreviewFields()).toEqual([])
    expect(buildTodoPreviewMetadata(TODO, { translate: identityTranslate })).toEqual({})
  })

  it('flattens every contributing module in registration order', () => {
    registerTodoPreviewFieldEntries([
      { moduleId: 'example', fields: todoPreviewFields },
      {
        moduleId: 'other',
        fields: [{ id: 'other.flag', labelKey: 'other.flag', render: () => 'on' }],
      },
    ])

    expect(listTodoPreviewFields().map((field) => field.id)).toEqual([
      'example.owning-organization',
      'other.flag',
    ])
  })

  it('replaces rather than appends, so a second bootstrap pass does not duplicate rows', () => {
    registerTodoPreviewFieldEntries([{ moduleId: 'example', fields: todoPreviewFields }])
    registerTodoPreviewFieldEntries([{ moduleId: 'example', fields: todoPreviewFields }])

    expect(listTodoPreviewFields()).toHaveLength(todoPreviewFields.length)
  })

  it('renders the shipped contribution from the entity and falls back when the row has no organization', () => {
    registerTodoPreviewFieldEntries([{ moduleId: 'example', fields: todoPreviewFields }])

    expect(buildTodoPreviewMetadata(TODO, { translate: identityTranslate })).toEqual({
      'example.todos.table.column.organization': 'org-a1',
    })
    expect(
      buildTodoPreviewMetadata({ ...TODO, organizationId: null }, { translate: identityTranslate }),
    ).toEqual({
      'example.todos.table.column.organization': 'example.todos.table.organization.none',
    })
  })

  it('omits a contribution that returns null and keeps the first claim on a duplicated label', () => {
    const fields: TodoPreviewField[] = [
      { id: 'first', labelKey: 'shared.label', render: () => 'first-value' },
      { id: 'second', labelKey: 'shared.label', render: () => 'second-value' },
      { id: 'silent', labelKey: 'silent.label', render: () => null },
    ]
    registerTodoPreviewFieldEntries([{ moduleId: 'other', fields }])

    expect(buildTodoPreviewMetadata(TODO, { translate: identityTranslate })).toEqual({
      'shared.label': 'first-value',
    })
  })
})
