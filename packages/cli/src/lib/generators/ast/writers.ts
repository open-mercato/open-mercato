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
