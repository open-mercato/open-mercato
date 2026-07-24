/**
 * `mercato module scaffold` orchestrator: parse flags → plan → write → report.
 * Spec: .ai/specs/2026-07-05-ds-module-ui-scaffold.md
 *
 * Rules enforced here (CLI AGENTS.md + spec):
 * - deterministic output: identical inputs produce byte-identical files
 *   (stable ordering, no timestamps);
 * - hard no-overwrite: if any target file exists, abort listing conflicts
 *   (exit 1) — `acl.ts` / `setup.ts` / `index.ts` are the exception: they are
 *   generated only when absent and otherwise reported, never touched;
 * - `--dry-run` prints the plan without writing.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { createResolver } from '../resolver'
import {
  FIELD_DSL_GRAMMAR,
  FieldDslError,
  buildFieldI18nEntries,
  camelCase,
  emitColumnLines,
  emitCrudFieldLines,
  emitFieldIdList,
  emitFilterDefLines,
  emitFilterParamLines,
  emitInitialValueLines,
  emitRowTypeLines,
  emitStatusMapEntries,
  emitStatusUnion,
  emitZodFieldLines,
  findStatusField,
  hasCheckboxField,
  humanizeIdentifier,
  parseFieldsSpec,
  pascalCase,
  selectFields,
  upperSnakeCase,
  type ScaffoldField,
} from './field-dsl'
import { ScaffoldTargetError, resolveScaffoldTarget, type ScaffoldTarget } from './targets'
import {
  aclTemplate,
  createMetaTemplate,
  createPageTemplate,
  detailMetaTemplate,
  detailPageTemplate,
  formConfigTemplate,
  listMetaTemplate,
  listPageTemplate,
  moduleIndexTemplate,
  setupTemplate,
  statusMapTemplate,
  validatorsTemplate,
} from './templates'

const MODULE_ID_PATTERN = /^[a-z][a-z0-9_]*$/
const FEATURES_PREFIX_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9]+)\}\}/g

export const SCAFFOLD_USAGE = [
  'Usage: yarn mercato module scaffold <module_id> --entity <entity_singular> --fields "<fields>" [options]',
  '',
  'Options:',
  '  --entity <name>            Singular entity name (snake_case) — drives file names,',
  '                             i18n key prefixes, StatusMap type and the API path.',
  '  --fields "<spec>"          Field DSL declaration (required, see grammar below).',
  '  --with-ui                  Generate the DS-compliant page slice (default: on).',
  '  --target <target>          app (default) → apps/mercato/src/modules/<module_id>/',
  '                             packages/core → packages/core/src/modules/<module_id>/',
  '  --features-prefix <p>      Feature-id prefix (default: <module_id>).',
  '  --dry-run                  Print the file plan without writing.',
  '',
  FIELD_DSL_GRAMMAR,
].join('\n')

export type ScaffoldOptions = {
  moduleId: string
  entity: string
  fields: ScaffoldField[]
  featuresPrefix: string
  target: string
  dryRun: boolean
}

export type ScaffoldPlanFile = {
  /** Path relative to the module directory (POSIX separators). */
  relPath: string
  contents: string
}

export type ScaffoldPlan = {
  moduleDir: string
  files: ScaffoldPlanFile[]
  /** Backbone files that already exist and are intentionally left untouched. */
  skipped: string[]
  /** Feature ids the generated pages reference. */
  expectedFeatures: string[]
}

export function renderTemplate(templateName: string, template: string, vars: Record<string, string>): string {
  const rendered = template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = vars[name]
    if (value === undefined) {
      throw new Error(`[scaffold] template "${templateName}" references unknown placeholder {{${name}}}`)
    }
    return value
  })
  const leftover = rendered.match(PLACEHOLDER_PATTERN)
  if (leftover) {
    throw new Error(`[scaffold] template "${templateName}" left unresolved placeholders: ${leftover.join(', ')}`)
  }
  return rendered
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

type ParsedArgs =
  | { ok: true; options: ScaffoldOptions }
  | { ok: false; error: string }

