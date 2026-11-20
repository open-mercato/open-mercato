import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import { normalizeCrudFormFieldRules, type CrudFormDeclarativeFieldConstraint } from '@open-mercato/shared/lib/crud/form-sections/field-rules'
import { symbolicIdSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import type { CrudFormSectionAddress } from '@open-mercato/shared/modules/form-section-facts'
import { arrayField, fieldsOf, literalData, literalValue, getLocalSectionInitializer, readSectionBuilder, unwrap } from './form-section-ast'
import { MODULE_CODE_EXTENSIONS, stripModuleCodeExtension } from './scanner'

type Invalid = (reason: string) => never
type SourceTarget = Pick<CrudFormSectionAddress, 'formVariant' | 'formOperation'>
export type SectionBrowserLoader = { importPath: string; source: ts.SourceFile }
export type SectionExtensionStore = { kind: 'customField' | 'table' | 'sink' | 'external'; key?: string; entityId?: string; fieldOverride: boolean }

export type SectionExtensionField = {
  id: string
  operation: 'add' | 'patch' | 'remove'
  browser: Record<string, unknown>
  loaders: Partial<Record<'options' | 'clientRule' | 'component', SectionBrowserLoader>>
  rules: ReturnType<typeof normalizeCrudFormFieldRules>
  server: boolean
  store?: SectionExtensionStore
}

export type SectionExtensionChange = {
  id: string
  operation: 'add' | 'hide' | 'modify' | 'replace'
  before?: string
  after?: string
  titleKey?: string
  replacement?: SectionBrowserLoader
  fields: SectionExtensionField[]
  syntax: ts.Expression
}

export type SectionExtensionSource = {
  index: number
  id: string
  hostId: string
  targets: SourceTarget[]
  changes: SectionExtensionChange[]
  defaults: readonly { payloadPath: string; syntax: ts.Expression; readsPayloadPaths: readonly string[] }[]
  syntax: ts.Expression
}

export function sectionSymbol(value: unknown, label: string, invalid: Invalid): string {
  const parsed = symbolicIdSchema.safeParse(value)
  return parsed.success ? parsed.data : invalid(`invalid ${label}`)
}

function formLeaf(value: unknown, label: string, invalid: Invalid): string {
  return typeof value === 'string' && /^[A-Za-z0-9_:-]+(?:\.[A-Za-z0-9_:-]+)*$/.test(value)
    && value.length <= 160 && !value.split('.').some((part) => ['constructor', 'prototype', '__proto__'].includes(part))
    ? value : invalid(`invalid ${label}`)
}

function labelKey(value: unknown, invalid: Invalid): string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/.test(value)
    ? value : invalid('expected an i18n key')
}

function optionalLiteral(value: ts.Expression | undefined, invalid: Invalid): unknown {
  return value === undefined ? undefined : literalData(value, invalid)
}

function safePlacement(fields: Map<string, ts.Expression>, invalid: Invalid): { before?: string; after?: string } {
  if (fields.has('before') && fields.has('after')) return invalid('before and after cannot both be specified')
  return Object.fromEntries(['before', 'after'].flatMap((key) => fields.has(key)
    ? [[key, sectionSymbol(optionalLiteral(fields.get(key), invalid), key, invalid)]] : []))
}

