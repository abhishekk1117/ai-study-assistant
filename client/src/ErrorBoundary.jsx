import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('UI crashed:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
          <h1>Something went wrong</h1>
          <p>
            The app hit an unexpected error. Refresh the page to retry. If the
            issue continues, restart the frontend server.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