export function parseScaffoldArgs(args: string[]): ParsedArgs {
  let moduleId: string | null = null
  let entity: string | null = null
  let fieldsSpec: string | null = null
  let target = 'app'
  let featuresPrefix: string | null = null
  let dryRun = false

  const takesValue = new Set(['--entity', '--fields', '--target', '--features-prefix'])

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (takesValue.has(arg)) {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: `Flag ${arg} needs a value.` }
      }
      i++
      if (arg === '--entity') entity = value
      else if (arg === '--fields') fieldsSpec = value
      else if (arg === '--target') target = value
      else featuresPrefix = value
      continue
    }
    if (arg === '--with-ui') continue // default on
    if (arg === '--no-ui') {
      return {
        ok: false,
        error: '--no-ui is reserved for a future backbone-only mode and is not implemented yet.',
      }
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg.startsWith('-')) {
      return { ok: false, error: `Unknown flag "${arg}".` }
    }
    if (moduleId !== null) {
      return { ok: false, error: `Unexpected argument "${arg}" — module id already set to "${moduleId}".` }
    }
    moduleId = arg
  }

  if (!moduleId) return { ok: false, error: 'Missing <module_id>.' }
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    return { ok: false, error: `Invalid module id "${moduleId}" — expected plural snake_case matching ^[a-z][a-z0-9_]*$.` }
  }
  if (!entity) return { ok: false, error: 'Missing --entity <entity_singular>.' }
  if (!MODULE_ID_PATTERN.test(entity)) {
    return { ok: false, error: `Invalid entity name "${entity}" — expected singular snake_case matching ^[a-z][a-z0-9_]*$.` }
  }
  if (!fieldsSpec) return { ok: false, error: 'Missing --fields "<spec>".' }

  const prefix = featuresPrefix ?? moduleId
  if (!FEATURES_PREFIX_PATTERN.test(prefix)) {
    return { ok: false, error: `Invalid --features-prefix "${prefix}".` }
  }

  let fields: ScaffoldField[]
  try {
    fields = parseFieldsSpec(fieldsSpec)
  } catch (error) {
    if (error instanceof FieldDslError) return { ok: false, error: error.message }
    throw error
  }

  return {
    ok: true,
    options: { moduleId, entity, fields, featuresPrefix: prefix, target, dryRun },
  }
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

type TemplateVars = Record<string, string>

function buildTemplateVars(options: ScaffoldOptions): TemplateVars {
  const { moduleId, entity, fields, featuresPrefix } = options
  const entityPascal = pascalCase(entity)
  const entityCamel = camelCase(entity)
  const entityUpperSnake = upperSnakeCase(entity)
  const entityTitle = humanizeIdentifier(entity)
  const entityLower = entityTitle.toLowerCase()
  const moduleTitle = humanizeIdentifier(moduleId)
  const moduleTitleLower = moduleTitle.toLowerCase()

  const statusField = findStatusField(fields)
  const selects = selectFields(fields)
  const statusTypeIdent = statusField ? `${entityPascal}Status` : null
  const statusMapIdent = statusField ? `${entityCamel}StatusMap` : null

  const firstTextField = fields.find((field) => field.type === 'text') ?? null
  const detailTitleExpr = firstTextField
    ? firstTextField.required
      ? `record.${firstTextField.name}`
      : `record.${firstTextField.name} ?? record.id`
    : 'record.id'

  const statusBadgeProp = statusField
    ? [
        '          statusBadge={record.status ? (',
        `            <StatusBadge variant={${statusMapIdent}[record.status] ?? 'neutral'} dot>`,
        `              {t('${moduleId}.fields.status.options.' + record.status, record.status)}`,
        '            </StatusBadge>',
        '          ) : undefined}',
        '',
      ].join('\n')
    : ''

  const filtersMemo = selects.length
    ? [
        '  const filters = React.useMemo<FilterDef[]>(() => [',
        emitFilterDefLines(fields, moduleId),
        '  ], [t])',
        '',
        '',
      ].join('\n')
    : ''

  const filterProps = selects.length
    ? [
        '          filters={filters}',
        '          filterValues={filterValues}',
        '          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}',
        "          onFiltersClear={() => { setFilterValues({}); setPage(1) }}",
        '',
      ].join('\n')
    : ''

  return {
    moduleId,
    moduleTitle,
    moduleTitleLower,
    entityPascal,
    entityCamel,
    entityUpperSnake,
    entityTitle,
    entityLower,
    entitySnake: entity,
    featuresPrefix,
    rowTypeFields: emitRowTypeLines(fields, statusTypeIdent),
    columnsBlock: emitColumnLines(fields, moduleId, statusMapIdent),
    zodFields: emitZodFieldLines(fields),
    crudFields: emitCrudFieldLines(fields, moduleId),
    fieldIdList: emitFieldIdList(fields),
    initialValueLines: emitInitialValueLines(fields),
    detailTitleExpr,
    statusBadgeProp,
    statusUnion: statusField ? emitStatusUnion(statusField) : '',
    statusMapEntries: statusField ? emitStatusMapEntries(statusField) : '',
    statusImports: '', // overridden per page below
    filterTypeImport: selects.length
      ? "import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'\n"
      : '',
    filterStateLine: selects.length
      ? '  const [filterValues, setFilterValues] = React.useState<FilterValues>({})\n'
      : '',
    filterParamLines: selects.length ? `${emitFilterParamLines(fields)}\n` : '',
    listParamsDeps: selects.length ? '[filterValues, page, search]' : '[page, search]',
    filtersMemo,
    filterProps,
  }
}

