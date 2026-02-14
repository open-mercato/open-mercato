import {
  getMessageObjectType,
  isMessageObjectTypeAllowedForMessageType,
} from './message-objects-registry'

type MessageObjectLike = {
  entityModule: string
  entityType: string
  entityId: string
}

export function validateMessageObjectsForType(
  messageType: string,
  objects: MessageObjectLike[],
): string | null {
  for (const object of objects) {
    const objectType = getMessageObjectType(object.entityModule, object.entityType)
    if (!objectType) {
      return `Unsupported message object type: ${object.entityModule}:${object.entityType}`
    }
    if (!isMessageObjectTypeAllowedForMessageType(objectType, messageType)) {
      return `Object type ${object.entityModule}:${object.entityType} is not allowed for message type ${messageType}`
    }
  }
  return null
}
