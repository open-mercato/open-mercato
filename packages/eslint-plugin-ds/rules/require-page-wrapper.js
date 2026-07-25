import { isBackendFile } from '../utils/ast-helpers.js'

export const requirePageWrapper = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Page and PageBody wrappers in backend page components',
    },
    messages: {
      missingPage:
        'Backend pages must wrap content in <Page><PageBody>…</PageBody></Page>. Import from @open-mercato/ui/backend/Page.',
      missingPageBody: 'Found <Page> without <PageBody> child.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()
    const isPageFile = /[\\/]page\.tsx?$/.test(filename)
    if (!isBackendFile(context) || !isPageFile) return {}

    let hasPageJSX = false
    let hasPageBodyJSX = false
    let hasDefaultExport = false
    let rendersJSX = false

    return {
      JSXOpeningElement(node) {
        rendersJSX = true
        if (node.name.type !== 'JSXIdentifier') return
        if (node.name.name === 'Page') hasPageJSX = true
        if (node.name.name === 'PageBody') hasPageBodyJSX = true
      },
      ExportDefaultDeclaration() {
        hasDefaultExport = true
      },
      'Program:exit'(node) {
        if (!hasDefaultExport || !rendersJSX) return
        if (!hasPageJSX) {
          context.report({ node, messageId: 'missingPage' })
        } else if (!hasPageBodyJSX) {
          context.report({ node, messageId: 'missingPageBody' })
        }
      },
    }
  },
}
