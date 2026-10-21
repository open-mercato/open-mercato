export const features = [
  { id: 'channel_whatsapp.view', title: 'View WhatsApp channels', module: 'channel_whatsapp' },
  {
    id: 'channel_whatsapp.configure',
    title: 'Configure WhatsApp channels',
    module: 'channel_whatsapp',
    dependsOn: ['channel_whatsapp.view'],
  },
]

export default features
