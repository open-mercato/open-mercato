import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '../CrudForm'

export type FieldInputComponent = (props: CrudCustomFieldRenderProps & { def?: any }) => React.ReactNode
export type FieldDefEditorComponent = (props: { def: any; onChange: (patch: any) => void }) => React.ReactNode

type Entry = { input?: FieldInputComponent; defEditor?: FieldDefEditorComponent }

class FieldRegistryImpl {
  private map = new Map<string, Entry>()

  register(kind: string, entry: Entry) {
    const k = kind.toLowerCase()
    const prev = this.map.get(k) || {}
    this.map.set(k, { ...prev, ...entry })
  }

  getInput(kind: string): FieldInputComponent | undefined {
    return this.map.get(kind.toLowerCase())?.input
  }

  getDefEditor(kind: string): FieldDefEditorComponent | undefined {
    return this.map.get(kind.toLowerCase())?.defEditor
  }
}

export const FieldRegistry = new FieldRegistryImpl()

// Placeholder for generator to auto-register fields from modules
// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function loadGeneratedFieldRegistrations(): Promise<void> {
  try {
    const gen = await import('./registry.generated')
    if (typeof gen.loadAll === 'function') gen.loadAll()
  } catch {
    // ignore when not present
  }
}