function browserLoader(
  input: ts.Expression, sourceBase: string, importBase: string, invalid: Invalid,
): SectionBrowserLoader {
  const arrow = unwrap(input)
  if (!ts.isArrowFunction(arrow) || arrow.parameters.length || ts.isBlock(arrow.body)) {
    return invalid('browser loaders must be zero-argument arrows returning literal imports')
  }
  const call = unwrap(arrow.body)
  if (!ts.isCallExpression(call) || call.expression.kind !== ts.SyntaxKind.ImportKeyword || call.arguments.length !== 1) {
    return invalid('browser loader must use a literal dynamic import')
  }
  const specifier = literalValue(call.arguments[0], 'browser loader', invalid)
  const relative = stripModuleCodeExtension(path.posix.normalize(specifier))
  if (!specifier.startsWith('./') || specifier.includes('\\') || relative.startsWith('../') || !relative.endsWith('.client')) {
    return invalid(`browser import "${specifier}" must resolve to an owning-module .client file`)
  }
  const candidate = MODULE_CODE_EXTENSIONS.map((extension) => path.join(sourceBase, relative + extension))
    .find((filename) => fs.existsSync(filename))
  if (!candidate) return invalid(`browser import "${specifier}" does not exist`)
  const fromBase = path.relative(fs.realpathSync(sourceBase), fs.realpathSync(candidate))
  if (fromBase.startsWith('..' + path.sep) || path.isAbsolute(fromBase)) return invalid('browser import escapes its module')
  return {
    importPath: importBase + '/' + relative,
    source: ts.createSourceFile(candidate, fs.readFileSync(candidate, 'utf8'), ts.ScriptTarget.Latest, true),
  }
}

function readStore(input: ts.Expression, fieldOverride: boolean, invalid: Invalid): SectionExtensionStore {
  const { name, args } = readSectionBuilder(input, invalid)
  switch (name) {
    case 'store.customField':
      if (args.length <= 1) return { kind: 'customField', fieldOverride,
        ...(args[0] ? { key: formLeaf(literalData(args[0], invalid), 'custom-field key', invalid) } : {}) }
      break
    case 'store.table':
      if (args.length === 1) {
        return { kind: 'table', fieldOverride, entityId: sectionSymbol(literalData(args[0], invalid), 'store entity', invalid) }
      }
      break
    case 'store.sink':
    case 'store.external':
      if (args.length === 1) {
        const configuration = unwrap(args[0])
        if (!ts.isObjectLiteralExpression(configuration)) break
        const propertyName = name === 'store.sink' ? 'entityId' : 'mirror'
        const property = configuration.properties.find((candidate): candidate is ts.PropertyAssignment =>
          ts.isPropertyAssignment(candidate) && (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name))
          && candidate.name.text === propertyName)
        const entityId = sectionSymbol(property && literalData(property.initializer, invalid), 'store entity', invalid)
        return { kind: name === 'store.sink' ? 'sink' : 'external', fieldOverride, entityId }
      }
      break
  }
  return invalid(`invalid store builder "${name}"`)
}

function parseFields(
  input: ts.Expression | undefined, sectionStore: SectionExtensionStore | undefined,
  sourceBase: string, importBase: string, invalid: Invalid,
): SectionExtensionField[] {
  if (!input) return invalid('missing field declarations')
  return [...fieldsOf(input, invalid)].map(([fieldId, declaration]) => {
    const id = formLeaf(fieldId, 'field id', invalid)
    const { name, args } = readSectionBuilder(declaration, invalid)
    if (name === 'field.remove' && !args.length) return { id, operation: 'remove', browser: {}, loaders: {}, rules: [], server: false }
    if ((name !== 'field.add' && name !== 'field.patch') || args.length !== 1) return invalid(`invalid builder for field "${id}"`)
    const operation = name === 'field.add' ? 'add' : 'patch'
    const fields = fieldsOf(args[0], invalid)
    const browser: Record<string, unknown> = safePlacement(fields, invalid)
    const loaders: SectionExtensionField['loaders'] = {}
    const store = operation === 'add'
      ? fields.get('store') ? readStore(fields.get('store')!, true, invalid) : sectionStore ?? { kind: 'customField' as const, fieldOverride: false }
      : undefined
    for (const [key, value] of fields) {
      if (['before', 'after', 'validate', 'store'].includes(key)) continue
      if (key === 'labelKey') browser[key] = labelKey(optionalLiteral(value, invalid), invalid)
      else if (key === 'options' && ts.isArrowFunction(unwrap(value))) loaders.options = browserLoader(value, sourceBase, importBase, invalid)
      else if (key === 'customComponent') loaders.component = browserLoader(value, sourceBase, importBase, invalid)
      else if (['type', 'required', 'options', 'readOnly', 'visibleWhen', 'optionsCacheTtl'].includes(key)) browser[key] = literalData(value, invalid)
      else invalid(`unsupported field option "${key}"`)
    }
    if (operation === 'add' && !['text', 'textarea', 'number', 'boolean', 'select', 'date', 'custom'].includes(String(browser.type))) {
      invalid(`unsupported field type for "${id}"`)
    }
    if (operation === 'patch' && (fields.has('type') || fields.has('required') || fields.has('store') || loaders.component)) {
      invalid(`cannot replace the schema or storage of field "${id}" using patch`)
    }
    const rules: CrudFormDeclarativeFieldConstraint[] = []
    const validation = fields.get('validate')
    let server = false
    if (validation) {
      const values = fieldsOf(validation, invalid)
      const callback = values.get('client')
      if (callback) loaders.clientRule = browserLoader(callback, sourceBase, importBase, invalid)
      server = values.has('server')
      for (const rule of arrayField(values, 'rules', invalid)) rules.push(literalData(rule, invalid) as CrudFormDeclarativeFieldConstraint)
      const inline = Object.fromEntries([...values].filter(([key]) => !['client', 'server', 'rules'].includes(key))
        .map(([key, value]) => [key, literalData(value, invalid)]))
      if (Object.keys(inline).length) rules.push(inline as CrudFormDeclarativeFieldConstraint)
    }
    for (const rule of rules) labelKey(rule.messageKey, invalid)
    const normalized = normalizeCrudFormFieldRules(rules)
    if (rules.length) browser.rules = rules
    return { id, operation, browser, loaders, rules: normalized, server, store }
  })
}

