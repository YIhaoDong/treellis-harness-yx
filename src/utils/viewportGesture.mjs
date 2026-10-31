// OrbitControls owns camera movement. Picking commits only after a completed
// primary-button tap, so starting a camera gesture never changes selection.
const navigationEvents = new WeakSet()

// HUD controls mark the native event during capture, before the canvas picker
// receives pointerdown. This also works when R3F stops its own event bubbling.
export function markViewportNavigation(event) {
  navigationEvents.add(event)
}

export function bindViewportPicking(element, {
  intersect,
  onHoverPath,
  onClickPath,
  movementThreshold = 5,
  eventRoot = element.ownerDocument?.defaultView || element,
} = {}) {
  const pointers = new Set()
  const thresholdSquared = movementThreshold * movementThreshold
  const initialCursor = element.style.cursor
  let candidate = null
  let lastHoverPath = null

  // Shift taps add/remove selection; Shift drags still belong to OrbitControls.
  const isNavigationModified = (event) => event.ctrlKey || event.metaKey || event.altKey
  const changedModifiers = (event, start) => isNavigationModified(event) || !!event.shiftKey !== start.shiftKey
  const movedTooFar = (event, start) => (
    (event.clientX - start.x) ** 2 + (event.clientY - start.y) ** 2 > thresholdSquared
  )
  const isInside = (event) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 &&
      event.clientX >= rect.left && event.clientX <= rect.left + rect.width &&
      event.clientY >= rect.top && event.clientY <= rect.top + rect.height
  }
  const clearHover = () => {
    if (lastHoverPath !== null) {
      lastHoverPath = null
      onHoverPath?.(null)
    }
    element.style.cursor = initialCursor
  }
  const onDown = (event) => {
    const alreadyPressed = pointers.size > 0
    pointers.add(event.pointerId)
    candidate = !alreadyPressed && !navigationEvents.has(event) && event.button === 0 &&
      event.isPrimary !== false && !isNavigationModified(event)
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, shiftKey: !!event.shiftKey }
      : null
    clearHover()
  }
  const trackMovement = (event) => {
    if (!candidate || candidate.pointerId !== event.pointerId) return
    // Also reject a button chord or a modifier pressed after pointerdown.
    const buttonsChanged = event.pointerType !== 'touch' &&
      event.buttons != null && event.buttons !== 1
    if (movedTooFar(event, candidate) || changedModifiers(event, candidate) || buttonsChanged) candidate = null
  }
  const onMove = (event) => {
    trackMovement(event)
    if (pointers.size || event.buttons > 0 || event.pointerType === 'touch') return
    const path = intersect?.(event.clientX, event.clientY) ?? null
    if (path !== lastHoverPath) {
      lastHoverPath = path
      onHoverPath?.(path)
    }
    element.style.cursor = path !== null ? 'pointer' : initialCursor
  }
  const onUp = (event) => {
    const pending = candidate
    const wasPressed = pointers.delete(event.pointerId)
    if (pending?.pointerId === event.pointerId) candidate = null
    if (!wasPressed || !pending || pending.pointerId !== event.pointerId ||
      pointers.size || event.button !== 0 || changedModifiers(event, pending) ||
      movedTooFar(event, pending) || !isInside(event)) return
    onClickPath?.(intersect?.(event.clientX, event.clientY) ?? null, { shiftKey: pending.shiftKey, additive: pending.shiftKey })
  }
  const onCancel = (event) => {
    pointers.delete(event.pointerId)
    candidate = null
  }
  const onLeave = () => {
    if (!pointers.size) clearHover()
  }
  const cancelCandidate = () => { candidate = null }
  const onKeyDown = (event) => {
    if (['Control', 'Alt', 'Meta'].includes(event.key) || (event.key === 'Shift' && !candidate?.shiftKey)) cancelCandidate()
  }
  const reset = () => {
    pointers.clear()
    candidate = null
    clearHover()
  }

  element.addEventListener('pointerdown', onDown)
  element.addEventListener('pointermove', onMove)
  element.addEventListener('pointerleave', onLeave)
  element.addEventListener('wheel', cancelCandidate, { passive: true })
  element.addEventListener('lostpointercapture', onCancel)
  // Track release outside the canvas without taking capture away from controls.
  eventRoot.addEventListener('pointermove', trackMovement, true)
  eventRoot.addEventListener('pointerup', onUp, true)
  eventRoot.addEventListener('pointercancel', onCancel, true)
  eventRoot.addEventListener('keydown', onKeyDown, true)
  eventRoot.addEventListener('blur', reset)

  return () => {
    element.removeEventListener('pointerdown', onDown)
    element.removeEventListener('pointermove', onMove)
    element.removeEventListener('pointerleave', onLeave)
    element.removeEventListener('wheel', cancelCandidate)
    element.removeEventListener('lostpointercapture', onCancel)
    eventRoot.removeEventListener('pointermove', trackMovement, true)
    eventRoot.removeEventListener('pointerup', onUp, true)
    eventRoot.removeEventListener('pointercancel', onCancel, true)
    eventRoot.removeEventListener('keydown', onKeyDown, true)
    eventRoot.removeEventListener('blur', reset)
    pointers.clear()
    candidate = null
    element.style.cursor = initialCursor
  }
}
