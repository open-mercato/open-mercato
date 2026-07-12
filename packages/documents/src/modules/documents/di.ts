import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  Document,
  DocumentAttachment,
  DocumentComment,
  DocumentContent,
  DocumentFolder,
  DocumentEntityLink,
  DocumentShare,
  DocumentTemplate,
  DocumentVersion,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    Document: asValue(Document),
    DocumentAttachment: asValue(DocumentAttachment),
    DocumentComment: asValue(DocumentComment),
    DocumentContent: asValue(DocumentContent),
    DocumentFolder: asValue(DocumentFolder),
    DocumentEntityLink: asValue(DocumentEntityLink),
    DocumentShare: asValue(DocumentShare),
    DocumentTemplate: asValue(DocumentTemplate),
    DocumentVersion: asValue(DocumentVersion),
  })
}

export default { register }
