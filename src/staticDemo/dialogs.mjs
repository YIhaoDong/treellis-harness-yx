let dismissActive = null

export function dismissStaticDialog() {
  dismissActive?.()
}

// Keep local Library naming usable without native window.prompt in an iframe.
// This is only invoked by static-mode user actions, never during initial load.
export function requestStaticText(title, initialValue = '') {
  dismissStaticDialog()
  return new Promise(resolve => {
    const previousFocus = document.activeElement
    const element = (tag, className, text) => {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text != null) node.textContent = text
      return node
    }
    const overlay = element('div', 'ttcs-modal-overlay')
    overlay.dataset.treellisStaticDialog = 'text'
    const form = element('form', 'ttcs-modal')
    Object.assign(form.style, { width: 'min(440px, 92vw)' })
    form.setAttribute('role', 'dialog')
    form.setAttribute('aria-modal', 'true')
    form.setAttribute('aria-label', title)
    const bar = element('div', 'ttcs-modal__bar')
    const heading = element('div', 'ttcs-modal__title', title)
    const close = element('button', 'ttcs-modal__close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close naming dialog')
    const body = element('div', 'ttcs-modal__body')
    body.style.padding = '20px'
    const input = element('input')
    input.type = 'text'
    input.value = String(initialValue)
    input.setAttribute('aria-label', title)
    Object.assign(input.style, { width: '100%', minWidth: '0', padding: '10px 12px', border: '1px solid #d9dde4', borderRadius: '9px', font: 'inherit' })
    const actions = element('div')
    Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '22px' })
    const cancel = element('button', 'btn btn--ghost', 'Cancel')
    cancel.type = 'button'
    const accept = element('button', 'btn', 'OK')
    accept.type = 'button'
    Object.assign(accept.style, { background: '#242831', color: '#fff', borderColor: '#242831' })
    let finished = false
    const finish = value => {
      if (finished) return
      finished = true
      overlay.remove()
      dismissActive = null
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true })
      resolve(value)
    }
    dismissActive = () => finish(null)
    close.onclick = cancel.onclick = () => finish(null)
    accept.onclick = () => finish(input.value)
    overlay.onmousedown = event => { if (event.target === overlay) finish(null) }
    form.onsubmit = event => { event.preventDefault(); finish(input.value) }
    form.onkeydown = event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); finish(input.value) }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null) }
      if (event.key === 'Tab') {
        const controls = [close, input, cancel, accept]
        const next = controls[(controls.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]
        event.preventDefault()
        next.focus()
      }
    }
    bar.append(heading, close)
    actions.append(cancel, accept)
    body.append(input, actions)
    form.append(bar, body)
    overlay.append(form)
    document.body.append(overlay)
    input.focus()
    input.select()
  })
}
