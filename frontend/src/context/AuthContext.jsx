import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { API_URL } from '../config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('galleryToken'))
  // Lazy init: if there's no token, we're not loading anything — skip the spinner.
  const [loading, setLoading] = useState(() => !!localStorage.getItem('galleryToken'))

  // Verify token on mount
  useEffect(() => {
    if (!token) return

    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (res.ok) return res.json()
        throw new Error('Invalid token')
      })
      .then(data => setUser(data))
      .catch(() => {
        localStorage.removeItem('galleryToken')
        setToken(null)
      })
      .finally(() => setLoading(false))
  }, [token])

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Login failed')

    localStorage.setItem('galleryToken', data.token)
    setToken(data.token)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (username, password, display_name) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, display_name })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Registration failed')

    localStorage.setItem('galleryToken', data.token)
    setToken(data.token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('galleryToken')
    setToken(null)
    setUser(null)
  }, [])

  // Helper to get auth headers for API calls
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  return (
    <AuthContext.Provider value={{ user, token, authHeaders, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
