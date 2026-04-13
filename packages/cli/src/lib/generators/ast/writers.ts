import type { CodeBlockWriter, WriterFunction } from 'ts-morph'

export type GeneratedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | WriterFunction

export interface ObjectPropertyWriter {
  kind?: 'property'
  name: string
  value: GeneratedValue
}

export interface SpreadPropertyWriter {
  kind: 'spread'
  value: GeneratedValue
}

export type GeneratedObjectEntry = ObjectPropertyWriter | SpreadPropertyWriter
export type StatementWriter = WriterFunction

export function writeLiteral(writer: CodeBlockWriter, value: Exclude<GeneratedValue, WriterFunction>): void {
  if (value === undefined) {
    writer.write('undefined')
    return
  }

  if (value === null) {
    writer.write('null')
    return
  }

  if (typeof value === 'string') {
    writer.write(JSON.stringify(value))
    return
  }

  writer.write(String(value))
}

export function writeValue(writer: CodeBlockWriter, value: GeneratedValue): void {
  if (typeof value === 'function') {
    value(writer)
    return
  }

  writeLiteral(writer, value)
}

export function writeCommaSeparated<T>(
  writer: CodeBlockWriter,
  items: readonly T[],
  writeItem: (writer: CodeBlockWriter, item: T, index: number) => void,
): void {
  items.forEach((item, index) => {
    if (index > 0) {
      writer.write(', ')
    }
    writeItem(writer, item, index)
  })
}

export function writeArrayLiteral<T>(
  writer: CodeBlockWriter,
  items: readonly T[],
  writeItem: (writer: CodeBlockWriter, item: T, index: number) => void,
): void {
  if (items.length === 0) {
    writer.write('[]')
    return
  }

  writer.write('[')
  writer.newLine()
  writer.indent(() => {
    items.forEach((item, index) => {
      writeItem(writer, item, index)
      if (index < items.length - 1) {
        writer.write(',')
      }
      writer.newLine()
    })
  })
  writer.write(']')
}

export function arrayLiteral<T>(
  items: readonly T[],
  writeItem: (writer: CodeBlockWriter, item: T, index: number) => void,
): WriterFunction {
  return (writer) => {
    writeArrayLiteral(writer, items, writeItem)
  }
}

export function writeObjectLiteral(
  writer: CodeBlockWriter,
  entries: readonly GeneratedObjectEntry[],
): void {
  if (entries.length === 0) {
    writer.write('{}')
    return
  }

  writer.write('{')
  writer.newLine()
  writer.indent(() => {
    entries.forEach((entry, index) => {
      if (entry.kind === 'spread') {
        writer.write('...')
        writeValue(writer, entry.value)
      } else {
        writer.write(entry.name)
        writer.write(': ')
        writeValue(writer, entry.value)
      }

      if (index < entries.length - 1) {
        writer.write(',')
      }
      writer.newLine()
    })
  })
  writer.write('}')
}

export function objectLiteral(entries: readonly GeneratedObjectEntry[]): WriterFunction {
  return (writer) => {
    writeObjectLiteral(writer, entries)
  }
}

export function parenthesized(value: GeneratedValue): WriterFunction {
  return (writer) => {
    writer.write('(')
    writeValue(writer, value)
    writer.write(')')
  }
}

export function callExpression(callee: GeneratedValue, args: readonly GeneratedValue[]): WriterFunction {
  return (writer) => {
    writeValue(writer, callee)
    writer.write('(')
    writeCommaSeparated(writer, args, writeValue)
    writer.write(')')
  }
}

export function importExpression(moduleSpecifier: GeneratedValue): WriterFunction {
  return (writer) => {
    writer.write('import(')
    writeValue(writer, moduleSpecifier)
    writer.write(')')
  }
}

export function awaitExpression(value: GeneratedValue): WriterFunction {
  return (writer) => {
    writer.write('await ')
    writeValue(writer, value)
  }
}

export function identifier(name: string): WriterFunction {
  return (writer) => {
    writer.write(name)
  }
}

export function propertyAccess(target: GeneratedValue, property: string): WriterFunction {
  return (writer) => {
    writeValue(writer, target)
    writer.write('.')
    writer.write(property)
  }
}

export function prefixExpression(operator: string, value: GeneratedValue): WriterFunction {
  return (writer) => {
    writer.write(operator)
    writeValue(writer, value)
  }
}

export function optionalPropertyAccess(target: GeneratedValue, property: string): WriterFunction {
  return (writer) => {
    writeValue(writer, target)
    writer.write('?.')
    writer.write(property)
  }
}

export function elementAccess(target: GeneratedValue, index: GeneratedValue): WriterFunction {
  return (writer) => {
    writeValue(writer, target)
    writer.write('[')
    writeValue(writer, index)
    writer.write(']')
  }
}

export function spreadExpression(value: GeneratedValue): WriterFunction {
  return (writer) => {
    writer.write('...')
    writeValue(writer, value)
  }
}

export function asExpression(value: GeneratedValue, type: string): WriterFunction {
  return (writer) => {
    writer.write('(')
    writeValue(writer, value)
    writer.write(' as ')
    writer.write(type)
    writer.write(')')
  }
}

export function nonNullAssertion(value: GeneratedValue): WriterFunction {
  return (writer) => {
    writeValue(writer, value)
    writer.write('!')
  }
}

export function binaryExpression(left: GeneratedValue, operator: string, right: GeneratedValue): WriterFunction {
  return (writer) => {
    writeValue(writer, left)
    writer.write(` ${operator} `)
    writeValue(writer, right)
  }
}