function buildI18nEntries(options: ScaffoldOptions, vars: TemplateVars): Record<string, string> {
  const p = options.moduleId
  const entries: Record<string, string> = {
    [`${p}.nav.group`]: vars.moduleTitle,
    [`${p}.nav.title`]: vars.moduleTitle,
    [`${p}.list.title`]: vars.moduleTitle,
    [`${p}.list.searchPlaceholder`]: `Search ${vars.moduleTitleLower}`,
    [`${p}.list.actions.create`]: `Create ${vars.entityLower}`,
    [`${p}.list.actions.edit`]: 'Edit',
    [`${p}.list.actions.delete`]: 'Delete',
    [`${p}.list.empty.title`]: `No ${vars.moduleTitleLower} yet`,
    [`${p}.list.empty.description`]: `Create your first ${vars.entityLower} to get started.`,
    [`${p}.list.loadError`]: `Failed to load ${vars.moduleTitleLower}`,
    [`${p}.create.title`]: `Create ${vars.entityLower}`,
    [`${p}.create.success`]: `${vars.entityTitle} created`,
    [`${p}.form.submit`]: 'Save',
    [`${p}.form.groups.details`]: 'Details',
    [`${p}.form.groups.attributes`]: 'Attributes',
    [`${p}.delete.confirmTitle`]: `Delete ${vars.entityLower}?`,
    [`${p}.delete.confirmDescription`]: 'This action cannot be undone.',
    [`${p}.delete.success`]: `${vars.entityTitle} deleted`,
    [`${p}.delete.error`]: `Failed to delete ${vars.entityLower}`,
    [`${p}.detail.title`]: `${vars.entityTitle} details`,
    [`${p}.detail.loading`]: `Loading ${vars.entityLower}`,
    [`${p}.detail.notFound`]: `${vars.entityTitle} not found`,
    [`${p}.detail.loadError`]: `Failed to load ${vars.entityLower}`,
    [`${p}.detail.tabs.label`]: `${vars.entityTitle} sections`,
    [`${p}.detail.tabs.overview`]: 'Overview',
    [`${p}.detail.updateSuccess`]: `${vars.entityTitle} updated`,
    [`${p}.detail.actions.delete`]: 'Delete',
    ...buildFieldI18nEntries(options.fields, p),
  }
  if (hasCheckboxField(options.fields)) {
    entries[`${p}.list.boolean.yes`] = 'Yes'
    entries[`${p}.list.boolean.no`] = 'No'
  }
  return entries
}

