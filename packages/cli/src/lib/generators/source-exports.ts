import ts from 'typescript-js'

export function sourceHasDefaultExport(sourceFile: string, source: string): boolean {
  const parsed = ts.createSourceFile(
    sourceFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFile.endsWith('.tsx') ? ts.ScriptKind.TSX : sourceFile.endsWith('.jsx') ? ts.ScriptKind.JSX : sourceFile.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  )

  for (const statement of parsed.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return true
    }

    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.some(
        (element) => element.name.text === 'default' || element.propertyName?.text === 'default',
      )
    ) {
      return true
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      return true
    }
  }

  return false
}

type SourceHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export function sourceExportedHttpMethods(source: string): SourceHttpMethod[] {
  const knownMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as SourceHttpMethod[]
  const exportedMethods = new Set<SourceHttpMethod>()
  const collectKnownMethods = (rawSpecifiers: string[], opts?: { useExportedAlias?: boolean; useDestructuredProperty?: boolean }) => {
    for (const specifier of rawSpecifiers) {
      const trimmed = specifier.trim()
      if (!trimmed) continue

      let candidate = trimmed
      if (opts?.useExportedAlias) {
        candidate = trimmed.split(/\s+as\s+/i).pop()?.trim() ?? trimmed
      }
      if (opts?.useDestructuredProperty) {
        candidate = trimmed.split(':')[0]?.trim() ?? trimmed
      }

      if (knownMethods.includes(candidate as SourceHttpMethod)) {
        exportedMethods.add(candidate as SourceHttpMethod)
      }
    }
  }

  for (const method of knownMethods) {
    const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+(?:const|let|var)\\s+${method}\\b`)
    if (pattern.test(source)) {
      exportedMethods.add(method)
    }
  }

  const reExportPattern = /export\s*{([^}]+)}/g
  for (const match of source.matchAll(reExportPattern)) {
    const exportBlock = match[1] ?? ''
    collectKnownMethods(
      exportBlock
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
      { useExportedAlias: true },
    )
  }

  const destructuredExportPattern = /export\s+(?:const|let|var)\s*{([^}]+)}/g
  for (const match of source.matchAll(destructuredExportPattern)) {
    const exportBlock = match[1] ?? ''
    collectKnownMethods(
      exportBlock
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
      { useDestructuredProperty: true },
    )
  }

  return knownMethods.filter((method) => exportedMethods.has(method))
}
