import type {
  ChannelNativeContent,
  ConvertOutboundInput,
  NormalizedAttachment,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'

type WhatsappMediaType = 'image' | 'audio' | 'video' | 'document'

function resolveMediaType(attachment: NormalizedAttachment): WhatsappMediaType {
  const mime = attachment.mimeType.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

export function convertOutboundForWhatsApp(input: ConvertOutboundInput): ChannelNativeContent {
  const text = input.body ?? ''
  const attachment = input.attachments?.[0]
  if (!attachment) {
    return {
      content: { text, bodyFormat: 'text' },
      metadata: { whatsappMessageType: 'text' },
    }
  }
  const mediaType = resolveMediaType(attachment)
  return {
    content: { text, bodyFormat: 'text', attachments: [attachment] },
    metadata: {
      whatsappMessageType: mediaType,
      whatsappMediaLink: attachment.url,
      whatsappMediaCaption: text.trim().length ? text : undefined,
      whatsappMediaFilename: mediaType === 'document' ? attachment.fileName : undefined,
    },
  }
}
