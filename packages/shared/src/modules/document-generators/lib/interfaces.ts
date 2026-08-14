import type { AuthContext } from '../../../lib/auth/server'
import type { AppContainer } from '../../../lib/di/container'
import type { TranslateFn } from '../../../lib/i18n/context'

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
}

export interface DocumentTemplateSource {
  type: string
  [key: string]: unknown
}

export interface TemplateDataContext {
  locale: string
  translate?: TranslateFn
}

export interface TemplateRegistryEntry {
  fromRecord: (data: unknown, context: TemplateDataContext) => Record<string, unknown>
  filename: (input: { data: Record<string, unknown> }) => string
  resourceId: (input: { data: Record<string, unknown> }) => string
  resourceLabel?: (input: { data: Record<string, unknown> }) => string | undefined
  load: () => Promise<DocumentTemplateSource>
  fetchData?: (
    input: { data: unknown },
    context: { container: AppContainer; auth: AuthContext | null },
  ) => Promise<unknown>
}

export type TemplateEntry = TemplateMeta & TemplateRegistryEntry
