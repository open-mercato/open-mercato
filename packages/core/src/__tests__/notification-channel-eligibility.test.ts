import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const repoRoot = resolve(__dirname, '../../../..')

const expectedChannelsByFile: Record<string, Record<string, string[]>> = {
  'packages/ai-assistant/src/modules/ai_assistant/notifications.ts': {
    'ai_assistant.conversation_shared': ['in_app', 'email'],
  },
  'packages/checkout/src/modules/checkout/notifications.ts': {
    'checkout.transaction.completed': ['in_app', 'email'],
    'checkout.transaction.failed': ['in_app', 'email'],
    'checkout.link.usageLimitReached': ['in_app', 'email'],
  },
  'packages/core/src/modules/eudr/notifications.ts': {
    'eudr.statement.submitted': ['in_app', 'email'],
    'eudr.statement.reference_issued': ['in_app', 'email'],
    'eudr.statement.withdrawn': ['in_app', 'email'],
    'eudr.risk.non_negligible': ['in_app', 'email'],
    'eudr.mitigation.completed': ['in_app', 'email'],
  },
  'packages/core/src/modules/warranty_claims/notifications.ts': {
    'warranty_claims.claim.submitted': ['in_app', 'email'],
    'warranty_claims.claim.assigned': ['in_app', 'email'],
    'warranty_claims.claim.status_changed': ['in_app', 'email'],
    'warranty_claims.claim.escalated': ['in_app', 'email'],
    'warranty_claims.claim.customer_replied': ['in_app', 'email'],
  },
  'packages/core/src/modules/wms/notifications.ts': {
    'wms.inventory.low_stock': ['in_app', 'email'],
    'wms.inventory.reservation_shortfall': ['in_app', 'email'],
  },
  'packages/documents/src/modules/documents/notifications.ts': {
    'documents.comment.mentioned': ['in_app', 'email'],
    'documents.watch.commented': ['in_app', 'email'],
    'documents.watch.changed': ['in_app', 'email'],
  },
  'packages/webhooks/src/modules/webhooks/notifications.ts': {
    'webhooks.delivery.failed': ['in_app', 'email'],
  },
  'apps/mercato/src/modules/example/notifications.ts': {
    'demo.silent_ping': ['push'],
    'demo.push_playground': ['push'],
    'example.umes.actionable': ['in_app', 'email'],
  },
  'packages/create-app/template/src/modules/example/notifications.ts': {
    'demo.silent_ping': ['push'],
    'demo.push_playground': ['push'],
    'example.umes.actionable': ['in_app', 'email'],
  },
}

function propertyName(property: ts.PropertyName): string | null {
  return ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : null
}

function findProperty(
  declaration: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return declaration.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === name,
  )
}

function notificationTypeArray(sourceFile: ts.SourceFile): ts.ArrayLiteralExpression {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'notificationTypes') continue
      if (declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer)) {
        return declaration.initializer
      }
    }
  }
  throw new Error('[internal] notificationTypes array not found')
}

function declaredChannels(relativePath: string): Record<string, string[] | null> {
  const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const entries = notificationTypeArray(sourceFile).elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(`[internal] ${relativePath} contains a non-object notification type`)
    }
    const typeProperty = findProperty(element, 'type')
    if (!typeProperty || !ts.isStringLiteral(typeProperty.initializer)) {
      throw new Error(`[internal] ${relativePath} contains a notification type without a string id`)
    }
    const channelsProperty = findProperty(element, 'channels')
    if (!channelsProperty) return [typeProperty.initializer.text, null] as const
    if (!ts.isArrayLiteralExpression(channelsProperty.initializer)) {
      throw new Error(`[internal] ${relativePath} contains a non-array channels declaration`)
    }
    const channels = channelsProperty.initializer.elements.map((channel) => {
      if (!ts.isStringLiteral(channel)) {
        throw new Error(`[internal] ${relativePath} contains a non-string channel id`)
      }
      return channel.text
    })
    return [typeProperty.initializer.text, channels] as const
  })
  return Object.fromEntries(entries)
}

describe('user-configurable built-in notification channel eligibility', () => {
  it.each(Object.entries(expectedChannelsByFile))(
    'keeps every type in %s explicit',
    (relativePath, expectedChannels) => {
      expect(declaredChannels(relativePath)).toEqual(expectedChannels)
    },
  )
})
