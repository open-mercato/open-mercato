/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FileUploadArea } from '../file-upload'
import { FileUploadCard } from '../file-upload-card'
import { ImageUpload } from '../image-upload'
import { selectUploadFiles } from '../../utils/fileUpload'
import { readImageDimensions } from '../../utils/imageDimensions'

jest.mock('../../utils/imageDimensions', () => ({ readImageDimensions: jest.fn() }))
const dimensionsMock = jest.mocked(readImageDimensions)
const wrap = (children: React.ReactNode) => <I18nProvider locale="en" dict={{}}>{children}</I18nProvider>
const pdf = new File(['pdf'], 'cv.PDF', { type: 'application/pdf' })
const png = new File(['png'], 'avatar.png', { type: 'image/png' })

describe('file selection', () => {
  it('matches case-insensitive extensions, exact MIME types and MIME wildcards without changing the file objects', () => {
    expect(selectUploadFiles([pdf, png], { accept: ' .pdf, IMAGE/* ' }).accepted).toEqual([pdf, png])
    expect(selectUploadFiles([pdf, png], { accept: 'application/pdf' })).toEqual({ accepted: [pdf], rejected: [{ file: png, reason: 'type' }] })
  })

  it('rejects unsupported and oversized files before counting the first accepted file', () => {
    const huge = new File(['12345'], 'huge.png', { type: 'image/png' })
    const second = new File(['1'], 'second.png', { type: 'image/png' })
    expect(selectUploadFiles([pdf, huge, png, second], { accept: 'image/*', maxSizeBytes: 3, multiple: false })).toEqual({ accepted: [png], rejected: [{ file: pdf, reason: 'type' }, { file: huge, reason: 'size' }, { file: second, reason: 'count' }] })
  })

  it('allows the size limit exactly and all files when no constraints are supplied', () => {
    expect(selectUploadFiles([png], { maxSizeBytes: 3 }).accepted).toEqual([png])
    expect(selectUploadFiles([pdf, png]).accepted).toEqual([pdf, png])
  })
})

describe('FileUploadArea', () => {
  it('opens the native chooser and permits selecting the same file twice', () => {
    const onFilesSelected = jest.fn()
    const { container } = render(wrap(<FileUploadArea onFilesSelected={onFilesSelected} />))
    const input = container.querySelector('input')!
    const click = jest.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Browse File' }))
    expect(click).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { files: [pdf] } })
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { files: [pdf] } })
    expect(onFilesSelected.mock.calls).toEqual([[[pdf]], [[pdf]]])
  })

  it('applies identical validation to dropped files and resets nested drag state', () => {
    const onFilesSelected = jest.fn()
    const onFilesRejected = jest.fn()
    render(wrap(<FileUploadArea accept="application/pdf" onFilesSelected={onFilesSelected} onFilesRejected={onFilesRejected} />))
    const area = screen.getByRole('group')
    const dataTransfer = { files: [pdf, png], types: ['Files'] }
    fireEvent.dragEnter(area, { dataTransfer })
    fireEvent.dragEnter(screen.getByRole('button'), { dataTransfer })
    fireEvent.dragLeave(screen.getByRole('button'), { dataTransfer })
    expect(area).toHaveAttribute('data-drag-active', 'true')
    fireEvent.drop(area, { dataTransfer })
    expect(area).toHaveAttribute('data-drag-active', 'false')
    expect(onFilesSelected).toHaveBeenCalledWith([pdf])
    expect(onFilesRejected).toHaveBeenCalledWith([{ file: png, reason: 'type' }])
    expect(screen.getByRole('alert')).toHaveTextContent('avatar.png: file type is not supported.')
  })

  it('prevents disabled selection through either input or drop', () => {
    const onFilesSelected = jest.fn()
    const { container } = render(wrap(<FileUploadArea disabled onFilesSelected={onFilesSelected} />))
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.change(container.querySelector('input')!, { target: { files: [pdf] } })
    fireEvent.drop(screen.getByRole('group'), { dataTransfer: { files: [pdf] } })
    expect(onFilesSelected).not.toHaveBeenCalled()
  })

  it('uses defaults matching the displayed file-type and 50 MB requirements', () => {
    const onFilesSelected = jest.fn()
    const onFilesRejected = jest.fn()
    const huge = new File(['pdf'], 'large.pdf', { type: 'application/pdf' })
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 + 1 })
    const unsupported = new File(['text'], 'notes.txt', { type: 'text/plain' })
    render(wrap(<FileUploadArea onFilesSelected={onFilesSelected} onFilesRejected={onFilesRejected} />))
    fireEvent.drop(screen.getByRole('group'), { dataTransfer: { files: [huge, unsupported] } })
    expect(onFilesSelected).not.toHaveBeenCalled()
    expect(onFilesRejected).toHaveBeenCalledWith([{ file: huge, reason: 'size' }, { file: unsupported, reason: 'type' }])
  })
})

