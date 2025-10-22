import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'vector_search',
  title: 'Vector Search',
  version: '0.1.0',
  description: 'Centralized vector search index backed by pgvector and OpenAI embeddings.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['query_index'],
}
