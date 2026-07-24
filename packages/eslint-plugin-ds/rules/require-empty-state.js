const EMPTY_STATE_COMPONENTS = new Set(['EmptyState', 'ListEmptyState', 'TabEmptyState', 'FilteredEmptyResults', 'SearchEmptyResults'])

export const requireEmptyState = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require an empty state on pages that render DataTable',
    },
    messages: {
      missingEmptyState:
        'Pages with DataTable must handle the zero-data case. Pass the `emptyState` prop to DataTable or render EmptyState from @open-mercato/ui/backend/EmptyState.',
    },
    schema: [],
  },
  create(context) {
    let dataTableRendered = false
    let emptyStateHandled = false
    let firstDataTableNode = null

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return
        if (node.name.name === 'DataTable') {
          dataTableRendered = true
          firstDataTableNode = firstDataTableNode ?? node
        }
        if (EMPTY_STATE_COMPONENTS.has(node.name.name)) emptyStateHandled = true
      },
      JSXAttribute(node) {
        if (node.name?.name === 'emptyState') emptyStateHandled = true
      },
      'Program:exit'(node) {
        if (dataTableRendered && !emptyStateHandled) {
          context.report({ node: firstDataTableNode ?? node, messageId: 'missingEmptyState' })
        }
      },
    }
  },
}
