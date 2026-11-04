// src/components/WelcomeCard.jsx
// A first-visit explanation of what Treellis is and how its panels fit together.
// Dismissed once per browser; "Show tips" in More brings it back.
import React from 'react'

export const WELCOME_STORAGE_KEY = 'treellis.welcome.dismissed'

export function welcomeDismissed() {
  try { return localStorage.getItem(WELCOME_STORAGE_KEY) === '1' } catch { return false }
}

export function rememberWelcomeDismissed(value = true) {
  try {
    if (value) localStorage.setItem(WELCOME_STORAGE_KEY, '1')
    else localStorage.removeItem(WELCOME_STORAGE_KEY)
  } catch {}
}

export default function WelcomeCard({ compact = false, onDismiss, onBrowseExamples, onStartPrompt }) {
  return (
    <section className="welcome-card" aria-labelledby="welcome-card-title">
      <button type="button" className="welcome-card__close" onClick={onDismiss} aria-label="Close tips">×</button>
      <h2 id="welcome-card-title">Build 3D models by describing them</h2>
      <p className="welcome-card__lead">
        Treellis turns a sentence into a model made of simple shapes. Every part stays editable.
      </p>
      <ol className="welcome-card__steps">
        <li><strong>Describe</strong> an object in the {compact ? 'Prompt tab' : 'prompt box below'}, or open an example.</li>
        <li><strong>Explore</strong> its parts in the {compact ? 'Structure tab' : 'tree on the left'}.</li>
        <li><strong>Select</strong> a part to fine-tune it in {compact ? 'Parameters' : 'Parameters on the right'}, or ask AI to change it.</li>
      </ol>
      <div className="welcome-card__actions">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={onStartPrompt}>Describe something</button>
        <button type="button" className="ui-btn ui-btn--sm" onClick={onBrowseExamples}>Browse examples</button>
        <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={onDismiss}>Got it</button>
      </div>
    </section>
  )
}
