import type { AuthContext } from '../../lib/auth/server'
import type { AppContainer } from '../../lib/di/container'
import type { TranslateFn } from '../../lib/i18n/context'

export interface TemplateMeta {
  id: string
  label: string
  description: string
  module: string
  resourceKind: string
  documentType: string
  format: string
  tags: string[]
  note?: string
  requiredFeatures?: string[]
  version?: string
  versions?: string[]
}

export const DEFAULT_TEMPLATE_VERSION = '1'

export interface TemplateDataContext {
  locale: string
  translate?: TranslateFn
}

export interface DocumentFetchContext {
  container: AppContainer
  auth: AuthContext
}

export interface DocumentDataInput {
  data: Record<string, unknown>
}

export interface TemplateNormalizationInput {
  data: unknown
  locale: string
  translate: TranslateFn
}

export interface DocumentTemplateSource {
  type: string
  [key: string]: unknown
}

export interface TemplateVersionSource {
  version: string
  load: () => Promise<DocumentTemplateSource>
}

export interface TemplateRegistryEntry {
  fromRecord: (data: unknown, context: TemplateDataContext) => Record<string, unknown>
  filename: (input: DocumentDataInput) => string
  resourceId: (input: DocumentDataInput) => string
  resourceLabel?: (input: DocumentDataInput) => string | undefined
  load: () => Promise<DocumentTemplateSource>
  fetchData?: (input: { data: unknown }, context: DocumentFetchContext) => Promise<unknown>
  archivedVersions?: TemplateVersionSource[]
}

export type TemplateEntry = TemplateMeta & TemplateRegistryEntry

export type DocumentTemplateEntry = Omit<TemplateMeta, 'module' | 'resourceKind' | 'versions'>
  & Pick<TemplateRegistryEntry, 'filename' | 'load' | 'archivedVersions'>
