import { Component } from 'react'
import { ArrowCounterClockwise, Warning } from '@phosphor-icons/react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red/10 flex items-center justify-center mb-4">
            <Warning className="w-7 h-7 text-red" />
          </div>
          <h2 className="text-[16px] font-semibold text-text mb-1">Something went wrong</h2>
          <p className="text-[13px] text-text-muted mb-5 max-w-[300px]">
            {this.props.message || 'An unexpected error occurred. Try refreshing this section.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="h-9 px-4 bg-accent hover:bg-accent-hover text-white rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2"
          >
            <ArrowCounterClockwise className="w-4 h-4" />
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
