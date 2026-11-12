import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const repoRoot = resolve(__dirname, '../../../..')

const channelOmissionExceptions: Record<string, string> = {
  'packages/core/src/modules/push_notifications/notifications.ts#admin.custom_message':
    'Hidden one-off admin push type that bypasses the user-configurable catalogue and targets push explicitly at send time.',
  'packages/core/src/modules/push_notifications/notifications.ts#admin.custom_silent':
    'Hidden one-off silent admin push type that bypasses the user-configurable catalogue and targets push explicitly at send time.',
}

type NotificationDeclaration = {
  type: string
  channels: string[] | null
  hiddenFromSettings: boolean
}

type DiscoveredNotification = NotificationDeclaration & {
  relativePath: string
}

function toRepoRelative(fullPath: string): string {
  return relative(repoRoot, fullPath).split(sep).join('/')
}

function workspaceModuleRoots(workspacesRoot: string): string[] {
  return readdirSync(workspacesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => join(workspacesRoot, entry.name, 'src', 'modules'))
    .filter((modulesRoot) => existsSync(modulesRoot))
}

function collectNotificationCatalogs(modulesRoot: string, catalogs: string[]): void {
  if (!existsSync(modulesRoot)) return
  for (const moduleEntry of readdirSync(modulesRoot, { withFileTypes: true })) {
    if (!moduleEntry.isDirectory() || moduleEntry.isSymbolicLink()) continue
    const catalogPath = join(modulesRoot, moduleEntry.name, 'notifications.ts')
    if (existsSync(catalogPath)) catalogs.push(toRepoRelative(catalogPath))
  }
}

function discoverNotificationCatalogs(): string[] {
  const catalogs: string[] = []
  const moduleRoots = [
    ...workspaceModuleRoots(resolve(repoRoot, 'packages')),
    ...workspaceModuleRoots(resolve(repoRoot, 'apps')),
    resolve(repoRoot, 'packages/create-app/template/src/modules'),
  ]
  for (const modulesRoot of moduleRoots) collectNotificationCatalogs(modulesRoot, catalogs)
  return catalogs.sort()
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

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function notificationTypeArray(sourceFile: ts.SourceFile, relativePath: string): ts.ArrayLiteralExpression {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'notificationTypes') continue
      if (declaration.initializer) {
        const initializer = unwrapExpression(declaration.initializer)
        if (ts.isArrayLiteralExpression(initializer)) return initializer
      }
    }
  }
  throw new Error(`[internal] ${relativePath} does not export a literal notificationTypes array`)
}

function stringConstants(sourceFile: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const initializer = unwrapExpression(declaration.initializer)
      if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
        constants.set(declaration.name.text, initializer.text)
      }
    }
  }
  return constants
}

function stringValue(
  initializer: ts.Expression,
  constants: Map<string, string>,
  relativePath: string,
): string {
  const valueExpression = unwrapExpression(initializer)
  if (ts.isStringLiteral(valueExpression) || ts.isNoSubstitutionTemplateLiteral(valueExpression)) {
    return valueExpression.text
  }
  if (ts.isIdentifier(valueExpression)) {
    const value = constants.get(valueExpression.text)
    if (value !== undefined) return value
  }
  throw new Error(`[internal] ${relativePath} contains a notification type without a resolvable string id`)
}

function channelsValue(
  property: ts.PropertyAssignment | undefined,
  relativePath: string,
): string[] | null {
  if (!property) return null
  const initializer = unwrapExpression(property.initializer)
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(`[internal] ${relativePath} contains a non-array channels declaration`)
  }
  return initializer.elements.map((channel) => {
    const channelExpression = unwrapExpression(channel)
    if (!ts.isStringLiteral(channelExpression)) {
      throw new Error(`[internal] ${relativePath} contains a non-string channel id`)
    }
    return channelExpression.text
  })
}

function hiddenFromSettingsValue(
  property: ts.PropertyAssignment | undefined,
  relativePath: string,
): boolean {
  if (!property) return false
  const initializer = unwrapExpression(property.initializer)
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  throw new Error(`[internal] ${relativePath} contains a non-boolean hiddenFromSettings declaration`)
}

function declaredNotifications(relativePath: string): NotificationDeclaration[] {
  const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const constants = stringConstants(sourceFile)
  return notificationTypeArray(sourceFile, relativePath).elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(`[internal] ${relativePath} contains a non-object notification type`)
    }
    const typeProperty = findProperty(element, 'type')
    if (!typeProperty) {
      throw new Error(`[internal] ${relativePath} contains a notification type without an id`)
    }
    return {
      type: stringValue(typeProperty.initializer, constants, relativePath),
      channels: channelsValue(findProperty(element, 'channels'), relativePath),
      hiddenFromSettings: hiddenFromSettingsValue(
        findProperty(element, 'hiddenFromSettings'),
        relativePath,
      ),
    }
  })
}

const notificationCatalogs = discoverNotificationCatalogs()
const notifications: DiscoveredNotification[] = notificationCatalogs.flatMap((relativePath) =>
  declaredNotifications(relativePath).map((notification) => ({ ...notification, relativePath })),
)

function omissionExceptionKey(notification: DiscoveredNotification): string {
  return `${notification.relativePath}#${notification.type}`
}

describe('user-configurable built-in notification channel eligibility', () => {
  it('discovers module-root notification catalogues across packages, enterprise, and apps', () => {
    expect(notificationCatalogs.length).toBeGreaterThan(0)
    expect(notificationCatalogs).toEqual(expect.arrayContaining([
      'apps/mercato/src/modules/example/notifications.ts',
      'packages/core/src/modules/auth/notifications.ts',
      'packages/create-app/template/src/modules/example/notifications.ts',
      'packages/enterprise/src/modules/record_locks/notifications.ts',
      'packages/enterprise/src/modules/security/notifications.ts',
    ]))
  })

  it('requires every catalogue type to declare its intended channels or a documented hidden exception', () => {
    const violations: string[] = []
    for (const notification of notifications) {
      if (notification.channels) {
        if (notification.channels.length === 0) {
          violations.push(`${notification.relativePath}: ${notification.type} declares an empty channels array`)
        }
        continue
      }
      const reason = channelOmissionExceptions[omissionExceptionKey(notification)]
      if (!notification.hiddenFromSettings) {
        violations.push(`${notification.relativePath}: ${notification.type} is user-configurable but omits channels`)
      } else if (!reason?.trim()) {
        violations.push(`${notification.relativePath}: ${notification.type} omits channels without a documented exception`)
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps omission exceptions documented, hidden, and live', () => {
    const violations: string[] = []
    for (const [exceptionKey, reason] of Object.entries(channelOmissionExceptions)) {
      if (!reason.trim()) violations.push(`${exceptionKey} has an empty omission reason`)
      const notification = notifications.find(
        (candidate) => omissionExceptionKey(candidate) === exceptionKey,
      )
      if (!notification) {
        violations.push(`${exceptionKey} omission exception is stale`)
      } else if (notification.channels || !notification.hiddenFromSettings) {
        violations.push(`${exceptionKey} no longer matches the hidden channel-omission contract`)
      }
    }
    expect(violations).toEqual([])
  })
})
