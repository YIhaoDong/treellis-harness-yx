import { useEffect, useState } from 'react'

export const COMPACT_WORKSPACE_QUERY = '(max-width: 1100px)'

function viewportSize() {
  const viewport = window.visualViewport
  return { height: Math.round(viewport?.height || window.innerHeight), top: Math.round(viewport?.offsetTop || 0) }
}

export default function useResponsiveWorkspace() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_WORKSPACE_QUERY).matches)
  const [viewport, setViewport] = useState(viewportSize)

  useEffect(() => {
    const media = window.matchMedia(COMPACT_WORKSPACE_QUERY)
    const onChange = event => setCompact(event.matches)
    media.addEventListener('change', onChange)
    setCompact(media.matches)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const originalHeight = root.style.getPropertyValue('--workspace-height')
    const originalTop = root.style.getPropertyValue('--workspace-top')
    let frame = null
    const measure = () => {
      const next = viewportSize()
      if (next.height <= 0) return
      root.style.setProperty('--workspace-height', `${next.height}px`)
      root.style.setProperty('--workspace-top', `${next.top}px`)
      setViewport(previous => previous.height === next.height && previous.top === next.top ? previous : next)
    }
    const schedule = () => {
      if (frame != null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { frame = null; measure() })
    }
    measure()
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    return () => {
      if (frame != null) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      if (originalHeight) root.style.setProperty('--workspace-height', originalHeight)
      else root.style.removeProperty('--workspace-height')
      if (originalTop) root.style.setProperty('--workspace-top', originalTop)
      else root.style.removeProperty('--workspace-top')
    }
  }, [])

  return { compact, viewport }
}
