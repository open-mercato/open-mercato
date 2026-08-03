import { importedNamesFrom } from '../utils/ast-helpers.js'

export const requireStatusBadge = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require StatusBadge for status-like columns in DataTable',
    },
    messages: {
      useStatusBadge:
        'Status columns should render <StatusBadge> (with a StatusMap) for consistent visual treatment. Import from @open-mercato/ui/primitives/status-badge.',
    },
    schema: [],
  },
  create(context) {
    let hasStatusBadgeImport = false
    let hasBadgeImport = false
    let hasTagImport = false
    const statusColumnNodes = []

    return {
      ImportDeclaration(node) {
        const names = importedNamesFrom(node)
        if (names.includes('StatusBadge')) hasStatusBadgeImport = true
        if (names.includes('Badge')) hasBadgeImport = true
        if (names.includes('Tag')) hasTagImport = true
      },
      Property(node) {
        if (
          node.key?.name === 'accessorKey' &&
          node.value?.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          node.value.value.toLowerCase().includes('status')
        ) {
          statusColumnNodes.push(node)
        }
      },
      'Program:exit'() {
        if (statusColumnNodes.length === 0) return
        if (hasStatusBadgeImport || hasBadgeImport || hasTagImport) return
        for (const node of statusColumnNodes) {
          context.report({ node, messageId: 'useStatusBadge' })
        }
      },
    }
  },
}
