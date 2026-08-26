// ============================================================
// The last line of defence.
//
// Without one of these, a single render throw anywhere gives a white
// screen with no explanation and no way forward -- the worst thing that
// can happen while someone is being shown the app.
//
// Still a class component: componentDidCatch has no hook equivalent in
// React 19.
// ============================================================

import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Nowhere to report to yet, but the console is where anyone
    // debugging this will look first.
    console.error('Player app crashed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="crash" role="alert">
        <h1>Something broke</h1>
        <p>
          This is a bug in the app, not a problem with your account — your
          matches are safe.
        </p>
        <button type="button" className="retry" onClick={() => window.location.reload()}>
          Reload
        </button>
        {/* Collapsed: useful to whoever is debugging, not something to
            put in front of a player who cannot act on it. */}
        <details>
          <summary>Technical details</summary>
          <pre>{String(this.state.error?.stack ?? this.state.error)}</pre>
        </details>
      </div>
    )
  }
}

export default ErrorBoundary