describe('FileUploadCard', () => {
  it('distinguishes cancel, remove and retry and announces the controlled status', () => {
    const onRemove = jest.fn()
    const onRetry = jest.fn()
    const view = (status: 'uploading' | 'error' | 'success') => wrap(<FileUploadCard fileName="cv.pdf" sizeLabel="120 KB" status={status} progress={140} onRemove={onRemove} onRetry={onRetry} />)
    const { rerender } = render(view('uploading'))
    expect(screen.getByRole('progressbar', { name: 'cv.pdf upload progress' })).toHaveAttribute('aria-valuenow', '100')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }))
    rerender(view('error'))
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Failed')
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }))
    expect(onRemove).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(view('success'))
    expect(screen.getByRole('status')).toHaveTextContent('Completed')
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
  })

  it('does not call disabled retry or remove actions', () => {
    const callback = jest.fn()
    render(wrap(<FileUploadCard fileName="cv.pdf" sizeLabel="120 KB" status="error" disabled onRemove={callback} onRetry={callback} />))
    screen.getAllByRole('button').forEach(button => { expect(button).toBeDisabled(); fireEvent.click(button) })
    expect(callback).not.toHaveBeenCalled()
  })
})

describe('ImageUpload', () => {
  beforeEach(() => { dimensionsMock.mockReset(); dimensionsMock.mockResolvedValue({ width: 400, height: 400 }) })

  it('accepts a decoded image at the minimum dimensions, then supports removal', async () => {
    const onChange = jest.fn()
    const { container } = render(wrap(<ImageUpload src="existing.png" onChange={onChange} />))
    fireEvent.change(container.querySelector('input')!, { target: { files: [png] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(png))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('rejects images below configured dimensions and exposes the matching translated requirement', async () => {
    dimensionsMock.mockResolvedValue({ width: 600, height: 399 })
    const onChange = jest.fn()
    const onFilesRejected = jest.fn()
    const { container } = render(wrap(<ImageUpload minWidth={600} minHeight={400} onChange={onChange} onFilesRejected={onFilesRejected} />))
    expect(screen.getByText('Min 600×400px, PNG or JPEG')).toBeInTheDocument()
    fireEvent.change(container.querySelector('input')!, { target: { files: [png] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('avatar.png must be at least 600×400px.')
    expect(onFilesRejected).toHaveBeenCalledWith([{ file: png, reason: 'dimensions' }])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects incorrect types and sizes without decoding them', () => {
    const onChange = jest.fn()
    const { container } = render(wrap(<ImageUpload maxSizeBytes={2} onChange={onChange} />))
    fireEvent.change(container.querySelector('input')!, { target: { files: [pdf] } })
    expect(screen.getByRole('alert')).toHaveTextContent('file type is not supported')
    fireEvent.change(container.querySelector('input')!, { target: { files: [png] } })
    expect(screen.getByRole('alert')).toHaveTextContent('exceeds the allowed file size')
    expect(dimensionsMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects a file claiming an image MIME type when decoding fails', async () => {
    dimensionsMock.mockRejectedValue(new Error('invalid fixture'))
    const onChange = jest.fn()
    const { container } = render(wrap(<ImageUpload onChange={onChange} />))
    fireEvent.change(container.querySelector('input')!, { target: { files: [png] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('avatar.png could not be read as an image.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores an earlier pending image when a newer valid image finishes first', async () => {
    let resolveFirst: (dimensions: { width: number; height: number }) => void = () => {}
    dimensionsMock.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
    const onChange = jest.fn()
    const second = new File(['img'], 'second.png', { type: 'image/png' })
    const { container } = render(wrap(<ImageUpload onChange={onChange} />))
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { files: [png] } })
    fireEvent.change(input, { target: { files: [second] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(second))
    await act(async () => resolveFirst({ width: 400, height: 400 }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it.each(['remove', 'disable', 'unmount'] as const)('ignores a pending image after %s', async action => {
    let resolveImage: (dimensions: { width: number; height: number }) => void = () => {}
    dimensionsMock.mockReturnValueOnce(new Promise(resolve => { resolveImage = resolve }))
    const onChange = jest.fn()
    const { container, rerender, unmount } = render(wrap(<ImageUpload src="existing.png" onChange={onChange} />))
    fireEvent.change(container.querySelector('input')!, { target: { files: [png] } })
    if (action === 'remove') fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    if (action === 'disable') rerender(wrap(<ImageUpload disabled src="existing.png" onChange={onChange} />))
    if (action === 'unmount') unmount()
    onChange.mockClear()
    await act(async () => resolveImage({ width: 400, height: 400 }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
