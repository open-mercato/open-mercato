import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export function resolveCrudFormDialogsEnabled(rawFlag: string | undefined): boolean {
  return parseBooleanWithDefault(rawFlag, true)
}
