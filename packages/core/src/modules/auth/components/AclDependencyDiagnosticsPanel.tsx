"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  applyAddMissingDependency,
  applyRemoveDependents,
  applyRestoreDependency,
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'

export type AclDependencyDiagnosticsPanelProps = {
  granted: readonly string[]
  catalog: readonly FeatureDescriptor[]
  onGrantedChange: (updater: (prev: string[]) => string[]) => void
  hideUnknownReferences?: boolean
}

export function AclDependencyDiagnosticsPanel({
  granted,
  catalog,
  onGrantedChange,
  hideUnknownReferences,
}: AclDependencyDiagnosticsPanelProps) {
  const t = useT()
  const diagnostics = React.useMemo(
    () => resolveAclDependencyDiagnostics(granted, catalog),
    [granted, catalog],
  )
  const titleById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of catalog) {
      if (entry?.title && !map.has(entry.id)) map.set(entry.id, entry.title)
    }
    return map
  }, [catalog])
  const featureLabel = React.useCallback((id: string) => titleById.get(id) ?? id, [titleById])

  const hasMissing = diagnostics.missingDependencies.length > 0
  const hasOrphaned = diagnostics.orphanedDependents.length > 0
  const showUnknown = !hideUnknownReferences && diagnostics.unknownReferences.length > 0
  if (!hasMissing && !hasOrphaned && !showUnknown) return null

  const handleAdd = (dep: string) => onGrantedChange((prev) => applyAddMissingDependency(prev, dep))
  const handleRestore = (dep: string) => onGrantedChange((prev) => applyRestoreDependency(prev, dep))
  const handleDropDependents = (dependents: readonly string[]) =>
    onGrantedChange((prev) => applyRemoveDependents(prev, dependents))

  return (
    <div className="space-y-3" data-testid="acl-dependency-diagnostics">
      {hasMissing && (
        <Alert status="warning" style="lighter">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {t(
                'auth.acl.deps.missing.title',
                'Some granted permissions need other permissions to work:',
              )}
            </div>
            <ul className="space-y-1 text-sm">
              {diagnostics.missingDependencies.map((row) => (
                <li
                  key={row.feature}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  data-testid={`missing-${row.feature}`}
                >
                  <span>
                    {t('auth.acl.deps.missing.item', '"{feature}" needs:', {
                      feature: featureLabel(row.feature),
                    })}
                  </span>
                  {row.missing.map((dep) => (
                    <span key={dep} className="inline-flex items-center gap-1">
                      <span className="font-mono text-xs text-muted-foreground">
                        {featureLabel(dep)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleAdd(dep)}
                        data-testid={`add-missing-${row.feature}-${dep}`}
                      >
                        {t('auth.acl.deps.missing.add', 'Add "{dep}"', {
                          dep: featureLabel(dep),
                        })}
                      </Button>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      {hasOrphaned && (
        <Alert status="warning" style="lighter">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {t(
                'auth.acl.deps.orphaned.title',
                'Removing a permission that other granted permissions need:',
              )}
            </div>
            <ul className="space-y-1 text-sm">
              {diagnostics.orphanedDependents.map((row) => (
                <li
                  key={row.dependency}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  data-testid={`orphaned-${row.dependency}`}
                >
                  <span>
                    {t('auth.acl.deps.orphaned.item', '"{dependency}" is required by:', {
                      dependency: featureLabel(row.dependency),
                    })}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.dependents
                      .map((dependent) => featureLabel(dependent))
                      .join(', ')}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleRestore(row.dependency)}
                    data-testid={`restore-${row.dependency}`}
                  >
                    {t('auth.acl.deps.orphaned.restore', 'Restore "{dependency}"', {
                      dependency: featureLabel(row.dependency),
                    })}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleDropDependents(row.dependents)}
                    data-testid={`drop-dependents-${row.dependency}`}
                  >
                    {t('auth.acl.deps.orphaned.drop', 'Drop dependents')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      {showUnknown && (
        <Alert status="warning" style="lighter">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {t(
                'auth.acl.deps.unknown.title',
                'Some declared dependencies do not match any known permission:',
              )}
            </div>
            <ul className="space-y-1 text-sm font-mono text-xs text-muted-foreground">
              {diagnostics.unknownReferences.map((row) => (
                <li key={row.feature} data-testid={`unknown-${row.feature}`}>
                  {row.feature} → {row.missing.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}
    </div>
  )
}
