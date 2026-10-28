// hooks/useHistoryPanel.js
import { useCallback, useMemo, useState } from 'react'

/**
 * 管理 HistoryPanel 的开合 & 提供一体化 props。
 * 使用：
 * const { openHistory, closeHistory, historyPanelProps } = useHistoryPanel({...})
 * <HistoryPanel {...historyPanelProps} />
 */
export default function useHistoryPanel({
  snapshotsRef,
  downloadSnapshotsAsJSON,
  downloadSnapshotsAsJSONL,
  clearSnapshots,
}) {
  const [open, setOpen] = useState(false)
  const openHistory = useCallback(() => setOpen(true), [])
  const closeHistory = useCallback(() => setOpen(false), [])

  const historyPanelProps = useMemo(
    () => ({
      open,
      onClose: closeHistory,
      snapshots: snapshotsRef.current,
      onDownloadJSON: downloadSnapshotsAsJSON,
      onDownloadJSONL: downloadSnapshotsAsJSONL,
      onClear: clearSnapshots,
    }),
    [open, closeHistory, snapshotsRef, downloadSnapshotsAsJSON, downloadSnapshotsAsJSONL, clearSnapshots]
  )

  return { openHistory, closeHistory, historyPanelProps }
}
