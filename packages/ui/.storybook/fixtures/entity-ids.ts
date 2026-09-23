// Application-host registry needed by the attachment metadata preview.
// Gallery fixtures never load or write actual attachment records.
export const E = { attachments: { attachment: 'attachments:attachment' } } as const
export const M = { attachments: 'attachments' } as const
