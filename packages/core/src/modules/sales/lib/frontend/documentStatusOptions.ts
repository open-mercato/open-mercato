export function isEditableDocumentStatus(kind: 'order' | 'quote', value: string): boolean {
  return kind !== 'order' || value !== 'sent'
}
