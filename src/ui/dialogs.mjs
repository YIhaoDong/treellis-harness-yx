// In-page replacements for window.prompt / confirm / alert. They use the shared
// .ttcs-modal styles, so every question the app asks looks like the rest of it,
// and they work inside sandboxed iframes where native dialogs are blocked.
import { STATIC_DEMO } from '../staticDemo/mode.mjs'

let dismissActive = null

export function dismissDialog() {
  dismissActive?.()
}

const element = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function openDialog({ title, message, size = 'sm', build, onEscape }) {
  dismissDialog()
  const previousFocus = document.activeElement
  const overlay = element('div', 'ttcs-modal-overlay ttcs-modal-overlay--top')
  overlay.dataset.treellisStaticDialog = 'true'
  const form = element('form', `ttcs-modal ttcs-modal--${size}`)
  form.setAttribute('role', 'dialog')
  form.setAttribute('aria-modal', 'true')
  const titleId = `ui-dialog-${Math.random().toString(36).slice(2)}`
  form.setAttribute('aria-labelledby', titleId)
  const bar = element('div', 'ttcs-modal__bar')
  const heading = element('div', 'ttcs-modal__heading')
  const titleNode = element('h2', 'ttcs-modal__title', title)
  titleNode.id = titleId
  heading.append(titleNode)
  const close = element('button', 'ttcs-modal__close', '×')
  close.type = 'button'
  close.setAttribute('aria-label', 'Close')
  bar.append(heading, close)
  const body = element('div', 'ttcs-modal__body')
  if (message) body.append(element('p', 'ui-dialog-message', message))
  const footer = element('div', 'ttcs-modal__footer')
  form.append(bar, body, footer)
  overlay.append(form)

  let finished = false
  const done = (resolve) => (value) => {
    if (finished) return
    finished = true
    overlay.remove()
    if (dismissActive === cancelRef.cancel) dismissActive = null
    if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true })
    resolve(value)
  }
  const cancelRef = {}
  return new Promise(resolve => {
    const finish = done(resolve)
    const { initialFocus, submitValue, cancelValue } = build({ body, footer, finish })
    cancelRef.cancel = () => finish(cancelValue)
    dismissActive = cancelRef.cancel
    close.onclick = () => finish(cancelValue)
    overlay.onmousedown = event => { if (event.target === overlay) finish(cancelValue) }
    form.onsubmit = event => { event.preventDefault(); finish(submitValue()) }
    form.onkeydown = event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); onEscape?.(); finish(cancelValue) }
      if (event.key === 'Tab') {
        const controls = [...form.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
        const index = controls.indexOf(document.activeElement)
        const next = controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]
        event.preventDefault()
        next?.focus()
      }
    }
    document.body.append(overlay)
    initialFocus?.focus()
    initialFocus?.select?.()
  })
}

// Ask for a line of text. Resolves to the trimmed text, or null when cancelled.
export function askText({ title, label = '', value = '', placeholder = '', confirmLabel = 'Save', hint = '' }) {
  return openDialog({
    title,
    build({ body, footer, finish }) {
      const field = element('label', 'ui-field')
      if (label) field.append(element('span', 'ui-field__label', label))
      const input = element('input', 'ui-input')
      input.type = 'text'
      input.value = String(value ?? '')
      input.placeholder = placeholder
      input.autocomplete = 'off'
      input.spellcheck = false
      if (!label) input.setAttribute('aria-label', title)
      field.append(input)
      body.append(field)
      if (hint) body.append(element('p', 'ui-hint', hint))
      const cancel = element('button', 'ui-btn', 'Cancel')
      cancel.type = 'button'
      cancel.onclick = () => finish(null)
      const accept = element('button', 'ui-btn ui-btn--primary', confirmLabel)
      accept.type = 'submit'
      const sync = () => { accept.disabled = !input.value.trim() }
      input.oninput = sync
      sync()
      footer.append(cancel, accept)
      return { initialFocus: input, submitValue: () => input.value.trim() || null, cancelValue: null }
    },
  })
}

// Ask a yes/no question. Resolves to true only when confirmed.
export function askConfirm({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  // The embedded static demo has always skipped confirmations; every change there is undoable.
  if (STATIC_DEMO) return Promise.resolve(true)
  return openDialog({
    title,
    message,
    build({ footer, finish }) {
      const cancel = element('button', 'ui-btn', cancelLabel)
      cancel.type = 'button'
      cancel.onclick = () => finish(false)
      const accept = element('button', `ui-btn ${danger ? 'ui-btn--danger' : 'ui-btn--primary'}`, confirmLabel)
      accept.type = 'submit'
      footer.append(cancel, accept)
      return { initialFocus: danger ? cancel : accept, submitValue: () => true, cancelValue: false }
    },
  })
}

// A short message that disappears on its own (replaces alert()).
let toastTimer = null
export function notify(message, { tone = 'info', duration = 3200 } = {}) {
  if (typeof document === 'undefined') return
  let toast = document.querySelector('.ui-toast')
  if (!toast) {
    toast = element('div', 'ui-toast')
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')
    document.body.append(toast)
  }
  toast.textContent = message
  toast.dataset.tone = tone
  toast.dataset.visible = 'true'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.dataset.visible = 'false' }, duration)
}
