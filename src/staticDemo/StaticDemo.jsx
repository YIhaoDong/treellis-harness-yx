import React, { useEffect, useState } from 'react'
import App from '../App'
import { readStaticScene } from './mode.mjs'
import { dismissStaticDialog } from './dialogs.mjs'
import './static.css'

const deckKeys = new Set(['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', 'Home', 'End'])
const layerKeys = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End'])

export function installStaticEnvironment() {
  document.documentElement.dataset.treellisStatic = 'true'
  // Known Library text prompts use the app's in-page dialog. Keep fallback
  // native dialogs silent too; local deletion remains undoable.
  window.alert = () => {}
  window.confirm = () => true
  window.prompt = () => null
  // Sandboxes may allow scripts without allow-forms. Run existing React submit
  // handlers as events, without invoking the browser's native form submission.
  const submitLocally = (form, submitter = null) => {
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }))
  }
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('a[download]')) event.preventDefault()
    const control = event.target instanceof Element ? event.target.closest('button, input') : null
    if (control?.form && control.type === 'submit' && !control.disabled) {
      event.preventDefault()
      submitLocally(control.form, control)
    }
  }, true)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const input = event.target
    if (!(input instanceof HTMLInputElement) || !input.form || input.closest('[data-treellis-static-dialog]')) return
    if (['button', 'submit', 'reset', 'file'].includes(input.type)) return
    event.preventDefault()
    submitLocally(input.form)
  }, true)
  window.__TREELLIS_STATIC_DEMO__ = { getScene: readStaticScene }
}

export default function StaticDemo() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const reset = () => {
      dismissStaticDialog()
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      setRevision(value => value + 1)
    }
    window.__TREELLIS_STATIC_DEMO__.reset = reset
    const onMessage = event => {
      if (event.data?.type === 'treellis-reset') reset()
    }
    const onKeyDown = event => {
      if (!deckKeys.has(event.key) || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : document.activeElement
      const editing = element => element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      if (editing(target) || editing(document.activeElement)) return
      // Preserve the current app's contextual keyboard navigation/resizing.
      if (layerKeys.has(event.key) && target?.closest?.('[role="treeitem"]')) return
      if ((event.key === 'Home' || event.key === 'End') && target?.closest?.('[role="separator"]')) return
      event.preventDefault()
      window.parent.postMessage({ type: 'deck-key', key: event.key }, '*')
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKeyDown)
      delete window.__TREELLIS_STATIC_DEMO__.reset
    }
  }, [])

  useEffect(() => {
    let frame
    let cancelled = false
    const announce = () => {
      if (cancelled) return
      const canvas = document.querySelector('canvas')
      if (!canvas?.width || !readStaticScene()) { frame = requestAnimationFrame(announce); return }
      frame = requestAnimationFrame(() => {
        if (!cancelled) window.parent.postMessage({ type: 'treellis-ready' }, '*')
      })
    }
    frame = requestAnimationFrame(announce)
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [revision])

  // Remounting also resets camera/controls, selection, expansion, history,
  // parameter limits, temporary library, prompt text and open dialogs.
  return <App key={revision} />
}
