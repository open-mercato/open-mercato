import { Extension, type Editor } from '@tiptap/core'
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion'
import type { EntityRefAttributes } from './editorConfig'

type EntitySuggestionHandlers = {
  onTrigger: (ctx: { query: string; range: { from: number; to: number } }) => void
  onClose: () => void
}

function notifyTrigger(
  handlers: EntitySuggestionHandlers,
  props: Pick<SuggestionProps<unknown, unknown>, 'query' | 'range'>,
): void {
  handlers.onTrigger({
    query: props.query,
    range: {
      from: props.range.from,
      to: props.range.to,
    },
  })
}

export function createEntitySuggestionExtension(handlers: EntitySuggestionHandlers): Extension {
  return Extension.create({
    name: 'entitySuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<unknown, unknown>({
          editor: this.editor,
          char: '@',
          allowSpaces: false,
          startOfLine: false,
          items: () => [],
          command: () => undefined,
          render: () => ({
            onStart: (props) => notifyTrigger(handlers, props),
            onUpdate: (props) => notifyTrigger(handlers, props),
            onExit: () => handlers.onClose(),
          }),
        }),
      ]
    },
  })
}

export function insertEntityRef(editor: Editor, attrs: EntityRefAttributes): boolean {
  return editor
    .chain()
    .focus()
    .insertContent([
      {
        type: 'entityRef',
        attrs,
      },
      {
        type: 'text',
        text: ' ',
      },
    ])
    .run()
}
