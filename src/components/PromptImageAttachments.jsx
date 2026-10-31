import React, { useRef } from 'react'
import { IMAGE_LIMITS } from '../generation/imageInputs.mjs'
import '../promptImages.css'

export default function PromptImageAttachments({ attachments, disabled = false }) {
  const inputRef = useRef(null)
  const { images, loading, error, remove, clearError, inputProps, canAdd } = attachments
  return <div className="prompt-images">
    {!!images.length && <ul className="prompt-images__list" aria-label="Reference images">
      {images.map(image => <li key={image.id} className="prompt-images__item">
        <img src={image.dataUrl} alt={image.name} className="prompt-images__thumbnail" />
        <span className="prompt-images__name" title={image.name}>{image.name}</span>
        <button type="button" className="prompt-images__remove" disabled={disabled}
          aria-label={`Remove image ${image.name}`} title={`Remove ${image.name}`} onClick={() => remove(image.id)}>×</button>
      </li>)}
    </ul>}
    <div className="prompt-images__controls">
      <input ref={inputRef} {...inputProps} hidden disabled={disabled} aria-label="Choose reference images" />
      <button type="button" className="prompt-images__add" disabled={disabled || !canAdd}
        onClick={() => inputRef.current?.click()} title="Add images, drag images here, or paste with Ctrl+V">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="7" cy="7" r="1.4" fill="currentColor" />
          <path d="m3.5 14 4-4 3 3 2.5-2.5 3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Add images
      </button>
      {loading && <span className="prompt-images__status" role="status">Preparing images…</span>}
      {!loading && !!images.length && <span className="prompt-images__count">{images.length}/{IMAGE_LIMITS.maxImages}</span>}
    </div>
    {error && <div className="prompt-images__error" role="alert">
      <span>{error}</span>
      <button type="button" aria-label="Dismiss image error" onClick={clearError}>×</button>
    </div>}
  </div>
}
