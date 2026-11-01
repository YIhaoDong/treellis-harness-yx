import { useEffect, useRef, useState } from 'react'
import { IMAGE_LIMITS, imageRevision } from '../generation/imageInputs.mjs'
import { IMAGE_ACCEPT, imageByteSize, normalizePromptImage, transferHasFiles, transferImageFiles } from '../utils/promptImages.mjs'

export default function usePromptImages({ disabled = false, isDisabled, normalizeFile = normalizePromptImage } = {}) {
  const [images, setImages] = useState([])
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const state = useRef({ images: [], revision: '', epoch: 0, mounted: true, pending: 0, queue: Promise.resolve(), dragDepth: 0, sequence: 0, removedAt: new Map() })
  const disabledRef = useRef(disabled)
  const disabledCallbackRef = useRef(isDisabled)
  disabledRef.current = disabled
  disabledCallbackRef.current = isDisabled
  const blocked = () => disabledRef.current || !!disabledCallbackRef.current?.()
  useEffect(() => {
    state.current.mounted = true
    return () => { state.current.mounted = false; state.current.epoch++ }
  }, [])

  function commit(next) {
    state.current.images = next
    state.current.revision = imageRevision(next)
    setImages(next)
  }
  function clear() {
    const current = state.current
    current.epoch++
    current.queue = Promise.resolve()
    current.pending = 0
    current.dragDepth = 0
    current.removedAt.clear()
    commit([])
    setPending(0)
    setError('')
    setDragging(false)
  }
  function remove(id) {
    if (blocked()) return
    state.current.removedAt.set(id, ++state.current.sequence)
    commit(state.current.images.filter(image => image.id !== id))
    setError('')
  }
  function clearIfCurrent(submittedImages) {
    if (state.current.revision === imageRevision(submittedImages || [])) clear()
  }
  function addFiles(fileList) {
    if (blocked()) return Promise.resolve([])
    const files = Array.from(fileList || [])
    if (!files.length) return Promise.resolve([])
    const current = state.current, epoch = current.epoch, sequence = ++current.sequence
    current.pending++
    setPending(current.pending)
    setError('')
    const isCurrent = () => current.mounted && current.epoch === epoch
    const task = current.queue.then(async () => {
      const errors = [], added = []
      for (const file of files) {
        if (!isCurrent()) break
        try {
          const image = await normalizeFile(file)
          if (!isCurrent()) break
          const id = imageRevision([image])
          if ((current.removedAt.get(id) || 0) > sequence) continue
          if (current.images.some(existing => existing.id === id)) continue
          if (current.images.length >= IMAGE_LIMITS.maxImages) throw new Error(`You can attach up to ${IMAGE_LIMITS.maxImages} images.`)
          if (current.images.reduce((sum, item) => sum + imageByteSize(item), 0) + imageByteSize(image) > IMAGE_LIMITS.maxTotalBytes) {
            throw new Error('The attached images are too large. Please remove one and try again.')
          }
          const attachment = { ...image, id }
          commit([...current.images, attachment])
          added.push(attachment)
        } catch (failure) {
          if (isCurrent()) errors.push(`${file.name || 'Image'}: ${failure?.message || 'This image could not be prepared.'}`)
        }
      }
      if (isCurrent() && errors.length) setError(errors.join('\n'))
      return added
    }).finally(() => {
      if (isCurrent()) { current.pending--; setPending(current.pending) }
    })
    current.queue = task.catch(() => {})
    return task
  }
  function resetDrag() { state.current.dragDepth = 0; setDragging(false) }
  const composerProps = {
    'data-image-dragover': dragging,
    onPaste(event) {
      const files = transferImageFiles(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      event.stopPropagation()
      if (!blocked()) void addFiles(files)
    },
    onDragEnter(event) {
      if (!transferHasFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      state.current.dragDepth++
      if (!blocked()) setDragging(true)
    },
    onDragOver(event) {
      if (!transferHasFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy'
    },
    onDragLeave(event) {
      if (!state.current.dragDepth) return
      event.preventDefault()
      event.stopPropagation()
      state.current.dragDepth = Math.max(0, state.current.dragDepth - 1)
      if (!state.current.dragDepth) setDragging(false)
    },
    onDrop(event) {
      if (!transferHasFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      resetDrag()
      if (blocked()) return
      const files = transferImageFiles(event.dataTransfer)
      if (files.length) void addFiles(files)
      else setError('Use PNG, JPEG or WebP images.')
    },
  }
  return {
    images,
    revision: state.current.revision,
    loading: pending > 0,
    error,
    clearError: () => setError(''),
    clear,
    clearIfCurrent,
    remove,
    addFiles,
    composerProps,
    canAdd: !disabled && images.length < IMAGE_LIMITS.maxImages,
    inputProps: {
      type: 'file', accept: IMAGE_ACCEPT, multiple: true,
      onChange(event) {
        const files = Array.from(event.currentTarget.files || [])
        event.currentTarget.value = ''
        void addFiles(files)
      },
    },
  }
}
