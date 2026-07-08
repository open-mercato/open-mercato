declare module 'html-to-docx' {
  export type HTMLtoDOCXResult = Buffer | Uint8Array | ArrayBuffer | Blob

  export default function HTMLtoDOCX(html: string): Promise<HTMLtoDOCXResult>
}
