/**
 * @jest-environment jsdom
 */
import { describe, it, expect } from '@jest/globals'
import type { InjectionWidgetMetadata, InjectionWidgetModule, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

describe('Widget Injection Types', () => {
  it('should allow defining widget metadata', () => {
    const metadata: InjectionWidgetMetadata = {
      id: 'test.widget',
      title: 'Test Widget',
      description: 'A test widget',
      features: ['test.feature'],
      priority: 100,
      enabled: true,
    }
    expect(metadata.id).toBe('test.widget')
  })

  it('should allow defining injection table', () => {
    const table: ModuleInjectionTable = {
      'crud-form:test': 'test.widget',
      'crud-form:test2': ['widget1', 'widget2'],
    }
    expect(table['crud-form:test']).toBe('test.widget')
    expect(Array.isArray(table['crud-form:test2'])).toBe(true)
  })

  it('should type event handlers correctly', () => {
    const widget: Partial<InjectionWidgetModule<any, any>> = {
      eventHandlers: {
        onLoad: async (context) => {
          expect(context).toBeDefined()
        },
        onBeforeSave: async (data, context) => {
          expect(data).toBeDefined()
          expect(context).toBeDefined()
          return true
        },
      },
    }
    expect(widget.eventHandlers?.onLoad).toBeDefined()
    expect(widget.eventHandlers?.onBeforeSave).toBeDefined()
  })
})