export function conditionalExpression(
  condition: GeneratedValue,
  whenTrue: GeneratedValue,
  whenFalse: GeneratedValue,
): WriterFunction {
  return (writer) => {
    writeValue(writer, condition)
    writer.write(' ? ')
    writeValue(writer, whenTrue)
    writer.write(' : ')
    writeValue(writer, whenFalse)
  }
}

export function logicalAnd(expressions: readonly GeneratedValue[]): WriterFunction {
  return (writer) => {
    expressions.forEach((expression, index) => {
      if (index > 0) {
        writer.write(' && ')
      }
      writeValue(writer, expression)
    })
  }
}

export function logicalOr(expressions: readonly GeneratedValue[]): WriterFunction {
  return (writer) => {
    expressions.forEach((expression, index) => {
      if (index > 0) {
        writer.write(' || ')
      }
      writeValue(writer, expression)
    })
  }
}

export function nullishCoalesce(expressions: readonly GeneratedValue[]): WriterFunction {
  return (writer) => {
    expressions.forEach((expression, index) => {
      if (index > 0) {
        writer.write(' ?? ')
      }
      writeValue(writer, expression)
    })
  }
}

export function methodCall(target: GeneratedValue, method: string, args: readonly GeneratedValue[]): WriterFunction {
  return callExpression(propertyAccess(target, method), args)
}

export function newExpression(callee: GeneratedValue, args: readonly GeneratedValue[]): WriterFunction {
  return (writer) => {
    writer.write('new ')
    writeValue(writer, callee)
    writer.write('(')
    writeCommaSeparated(writer, args, writeValue)
    writer.write(')')
  }
}

export function invokeImmediately(expression: GeneratedValue): WriterFunction {
  return callExpression(parenthesized(expression), [])
}

export function templateLiteral(parts: readonly GeneratedValue[]): WriterFunction {
  return (writer) => {
    writer.write('`')
    parts.forEach((part) => {
      if (typeof part === 'string') {
        writer.write(part.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${'))
        return
      }

      writer.write('${')
      writeValue(writer, part)
      writer.write('}')
    })
    writer.write('`')
  }
}

export function writeStatements(writer: CodeBlockWriter, statements: readonly StatementWriter[]): void {
  statements.forEach((statement, index) => {
    statement(writer)
    if (index < statements.length - 1) {
      writer.newLine()
    }
  })
}

export function returnStatement(expression?: GeneratedValue): StatementWriter {
  return (writer) => {
    writer.write('return')
    if (expression !== undefined) {
      writer.write(' ')
      writeValue(writer, expression)
    }
    writer.write(';')
  }
}

export function variableStatement(options: {
  declarationKind?: 'const' | 'let' | 'var'
  name: string
  initializer: GeneratedValue
  type?: string
}): StatementWriter {
  return (writer) => {
    writer.write(options.declarationKind ?? 'const')
    writer.write(' ')
    writer.write(options.name)
    if (options.type) {
      writer.write(': ')
      writer.write(options.type)
    }
    writer.write(' = ')
    writeValue(writer, options.initializer)
    writer.write(';')
  }
}

export function assignmentStatement(target: GeneratedValue, value: GeneratedValue): StatementWriter {
  return (writer) => {
    writeValue(writer, target)
    writer.write(' = ')
    writeValue(writer, value)
    writer.write(';')
  }
}

export function ifStatement(options: {
  condition: GeneratedValue
  thenStatements: readonly StatementWriter[]
  elseStatements?: readonly StatementWriter[]
}): StatementWriter {
  return (writer) => {
    const elseStatements = options.elseStatements
    writer.write('if (')
    writeValue(writer, options.condition)
    writer.write(') ')
    writer.block(() => {
      writeStatements(writer, options.thenStatements)
    })

    if (elseStatements && elseStatements.length > 0) {
      writer.write(' else ')
      writer.block(() => {
        writeStatements(writer, elseStatements)
      })
    }
  }
}

export function forOfStatement(options: {
  variable: string
  iterable: GeneratedValue
  statements: readonly StatementWriter[]
  declarationKind?: 'const' | 'let' | 'var'
}): StatementWriter {
  return (writer) => {
    writer.write('for (')
    writer.write(options.declarationKind ?? 'const')
    writer.write(' ')
    writer.write(options.variable)
    writer.write(' of ')
    writeValue(writer, options.iterable)
    writer.write(') ')
    writer.block(() => {
      writeStatements(writer, options.statements)
    })
  }
}

export function objectKeys(value: GeneratedValue): WriterFunction {
  return methodCall(identifier('Object'), 'keys', [value])
}

export function objectEntries(value: GeneratedValue): WriterFunction {
  return methodCall(identifier('Object'), 'entries', [value])
}

export function objectFromEntries(value: GeneratedValue): WriterFunction {
  return methodCall(identifier('Object'), 'fromEntries', [value])
}

export function arrowFunction(options: {
  async?: boolean
  parameters?: string[]
  body: WriterFunction
}): WriterFunction {
  return (writer) => {
    if (options.async) {
      writer.write('async ')
    }
    writer.write('(')
    writeCommaSeparated(writer, options.parameters ?? [], (currentWriter, parameter) => currentWriter.write(parameter))
    writer.write(') => ')
    options.body(writer)
  }
}

export function block(body: WriterFunction): WriterFunction {
  return (writer) => {
    writer.block(() => {
      body(writer)
    })
  }
}

export function expressionStatement(expression: GeneratedValue): WriterFunction {
  return (writer) => {
    writeValue(writer, expression)
    writer.write(';')
  }
}