function renderI18nJson(entries: Record<string, string>): string {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(entries).sort()) sorted[key] = entries[key]
  return `${JSON.stringify(sorted, null, 2)}\n`
}

export const NON_ENGLISH_LOCALES = ['pl', 'es', 'de'] as const

export function buildScaffoldPlan(options: ScaffoldOptions, target: ScaffoldTarget): ScaffoldPlan {
  const vars = buildTemplateVars(options)
  const statusField = findStatusField(options.fields)
  const { moduleId } = options

  const files: ScaffoldPlanFile[] = []
  const push = (relPath: string, templateName: string, template: string, overrides: TemplateVars = {}) => {
    files.push({
      relPath,
      contents: renderTemplate(templateName, template, { ...vars, ...overrides }),
    })
  }

  push(`backend/${moduleId}/page.tsx`, 'list-page', listPageTemplate, {
    statusImports: statusField
      ? `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'\n` +
        `import { ${vars.entityCamel}StatusMap, type ${vars.entityPascal}Status } from '../../components/statusMap'\n`
      : '',
  })
  push(`backend/${moduleId}/page.meta.ts`, 'list-meta', listMetaTemplate)
  push(`backend/${moduleId}/create/page.tsx`, 'create-page', createPageTemplate)
  push(`backend/${moduleId}/create/page.meta.ts`, 'create-meta', createMetaTemplate)
  push(`backend/${moduleId}/[id]/page.tsx`, 'detail-page', detailPageTemplate, {
    statusImports: statusField
      ? `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'\n` +
        `import { ${vars.entityCamel}StatusMap, type ${vars.entityPascal}Status } from '../../../components/statusMap'\n`
      : '',
  })
  push(`backend/${moduleId}/[id]/page.meta.ts`, 'detail-meta', detailMetaTemplate)
  push('components/formConfig.ts', 'form-config', formConfigTemplate)
  if (statusField) {
    push('components/statusMap.ts', 'status-map', statusMapTemplate)
  }
  push('data/validators.ts', 'validators', validatorsTemplate)

  // acl.ts / setup.ts / index.ts are generated only when absent — the UI slice
  // must reference real feature ids; an existing module is never appended to.
  const skipped: string[] = []
  const backbone: Array<[string, string, string]> = [
    ['acl.ts', 'acl', aclTemplate],
    ['setup.ts', 'setup', setupTemplate],
    ['index.ts', 'module-index', moduleIndexTemplate],
  ]
  for (const [relPath, templateName, template] of backbone) {
    if (fs.existsSync(path.join(target.moduleDir, relPath))) {
      skipped.push(relPath)
    } else {
      push(relPath, templateName, template)
    }
  }

  const i18nEntries = buildI18nEntries(options, vars)
  const i18nJson = renderI18nJson(i18nEntries)
  files.push({ relPath: 'i18n/en.json', contents: i18nJson })
  for (const locale of NON_ENGLISH_LOCALES) {
    // Identical key set with English values — key parity on day zero beats
    // missing files; `yarn i18n:check-values` nudges the actual translation.
    files.push({ relPath: `i18n/${locale}.json`, contents: i18nJson })
  }

  const expectedFeatures = ['view', 'create', 'edit', 'delete'].map(
    (verb) => `${options.featuresPrefix}.${verb}`,
  )

  return { moduleDir: target.moduleDir, files, skipped, expectedFeatures }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

type Logger = {
  log: (message: string) => void
  error: (message: string) => void
}

function printNextSteps(logger: Logger, target: ScaffoldTarget, options: ScaffoldOptions) {
  const modulesConfigHint =
    target.kind === 'app' ? 'apps/mercato/src/modules.ts' : 'apps/mercato/src/modules.ts (or the consuming app)'
  logger.log('Next steps:')
  logger.log(
    `  1. Enable the module:      add { id: '${options.moduleId}', from: '${target.registrationFrom}' } to ${modulesConfigHint}`,
  )
  logger.log('  2. Regenerate registries:  yarn generate')
  logger.log('  3. Wire the backend:       add data/entities.ts + api/ CRUD route, then yarn db:generate')
  logger.log('  4. Verify DS compliance:   yarn lint:ds')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type ScaffoldDeps = {
  resolver?: PackageResolver
  logger?: Logger
}

export async function runModuleScaffold(args: string[], deps: ScaffoldDeps = {}): Promise<number> {
  const logger: Logger = deps.logger ?? { log: console.log, error: console.error }

  const parsed = parseScaffoldArgs(args)
  if (!parsed.ok) {
    logger.error(`❌ ${parsed.error}`)
    logger.error('')
    logger.error(SCAFFOLD_USAGE)
    return 1
  }
  const options = parsed.options

  const resolver = deps.resolver ?? createResolver()

  let target: ScaffoldTarget
  try {
    target = resolveScaffoldTarget(resolver, options.target, options.moduleId)
  } catch (error) {
    if (error instanceof ScaffoldTargetError) {
      logger.error(`❌ ${error.message}`)
      return 1
    }
    throw error
  }

  const plan = buildScaffoldPlan(options, target)
  const rootDir = resolver.getRootDir()
  const relModuleDir = path.relative(rootDir, target.moduleDir) || target.moduleDir

  if (options.dryRun) {
    logger.log(`Plan for module "${options.moduleId}" → ${relModuleDir} (dry run, nothing written):`)
    for (const file of plan.files) {
      const conflict = fs.existsSync(path.join(target.moduleDir, file.relPath))
      logger.log(conflict ? `  ! ${file.relPath} (conflict — a real run would abort)` : `  + ${file.relPath}`)
    }
    for (const relPath of plan.skipped) {
      logger.log(`  = ${relPath} (exists, left untouched)`)
    }
    if (plan.skipped.length > 0) {
      logger.log(`Pages expect features: ${plan.expectedFeatures.join(', ')}`)
    }
    logger.log('')
    printNextSteps(logger, target, options)
    return 0
  }

  // Hard no-overwrite rule: collect every conflict, then abort with exit 1.
  const conflicts = plan.files
    .map((file) => file.relPath)
    .filter((relPath) => fs.existsSync(path.join(target.moduleDir, relPath)))
  if (conflicts.length > 0) {
    logger.error(`❌ Scaffold aborted — target files already exist under ${relModuleDir}:`)
    for (const relPath of conflicts) {
      logger.error(`  ${relPath}`)
    }
    logger.error('No files were written. Remove the conflicting files or pick a different module id.')
    return 1
  }

  const written: string[] = []
  try {
    for (const file of plan.files) {
      const absPath = path.join(target.moduleDir, file.relPath)
      fs.mkdirSync(path.dirname(absPath), { recursive: true })
      fs.writeFileSync(absPath, file.contents, { flag: 'wx' })
      written.push(file.relPath)
    }
  } catch (error) {
    logger.error(`❌ Scaffold failed mid-write: ${error instanceof Error ? error.message : String(error)}`)
    if (written.length > 0) {
      logger.error(`Files already written (remove them before retrying):`)
      for (const relPath of written) logger.error(`  ${relPath}`)
    }
    return 1
  }

  logger.log(`\n✅ Module "${options.moduleId}" UI slice scaffolded → ${relModuleDir}\n`)
  logger.log('Created:')
  for (const file of plan.files) {
    logger.log(`  ${file.relPath}`)
  }
  if (plan.skipped.length > 0) {
    logger.log('Skipped (already present, left untouched):')
    for (const relPath of plan.skipped) {
      logger.log(`  ${relPath}`)
    }
    logger.log(`  → pages expect features: ${plan.expectedFeatures.join(', ')}`)
  }
  logger.log('')
  logger.log(`Locales ${NON_ENGLISH_LOCALES.join(', ')} were generated with English values — needs translation.`)
  logger.log('')
  printNextSteps(logger, target, options)
  return 0
}
