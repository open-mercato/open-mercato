import { isBackendFile } from '../utils/ast-helpers.js'

const RAW_TABLE_ELEMENTS = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th'])

export const noRawTable = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw HTML table elements in backend pages',
    },
    messages: {
      noRawTable:
        'Do not use raw <{{element}}> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table.',
    },
    schema: [],
  },
  create(context) {
    if (!isBackendFile(context)) return {}
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && RAW_TABLE_ELEMENTS.has(node.name.name)) {
          context.report({
            node,
            messageId: 'noRawTable',
            data: { element: node.name.name },
          })
        }
      },
    }
  },
}
