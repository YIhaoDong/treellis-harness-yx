// hooks/usePanelTitleSync.js
import { useEffect } from 'react'
import { getNodeAtPath } from '../utils/tree'

/**
 * 保持面板标题与选中节点名称同步。
 * 使用：usePanelTitleSync({ liveScene, panelPath, setPanelTitle })
 */
export default function usePanelTitleSync({ liveScene, panelPath, setPanelTitle }) {
  useEffect(() => {
    if (!panelPath || !liveScene) return
    const n = getNodeAtPath(liveScene, panelPath)
    if (n) setPanelTitle(n.name || 'Parameters')
  }, [liveScene, panelPath, setPanelTitle])
}
