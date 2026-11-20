import type { CrudFormExtensionSinkFact, CrudFormSectionAddress } from '@open-mercato/shared/modules/form-section-facts'
import type {
  CrudFormLeafDefaultProvider,
  CrudFormSectionRuntimeLoader,
  CrudFormSectionSink,
} from '@open-mercato/shared/modules/form-sections'
import type { CrudFormSectionOutboxDelivery } from '@open-mercato/shared/lib/crud/form-sections/outbox'
import type { CustomFieldProps, FieldVisibilityRule, InjectionFieldDefinition } from '@open-mercato/shared/modules/widgets/injection'
import type { ComponentType } from 'react'

type Values = Readonly<Record<string, unknown>>
type Result = true | string
type Awaitable<T> = T | Promise<T>
type BrowserLoader<Module> = () => Promise<Module>
type DefaultContext = Parameters<CrudFormLeafDefaultProvider['resolve']>[0]

export type CrudFormExtensionFieldContext = Readonly<{
  address: Readonly<CrudFormSectionAddress>
  fieldId: string
  payloadPath: string
  values: Values
}>

export type CrudFormExtensionServerFieldContext = CrudFormExtensionFieldContext & Readonly<{
  scope: Readonly<DefaultContext['scope']>
  hostResourceKind: string
  hostResourceId?: string
  actorId: string
}>

export type CrudFormExtensionFieldRule<Context extends CrudFormExtensionFieldContext = CrudFormExtensionFieldContext> =
  (value: unknown, context: Context) => Awaitable<Result>

export type CrudFormExtensionOption = Readonly<{
  value: NonNullable<InjectionFieldDefinition['options']>[number]['value']
  labelKey: string
}>

type OptionResult = readonly CrudFormExtensionOption[]
type OptionSource = OptionResult | ((context: CrudFormExtensionFieldContext) => Awaitable<OptionResult>)
type OptionLoader = BrowserLoader<{ readonly default: OptionSource }>
type RuleLoader = BrowserLoader<{ readonly default: CrudFormExtensionFieldRule }>
type ComponentLoader = BrowserLoader<{ readonly default: ComponentType<CustomFieldProps> }>

type Placement =
  | { readonly before?: string; readonly after?: never }
  | { readonly before?: never; readonly after?: string }

export type CrudFormExtensionDeclarativeRule = Readonly<{
  messageKey: string
  enforce?: 'client' | 'client-and-server'
}> & (
  | { readonly required: true }
  | { readonly pattern: string }
  | { readonly minLength: number }
  | { readonly maxLength: number }
  | { readonly min: number }
  | { readonly max: number }
)

type DeclarativeRuleParams = Readonly<Partial<{
  required: true
  pattern: string
  minLength: number
  maxLength: number
  min: number
  max: number
}>>

type RuleCallbacks = Readonly<{
  rules?: readonly CrudFormExtensionDeclarativeRule[]
  client?: RuleLoader
  server?: CrudFormExtensionFieldRule<CrudFormExtensionServerFieldContext>
}>

export type CrudFormExtensionFieldValidation = RuleCallbacks & (
  | (CrudFormExtensionDeclarativeRule & DeclarativeRuleParams)
  | Readonly<{ required?: never; pattern?: never; minLength?: never; maxLength?: never; min?: never; max?: never; messageKey?: never; enforce?: never }>
)

type CustomFieldStore = Readonly<{ kind: 'customField'; key?: string }>
type TableStore = Readonly<{ kind: 'table'; entityId: string }>
type SinkConfig = Readonly<Omit<CrudFormSectionSink, 'fact' | 'capabilityId' | 'hostDetailEntityId' | 'outbox'>> & Readonly<{
  entityId: string
  atomicity: Exclude<CrudFormExtensionSinkFact['atomicity'], 'outbox'>
  optimisticLock?: CrudFormExtensionSinkFact['optimisticLock']
  undoMode?: CrudFormExtensionSinkFact['undo']
}>
type SinkStore = Readonly<{ kind: 'sink'; config: SinkConfig }>
type ExternalConfig = Readonly<Pick<CrudFormSectionOutboxDelivery, 'deliver' | 'validateExternal'>> & Readonly<{
  integrationId: string
  mirror: string
  contractId?: `${string}@v${number}`
  maxAttempts?: number
  failureNotificationType?: string
}>
type ExternalStore = Readonly<{ kind: 'external'; config: ExternalConfig }>

