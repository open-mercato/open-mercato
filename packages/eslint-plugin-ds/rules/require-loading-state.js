const LOADING_COMPONENTS = new Set(['LoadingMessage', 'Spinner', 'DataLoader', 'Skeleton'])

export const requireLoadingState = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require explicit loading state handling in pages with async data calls',
    },
    messages: {
      missingLoadingState:
        'Pages using apiCall() must handle loading state. Use LoadingMessage from @open-mercato/ui/backend/detail, a Spinner/DataLoader, or pass isLoading to DataTable.',
    },
    schema: [],
  },
  create(context) {
    let hasApiCall = false
    let hasLoadingHandling = false
    let firstApiCallNode = null

    return {
      CallExpression(node) {
        const name = node.callee.type === 'Identifier' ? node.callee.name : null
        if (name === 'apiCall' || name === 'apiCallOrThrow' || name === 'readApiResultOrThrow') {
          hasApiCall = true
          firstApiCallNode = firstApiCallNode ?? node
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && LOADING_COMPONENTS.has(node.name.name)) {
          hasLoadingHandling = true
        }
      },
      JSXAttribute(node) {
        if (node.name?.name === 'isLoading') hasLoadingHandling = true
      },
      Identifier(node) {
        if (node.name === 'isLoading' || node.name === 'loading') hasLoadingHandling = true
      },
      'Program:exit'(node) {
        if (hasApiCall && !hasLoadingHandling) {
          context.report({ node: firstApiCallNode ?? node, messageId: 'missingLoadingState' })
        }
      },
    }
  },
}