function inferDefaultReads(syntax: ts.Expression, invalid: Invalid): string[] {
  const input = unwrap(syntax)
  const definition = ts.isIdentifier(input) ? getLocalSectionInitializer(input.getSourceFile(), input.text)
    ?? input.getSourceFile().statements.find((statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === input.text) : input
  if (!definition || (!ts.isArrowFunction(definition) && !ts.isFunctionExpression(definition) && !ts.isFunctionDeclaration(definition))) {
    return invalid('a default must name a local callback with explicit payload reads')
  }
  const param = definition.parameters[0]?.name
  if (!param || !definition.body) return []
  const aliases = new Set<string>()
  const contextName = ts.isIdentifier(param) ? param.text : null
  if (ts.isObjectBindingPattern(param)) for (const binding of param.elements) {
    if ((binding.propertyName ?? binding.name).getText().replace(/^['"]|['"]$/g, '') === 'payload') {
      if (!ts.isIdentifier(binding.name)) return invalid('default payload binding must be a named object')
      aliases.add(binding.name.text)
    }
  }
  const paths = new Set<string>()
  function chain(node: ts.Node): { base: string; parts: string[] } | null {
    if (ts.isIdentifier(node)) return { base: node.text, parts: [] }
    if (ts.isPropertyAccessExpression(node)) {
      const prefix = chain(node.expression)
      return prefix && { ...prefix, parts: [...prefix.parts, node.name.text] }
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const prefix = chain(node.expression)
      return prefix && { ...prefix, parts: [...prefix.parts, node.argumentExpression.text] }
    }
    return null
  }
  function visit(node: ts.Node): void {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && (!node.parent || !(ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
          || node.parent.expression !== node)) {
      const access = chain(node)
      if (access) {
        const leaf = aliases.has(access.base) ? access.parts
          : access.base === contextName && access.parts[0] === 'payload' ? access.parts.slice(1) : undefined
        if (leaf) {
          if (!leaf.length) invalid('default must read a concrete payload path')
          paths.add(formLeaf(leaf.join('.'), 'default payload read', invalid))
          return
        }
      }
    }
    if (ts.isIdentifier(node) && aliases.has(node.text)) invalid('default cannot use its whole payload or a computed payload path')
    if (ts.isIdentifier(node) && node.text === contextName && (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node)) {
      invalid('default cannot use a computed context path')
    }
    ts.forEachChild(node, visit)
  }
  visit(definition.body)
  return [...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

export function parseSectionExtensionSources(
  initializer: ts.Expression | undefined, sourceBase: string, importPath: string, invalid: Invalid,
): SectionExtensionSource[] {
  if (!initializer) return []
  const array = unwrap(initializer)
  if (!ts.isArrayLiteralExpression(array)) return invalid('crudFormExtensions must be a literal array')
  const importBase = importPath.slice(0, importPath.lastIndexOf('/'))
  const hosts = new Set<string>()
  return array.elements.map((syntax, index) => {
    const { name, args } = readSectionBuilder(syntax, invalid)
    if (name !== 'defineCrudFormExtension' || args.length !== 1) return invalid('expected defineCrudFormExtension with one argument')
    const fields = fieldsOf(args[0], invalid)
    if ([...fields.keys()].some((key) => !['id', 'host', 'targets', 'sections', 'defaults'].includes(key))) return invalid('unexpected extension property')
    const id = sectionSymbol(optionalLiteral(fields.get('id'), invalid), 'extension id', invalid)
    const host = literalValue(fields.get('host'), 'host spot', invalid)
    if (!host.startsWith('crud-form:')) return invalid('extension host must be a crud-form: spot')
    const hostId = sectionSymbol(host.slice('crud-form:'.length), 'host id', invalid)
    if (hosts.has(hostId)) return invalid(`multiple extension definitions for host "${hostId}" in one module`)
    hosts.add(hostId)
    const targets = arrayField(fields, 'targets', invalid).map((target): SourceTarget => {
      const entries = fieldsOf(target, invalid)
      const formVariant = sectionSymbol(optionalLiteral(entries.get('formVariant'), invalid), 'form variant', invalid)
      const formOperation = optionalLiteral(entries.get('formOperation'), invalid)
      if (entries.size !== 2 || (formOperation !== 'create' && formOperation !== 'update')) return invalid('invalid extension target')
      return { formVariant, formOperation }
    })
    if (!targets.length || targets.length !== new Set(targets.map(({ formVariant, formOperation }) => formVariant + '/' + formOperation)).size) {
      return invalid('expected unique extension targets')
    }
    const raw = fields.get('sections')
    if (!raw) return invalid('missing extension sections')
    const changes = [...fieldsOf(raw, invalid)].map(([sectionId, declaration]): SectionExtensionChange => {
      const id = sectionSymbol(sectionId, 'section id', invalid)
      const { name, args } = readSectionBuilder(declaration, invalid)
      const base = { id, fields: [], syntax: declaration }
      if (name === 'hide' && !args.length) return { ...base, operation: 'hide' }
      if (name === 'replace' && args.length === 1) {
        return { ...base, operation: 'replace', replacement: browserLoader(args[0], sourceBase, importBase, invalid) }
      }
      if ((name !== 'modify' && name !== 'add') || args.length !== 1) return invalid(`invalid section builder for "${id}"`)
      const opts = fieldsOf(args[0], invalid)
      if ([...opts.keys()].some((key) => !(name === 'add' ? ['fields', 'before', 'after', 'store', 'titleKey'] : ['fields']).includes(key))) {
        return invalid(`unsupported options for section "${id}"`)
      }
      const sectionStore = opts.get('store') ? readStore(opts.get('store')!, false, invalid) : undefined
      const projected = parseFields(opts.get('fields'), sectionStore, sourceBase, importBase, invalid)
      const titleKey = opts.get('titleKey') ? labelKey(optionalLiteral(opts.get('titleKey'), invalid), invalid) : undefined
      if ((!projected.length && (name === 'modify' || !titleKey))
          || (name === 'add' && projected.some(({ operation }) => operation !== 'add'))) return invalid('invalid empty or non-add field declaration')
      return { ...base, ...safePlacement(opts, invalid), operation: name, fields: projected, titleKey }
    })
    if (!changes.length) return invalid('expected at least one section change')
    const defaultMap = fields.get('defaults')
    const defaults = defaultMap ? [...fieldsOf(defaultMap, invalid)].map(([key, syntax]) => ({
      payloadPath: formLeaf(key, 'default payload path', invalid), syntax, readsPayloadPaths: inferDefaultReads(syntax, invalid),
    })) : []
    return { index, id, hostId, targets, changes, defaults, syntax }
  })
}