export type CrudFormExtensionStore = CustomFieldStore | TableStore | SinkStore | ExternalStore

type FieldPresentation = Readonly<Pick<InjectionFieldDefinition, 'labelKey' | 'readOnly' | 'optionsCacheTtl'>> & Placement & Readonly<{
  validate?: CrudFormExtensionFieldValidation
  visibleWhen?: Readonly<Omit<FieldVisibilityRule, 'value'> & {
    value?: string | number | boolean | null | readonly (string | number | boolean | null)[]
  }>
  label?: never
}>

export type CrudFormExtensionAddedField = FieldPresentation & Readonly<{
  required?: boolean
  store?: CrudFormExtensionStore
}> & (
  | { readonly type: 'select'; readonly options?: OptionResult | OptionLoader; readonly customComponent?: never }
  | { readonly type: 'custom'; readonly customComponent: ComponentLoader; readonly options?: never }
  | { readonly type: Exclude<InjectionFieldDefinition['type'], 'select' | 'custom'>; readonly options?: never; readonly customComponent?: never }
)

export type CrudFormExtensionFieldPatch = FieldPresentation & Readonly<{
  options?: OptionResult | OptionLoader
  type?: never
  store?: never
}>

type FieldAdd = Readonly<{ operation: 'add'; definition: CrudFormExtensionAddedField }>
type FieldPatch = Readonly<{ operation: 'patch'; patch: CrudFormExtensionFieldPatch }>
type FieldRemove = Readonly<{ operation: 'remove' }>
export type CrudFormExtensionFieldOperation = FieldAdd | FieldPatch | FieldRemove

type SectionAddOptions = Placement & Readonly<{
  titleKey?: string
  title?: never
  fields: Readonly<Record<string, FieldAdd>>
  store?: CrudFormExtensionStore
}>
type SectionModifyOptions = Readonly<{ fields: Readonly<Record<string, CrudFormExtensionFieldOperation>> }>
type SectionHide = Readonly<{ operation: 'hide' }>
type SectionReplace = Readonly<{ operation: 'replace'; load: CrudFormSectionRuntimeLoader }>
type SectionAdd = Readonly<{ operation: 'add'; options: SectionAddOptions }>
type SectionModify = Readonly<{ operation: 'modify'; options: SectionModifyOptions }>
export type CrudFormExtensionSectionOperation = SectionHide | SectionReplace | SectionAdd | SectionModify

export type CrudFormExtensionDefinition = Readonly<{
  id: string
  host: `crud-form:${string}`
  targets: readonly Readonly<Pick<CrudFormSectionAddress, 'formVariant' | 'formOperation'>>[]
  sections: Readonly<Record<string, CrudFormExtensionSectionOperation>>
  defaults?: Readonly<Record<string, CrudFormLeafDefaultProvider['resolve']>>
}>

export function defineCrudFormExtension<const Definition extends CrudFormExtensionDefinition>(definition: Definition): Definition {
  return definition
}

export function hide(): SectionHide {
  return { operation: 'hide' }
}

export function replace<const Load extends CrudFormSectionRuntimeLoader>(load: Load) {
  return { operation: 'replace', load } as const
}

export function add<const Options extends SectionAddOptions>(options: Options) {
  return { operation: 'add', options } as const
}

export function modify<const Options extends SectionModifyOptions>(options: Options) {
  return { operation: 'modify', options } as const
}

export const field = {
  add<const Definition extends CrudFormExtensionAddedField>(definition: Definition) {
    return { operation: 'add', definition } as const
  },
  patch<const Patch extends CrudFormExtensionFieldPatch>(patch: Patch) {
    return { operation: 'patch', patch } as const
  },
  remove(): FieldRemove {
    return { operation: 'remove' }
  },
}

export const store = {
  customField<const Key extends string | undefined = undefined>(key?: Key): CustomFieldStore & { readonly key?: Key } {
    return key === undefined ? { kind: 'customField' } : { kind: 'customField', key }
  },
  table<const EntityId extends string>(entityId: EntityId) {
    return { kind: 'table', entityId } as const
  },
  sink<const Config extends SinkConfig>(config: Config) {
    return { kind: 'sink', config } as const
  },
  external<const Config extends ExternalConfig>(config: Config) {
    return { kind: 'external', config } as const
  },
}
