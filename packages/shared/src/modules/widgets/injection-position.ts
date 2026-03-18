export enum InjectionPosition {
  Before = 'before',
  After = 'after',
  First = 'first',
  Last = 'last',
}

export type InjectionPlacement = {
  position?: InjectionPosition
  relativeTo?: string
}

export function getInjectionPosition(placement?: InjectionPlacement): InjectionPosition {
  if (!placement?.position) return InjectionPosition.Last
  return placement.position
}

function warnInvalidRelativeTo(relativeTo: string | undefined) {
  if (process.env.NODE_ENV !== 'development') return
  if (!relativeTo) return
  console.warn(`[InjectionPlacement] relativeTo target "${relativeTo}" not found, appending item at the end.`)
}

export function insertByInjectionPlacement<T>(
  items: T[],
  item: T,
  placement: InjectionPlacement | undefined,
  getItemId: (value: T) => string,
): T[] {
  const current = [...items]
  const position = getInjectionPosition(placement)

  if (position === InjectionPosition.First) {
    current.unshift(item)
    return current
  }

  if (position === InjectionPosition.Last) {
    current.push(item)
    return current
  }

  const relativeTo = placement?.relativeTo
  if (!relativeTo) {
    current.push(item)
    return current
  }

  const targetIndex = current.findIndex((value) => getItemId(value) === relativeTo)
  if (targetIndex < 0) {
    warnInvalidRelativeTo(relativeTo)
    current.push(item)
    return current
  }

  const insertIndex = position === InjectionPosition.Before ? targetIndex : targetIndex + 1
  current.splice(insertIndex, 0, item)
  return current
}
