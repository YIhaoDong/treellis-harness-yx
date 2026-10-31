import React from 'react'

const tabs = [
  { id: 'model', title: 'Model', panel: 'workspace-center-panel', icon: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" /></> },
  { id: 'structure', title: 'Structure', panel: 'workspace-structure-panel', icon: <><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" /></> },
  { id: 'parameters', title: 'Parameters', panel: 'workspace-parameters-panel', icon: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" fill="white" /><circle cx="16" cy="12" r="2" fill="white" /><circle cx="10" cy="18" r="2" fill="white" /></> },
  { id: 'create', title: 'Prompt', panel: 'workspace-center-panel', icon: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" /></> },
]

export default function MobileWorkspaceTabs({ active, onChange, selectedCount = 0, busy = false }) {
  return (
    <nav className="workspace-mobile-tabs" role="tablist" aria-label="Workspace panels">
      {tabs.map((tab, index) => (
        <button key={tab.id} id={`workspace-tab-${tab.id}`} type="button" role="tab"
          aria-selected={active === tab.id} aria-controls={tab.panel} tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length :
              event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length :
                event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
            if (next == null) return
            event.preventDefault()
            onChange(tabs[next].id)
            document.getElementById(`workspace-tab-${tabs[next].id}`)?.focus()
          }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{tab.icon}</svg>
          <span>{tab.title}{tab.id === 'parameters' && selectedCount ? ` (${selectedCount})` : ''}{tab.id === 'create' && busy ? ' •' : ''}</span>
        </button>
      ))}
    </nav>
  )
}
