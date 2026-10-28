// src/hooks/useSplitter.jsx
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 可复用的左右分栏拖拽 Hook。
 * - initialPct:   初始左侧宽度百分比
 * - minPct/maxPct:允许拖拽的左右边界（百分比）
 *
 * 返回：
 * - leftPct, setLeftPct: 左侧百分比与设置器（双击复位时可用）
 * - containerRef: 给最外层容器（包含左右两栏与分割条的那个）绑定 ref
 * - startDrag(clientX): 在分割条的 onMouseDown/onTouchStart 调用即可
 */
export default function useSplitter(initialPct = 40, minPct = 20, maxPct = 70) {
  const [leftPct, setLeftPct] = useState(initialPct)
  const containerRef = useRef(null)
  const draggingRef = useRef(false)

  const updateFromClientX = useCallback((clientX) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    let pct = (x / rect.width) * 100
    if (!Number.isFinite(pct)) return
    pct = Math.max(minPct, Math.min(maxPct, pct))
    setLeftPct(pct)
  }, [minPct, maxPct])

  const startDrag = useCallback((clientX) => {
    draggingRef.current = true
    // 临时改变页面样式，避免选中与光标抖动
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    updateFromClientX(clientX)
  }, [updateFromClientX])

  const stopDrag = useCallback(() => {
    draggingRef.current = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [])

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return
      updateFromClientX(e.clientX)
    }
    const onUp = () => stopDrag()

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mouseleave', onUp)

    const onTouchMove = (e) => {
      if (!draggingRef.current) return
      const t = e.touches && e.touches[0]
      if (t) updateFromClientX(t.clientX)
    }
    const onTouchEnd = () => stopDrag()

    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', onTouchEnd)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mouseleave', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [stopDrag, updateFromClientX])

  return { leftPct, setLeftPct, containerRef, startDrag }
}
