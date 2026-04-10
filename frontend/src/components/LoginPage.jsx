import { useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { useAuth } from '../context/AuthContext'

function PasswordStrength({ password }) {
  if (!password) return null
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++
  score = Math.min(score, 4)

  const colors = ['bg-red', 'bg-orange', 'bg-yellow', 'bg-green', 'bg-green']
  const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong']

  return (
    <div className="px-4 pb-3 pt-1">
      <div className="flex gap-1 mb-1">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= score - 1 ? colors[score] : 'bg-white/[0.06]'}`} />
        ))}
      </div>
      <span className={`text-[11px] ${score <= 1 ? 'text-red' : score <= 2 ? 'text-yellow' : 'text-green'}`}>{labels[score]}</span>
    </div>
  )
}

export default function LoginPage({ onBack }) {
  const { login, register } = useAuth()
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isRegister) {
        await register(username, password, displayName || undefined)
      } else {
        await login(username, password)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[340px]">
        {/* Logo */}
        <div className="text-center mb-10">
          <img src="/favicon.svg" alt="Artifex" className="w-16 h-16 mx-auto mb-5" />
          <h1 className="text-[28px] font-bold text-text tracking-tight">Artifex</h1>
          <p className="text-[15px] text-text-muted mt-1">{isRegister ? 'Create your account' : 'Sign in to continue'}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="px-4 py-3 bg-red/10 rounded-xl text-[13px] text-red text-center font-medium">
              {error}
            </div>
          )}

          <div className="bg-bg-card rounded-2xl overflow-hidden divide-y divide-white/[0.06]">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full bg-transparent px-4 py-3.5 text-[15px] text-text placeholder:text-text-muted focus:outline-none"
              required
              autoFocus
            />
            {isRegister && (
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name (optional)"
                className="w-full bg-transparent px-4 py-3.5 text-[15px] text-text placeholder:text-text-muted focus:outline-none"
              />
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-transparent px-4 py-3.5 text-[15px] text-text placeholder:text-text-muted focus:outline-none"
              required
            />
            {isRegister && <PasswordStrength password={password} />}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-xl text-[15px] font-semibold transition-all duration-200 flex items-center justify-center"
          >
            {loading ? <CircleNotch className="w-5 h-5 animate-spin" /> : isRegister ? 'Create Account' : 'Sign In'}
          </button>

          <p className="text-center text-[13px] text-text-muted pt-2">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError('') }}
              className="text-accent hover:text-accent-hover font-medium transition-colors"
            >
              {isRegister ? 'Sign In' : 'Create Account'}
            </button>
          </p>
          {onBack && (
            <p className="text-center text-[13px] text-text-muted pt-1">
              <button type="button" onClick={onBack} className="text-text-secondary hover:text-text font-medium transition-colors">
                Browse public gallery
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
