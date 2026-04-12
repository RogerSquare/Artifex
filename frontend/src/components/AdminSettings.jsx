import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Users, HardDrives, Image, FilmStrip, Heart, Shield, Trash, ArrowCounterClockwise, Prohibit, Key, CircleNotch, Check, ArrowClockwise, ShareNetwork, Globe, Plus, X } from '@phosphor-icons/react'
import { API_URL } from '../config'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'jobs', label: 'Job Queue' },
  { id: 'users', label: 'Users' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'storage', label: 'Storage' },
  { id: 'federation', label: 'Federation' },
  { id: 'system', label: 'System' },
]

const formatSize = (bytes) => {
  if (!bytes) return '0 B'
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

const Badge = ({ color = 'accent', children }) => (
  <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md bg-${color}/10 text-${color}`}>{children}</span>
)

const ActionBtn = ({ onClick, loading, color = 'accent', children }) => (
  <button onClick={onClick} disabled={loading} className={`h-8 px-4 bg-${color} text-white rounded-lg text-[12px] font-semibold hover:bg-${color}/80 transition-colors shrink-0 flex items-center gap-1.5 disabled:opacity-50`}>
    {loading && <CircleNotch className="w-3 h-3 animate-spin" />}
    {children}
  </button>
)

// ─── Overview Tab ───
function OverviewTab({ stats, authHeaders }) {
  const [jobStats, setJobStats] = useState(null)
  const [auditRecent, setAuditRecent] = useState([])

  useEffect(() => {
    fetch(`${API_URL}/tags/jobs/stats`, { headers: authHeaders }).then(r => r.json()).then(setJobStats).catch(() => {})
    fetch(`${API_URL}/admin/audit?limit=10`, { headers: authHeaders }).then(r => r.json()).then(d => setAuditRecent(d.logs || [])).catch(() => {})
  }, [authHeaders])

  if (!stats) return null

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Users', value: stats.users, icon: Users },
          { label: 'Images', value: stats.images, icon: Image },
          { label: 'Videos', value: stats.videos, icon: FilmStrip },
          { label: 'Favorites', value: stats.favorites, icon: Heart },
          { label: 'Storage', value: formatSize(stats.storage), icon: HardDrives },
        ].map(s => (
          <div key={s.label} className="bg-bg-card rounded-2xl p-4 text-center">
            <s.icon className="w-5 h-5 text-text-muted mx-auto mb-2" />
            <p className="text-xl font-bold text-text">{s.value}</p>
            <p className="text-[11px] text-text-muted mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Job queue summary */}
      {jobStats && (
        <div>
          <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-3">ML Processing Queue</h3>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Pending', value: jobStats.pending, color: 'text-yellow' },
              { label: 'Processing', value: jobStats.processing, color: 'text-accent' },
              { label: 'Done', value: jobStats.done, color: 'text-green' },
              { label: 'Failed', value: jobStats.failed, color: 'text-red' },
            ].map(s => (
              <div key={s.label} className="bg-bg-card rounded-xl p-3 text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {auditRecent.length > 0 && (
        <div>
          <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-3">Recent Activity</h3>
          <div className="bg-bg-card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
            {auditRecent.map(log => (
              <div key={log.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md shrink-0
                  ${log.action.includes('delete') || log.action.includes('purge') ? 'bg-red/10 text-red' :
                    log.action.includes('upload') || log.action.includes('register') ? 'bg-green/10 text-green' :
                    log.action.includes('login') ? 'bg-accent/10 text-accent' :
                    'bg-white/[0.06] text-text-muted'}`}
                >{log.action}</span>
                <span className="text-[12px] text-text-secondary truncate flex-1">{log.username || 'system'}</span>
                <span className="text-[11px] text-text-muted shrink-0">{new Date(log.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Audit Log Tab ───
function AuditTab({ authHeaders }) {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)

  const fetchLogs = useCallback(async (off = 0) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: 50, offset: off })
      if (filter) params.set('action', filter)
      const res = await fetch(`${API_URL}/admin/audit?${params}`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setLogs(off === 0 ? data.logs : prev => [...prev, ...data.logs])
        setTotal(data.total)
      }
    } catch {}
    setLoading(false)
  }, [authHeaders, filter])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging when filter changes
  useEffect(() => { setOffset(0); fetchLogs(0) }, [fetchLogs])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={filter} onChange={e => setFilter(e.target.value)} className="h-7 bg-white/[0.06] rounded-md px-2.5 text-[12px] font-medium text-text-secondary cursor-pointer focus:outline-none appearance-none">
          <option value="">All Actions</option>
          <option value="user.">Auth</option>
          <option value="image.">Images</option>
          <option value="admin.">Admin</option>
        </select>
        <span className="text-[12px] text-text-muted ml-auto">{total} entries</span>
      </div>

      <div className="bg-bg-card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
        {logs.map(log => (
          <div key={log.id} className="px-4 py-3 flex items-start gap-3">
            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md shrink-0 mt-0.5
              ${log.action.includes('delete') || log.action.includes('purge') || log.action.includes('disable') ? 'bg-red/10 text-red' :
                log.action.includes('upload') || log.action.includes('register') || log.action.includes('enable') ? 'bg-green/10 text-green' :
                log.action.includes('login') || log.action.includes('password') ? 'bg-accent/10 text-accent' :
                'bg-yellow/10 text-yellow'}`}
            >{log.action}</span>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] text-text">{log.username || 'system'}</span>
              {log.resource_type && <span className="text-[11px] text-text-muted ml-2">{log.resource_type}:{log.resource_id}</span>}
              {log.details && <p className="text-[11px] text-text-muted/60 mt-0.5 truncate">{log.details}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] text-text-muted">{new Date(log.created_at).toLocaleDateString()}</p>
              <p className="text-[10px] text-text-muted/60">{new Date(log.created_at).toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
        {logs.length === 0 && !loading && <div className="px-4 py-8 text-center text-[13px] text-text-muted">No audit entries</div>}
      </div>

      {logs.length < total && (
        <button onClick={() => { const next = offset + 50; setOffset(next); fetchLogs(next) }} disabled={loading} className="w-full py-2 text-[13px] text-accent hover:text-accent-hover transition-colors">
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}

// ─── Job Queue Tab ───
function JobsTab({ authHeaders }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/tags/jobs/stats`, { headers: authHeaders })
      if (res.ok) setStats(await res.json())
    } catch {}
  }, [authHeaders])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch + polling effect
  useEffect(() => { fetchStats(); const t = setInterval(fetchStats, 5000); return () => clearInterval(t) }, [fetchStats])

  const retryFailed = async () => {
    setLoading(true)
    await fetch(`${API_URL}/tags/jobs/retry`, { method: 'POST', headers: authHeaders })
    await fetchStats()
    setLoading(false)
  }

  const cleanup = async () => {
    setLoading(true)
    await fetch(`${API_URL}/tags/jobs/cleanup`, { method: 'DELETE', headers: authHeaders })
    await fetchStats()
    setLoading(false)
  }

  if (!stats) return <div className="text-center py-8 text-text-muted">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Pending', value: stats.pending, color: 'text-yellow' },
          { label: 'Processing', value: stats.processing, color: 'text-accent' },
          { label: 'Completed', value: stats.done, color: 'text-green' },
          { label: 'Failed', value: stats.failed, color: 'text-red' },
        ].map(s => (
          <div key={s.label} className="bg-bg-card rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-text-muted mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        {stats.failed > 0 && (
          <ActionBtn onClick={retryFailed} loading={loading} color="accent">
            <ArrowClockwise className="w-3.5 h-3.5" /> Retry {stats.failed} Failed
          </ActionBtn>
        )}
        {stats.done > 0 && (
          <ActionBtn onClick={cleanup} loading={loading} color="accent">
            <Trash className="w-3.5 h-3.5" /> Clean {stats.done} Completed
          </ActionBtn>
        )}
        <span className="text-[12px] text-text-muted ml-auto">Auto-refreshing every 5s</span>
      </div>
    </div>
  )
}

// ─── Users Tab ───
function UsersTab({ authHeaders }) {
  const [users, setUsers] = useState([])
  const [resetPasswordId, setResetPasswordId] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/admin/users`, { headers: authHeaders })
      if (res.ok) setUsers(await res.json())
    } catch {}
  }, [authHeaders])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch on mount
  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleAction = async (type, userId) => {
    try {
      if (type === 'role') {
        const u = users.find(u => u.id === userId)
        await fetch(`${API_URL}/admin/users/${userId}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ role: u.role === 'admin' ? 'member' : 'admin' }) })
      } else if (type === 'disable') {
        await fetch(`${API_URL}/admin/users/${userId}/disable`, { method: 'PUT', headers: authHeaders })
      } else if (type === 'purge') {
        await fetch(`${API_URL}/admin/users/${userId}/data`, { method: 'DELETE', headers: authHeaders })
      } else if (type === 'delete') {
        await fetch(`${API_URL}/admin/users/${userId}?purge=true`, { method: 'DELETE', headers: authHeaders })
      } else if (type === 'reset-password') {
        if (!newPassword || newPassword.length < 8) return
        await fetch(`${API_URL}/admin/users/${userId}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ newPassword }) })
        setResetPasswordId(null); setNewPassword('')
      }
      setConfirmAction(null)
      fetchUsers()
    } catch {}
  }

  return (
    <>
      <div className="bg-bg-card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
        {users.map(u => (
          <div key={u.id} className="px-5 py-4">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 ${u.disabled ? 'bg-red/10 text-red' : 'bg-accent/10 text-accent'}`}>
                {(u.display_name || u.username).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-text">{u.display_name || u.username}</span>
                  <Badge color={u.role === 'admin' ? 'orange' : 'text-muted'}>{u.role}</Badge>
                  {u.disabled && <Badge color="red">Disabled</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-text-muted">
                  <span>@{u.username}</span>
                  <span>{u.image_count} items</span>
                  <span>{formatSize(u.storage_used)}</span>
                  {u.last_login && <span>Last: {new Date(u.last_login).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleAction('role', u.id)} className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-white/[0.06] transition-all" title="Toggle role"><Shield className="w-4 h-4" /></button>
                <button onClick={() => setResetPasswordId(resetPasswordId === u.id ? null : u.id)} className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-white/[0.06] transition-all" title="Reset password"><Key className="w-4 h-4" /></button>
                <button onClick={() => handleAction('disable', u.id)} className={`p-1.5 rounded-md transition-all ${u.disabled ? 'text-green hover:bg-green/10' : 'text-text-muted hover:text-yellow hover:bg-yellow/10'}`} title={u.disabled ? 'Enable' : 'Disable'}><Prohibit className="w-4 h-4" /></button>
                <button onClick={() => setConfirmAction({ type: 'purge', userId: u.id, username: u.username })} className="p-1.5 rounded-md text-text-muted hover:text-orange hover:bg-orange/10 transition-all" title="Purge data"><ArrowCounterClockwise className="w-4 h-4" /></button>
                <button onClick={() => setConfirmAction({ type: 'delete', userId: u.id, username: u.username })} className="p-1.5 rounded-md text-text-muted hover:text-red hover:bg-red/10 transition-all" title="Delete account"><Trash className="w-4 h-4" /></button>
              </div>
            </div>
            {resetPasswordId === u.id && (
              <div className="flex items-center gap-2 mt-3 ml-12">
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password (min 8 chars)" className="h-8 flex-1 max-w-[240px] bg-bg-elevated rounded-lg px-3 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30" autoFocus />
                <button onClick={() => handleAction('reset-password', u.id)} className="h-8 px-3 bg-accent text-white rounded-lg text-[12px] font-semibold hover:bg-accent-hover transition-colors">Reset</button>
                <button onClick={() => { setResetPasswordId(null); setNewPassword('') }} className="text-[12px] text-text-muted hover:text-text transition-colors">Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmAction(null)}>
          <div className="bg-bg-card rounded-2xl shadow-2xl shadow-black/50 w-full max-w-sm p-6 border border-white/[0.06] text-center" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-semibold text-text mb-2">{confirmAction.type === 'purge' ? 'Purge All Data' : 'Delete Account'}</p>
            <p className="text-[13px] text-text-secondary mb-5">
              {confirmAction.type === 'purge'
                ? `Delete all images/videos by @${confirmAction.username}? Account will remain.`
                : `Permanently delete @${confirmAction.username} and all their data?`}
            </p>
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setConfirmAction(null)} className="h-9 px-4 rounded-xl text-[13px] font-medium text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all">Cancel</button>
              <button onClick={() => handleAction(confirmAction.type, confirmAction.userId)} className="h-9 px-4 bg-red text-white rounded-xl text-[13px] font-semibold hover:bg-red/80 transition-colors">
                {confirmAction.type === 'purge' ? 'Purge' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Content Moderation Tab ───
function ModerationTab({ authHeaders }) {
  const [flagged, setFlagged] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/images?tag=explicit&limit=50`, { headers: authHeaders })
        if (res.ok) { const d = await res.json(); setFlagged(d.images || []) }
      } catch {}
      setLoading(false)
    })()
  }, [authHeaders])

  if (loading) return <div className="text-center py-8 text-text-muted">Loading...</div>

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-text-muted">{flagged.length} image{flagged.length !== 1 ? 's' : ''} flagged as explicit by NSFW detector</p>
      {flagged.length === 0 ? (
        <div className="bg-bg-card rounded-2xl p-8 text-center text-text-muted">
          <Check className="w-8 h-8 mx-auto mb-2 text-green" />
          <p className="text-[14px] font-medium">No flagged content</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {flagged.map(img => (
            <div key={img.id} className="relative group rounded-xl overflow-hidden bg-bg-card aspect-square">
              <img src={`${API_URL.replace('/api', '')}/uploads/${img.thumbnail_path || img.filepath}`} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button onClick={async () => {
                  await fetch(`${API_URL}/images/${img.id}`, { method: 'DELETE', headers: authHeaders })
                  setFlagged(prev => prev.filter(i => i.id !== img.id))
                }} className="p-2 bg-red/80 rounded-lg text-white hover:bg-red transition-colors" title="Delete">
                  <Trash className="w-4 h-4" />
                </button>
              </div>
              <div className="absolute top-1 left-1">
                <Badge color="red">NSFW</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Storage Tab ───
function StorageTab({ stats, authHeaders }) {
  const [loading, setLoading] = useState(false)

  if (!stats) return null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total Storage', value: formatSize(stats.storage) },
          { label: 'Images', value: stats.images },
          { label: 'Videos', value: stats.videos },
        ].map(s => (
          <div key={s.label} className="bg-bg-card rounded-xl p-4 text-center">
            <p className="text-xl font-bold text-text">{s.value}</p>
            <p className="text-[11px] text-text-muted mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-bg-card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
        {stats.orphanFiles > 0 && (
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-medium text-text">Orphan Files</p>
              <p className="text-[12px] text-text-secondary mt-0.5">{stats.orphanFiles} files on disk with no database record</p>
            </div>
            <ActionBtn onClick={async () => {
              if (!window.confirm(`Delete ${stats.orphanFiles} orphan files?`)) return
              setLoading(true)
              await fetch(`${API_URL}/admin/orphan-files`, { method: 'DELETE', headers: authHeaders })
              setLoading(false)
              window.location.reload()
            }} loading={loading} color="red">Clean Up</ActionBtn>
          </div>
        )}
        {stats.orphans > 0 && (
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-medium text-text">Orphaned DB Records</p>
              <p className="text-[12px] text-text-secondary mt-0.5">{stats.orphans} images with no owner</p>
            </div>
            <ActionBtn onClick={async () => {
              if (!window.confirm(`Delete ${stats.orphans} orphaned records?`)) return
              await fetch(`${API_URL}/admin/orphans`, { method: 'DELETE', headers: authHeaders })
              window.location.reload()
            }} color="red">Delete All</ActionBtn>
          </div>
        )}
        {stats.videos > 0 && (
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-medium text-text">Regenerate Video Previews</p>
              <p className="text-[12px] text-text-secondary mt-0.5">Re-encode all {stats.videos} video previews</p>
            </div>
            <ActionBtn onClick={async () => {
              if (!window.confirm('Regenerate all video previews?')) return
              setLoading(true)
              await fetch(`${API_URL}/admin/regenerate-previews`, { method: 'POST', headers: authHeaders })
              setLoading(false)
            }} loading={loading}>Regenerate</ActionBtn>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── System Tab ───
// ─── Federation Tab ───
function FederationTab({ authHeaders }) {
  const [settings, setSettings] = useState(null)
  const [peers, setPeers] = useState([])
  const [newPeerUrl, setNewPeerUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [syncing, setSyncing] = useState({})
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [settingsRes, peersRes] = await Promise.all([
        fetch(`${API_URL}/federation/settings`, { headers: authHeaders }),
        fetch(`${API_URL}/federation/peers`, { headers: authHeaders }),
      ])
      if (settingsRes.ok) setSettings(await settingsRes.json())
      if (peersRes.ok) { const d = await peersRes.json(); setPeers(d.peers || []) }
    } catch {}
  }, [authHeaders])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch on mount
  useEffect(() => { fetchData() }, [fetchData])

  const updateSetting = async (field, value) => {
    await fetch(`${API_URL}/federation/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ [field]: value })
    })
    fetchData()
  }

  const addPeer = async () => {
    if (!newPeerUrl.trim()) return
    setAdding(true); setError('')
    try {
      const res = await fetch(`${API_URL}/federation/peers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ url: newPeerUrl.trim() })
      })
      const data = await res.json()
      if (!res.ok) setError(data.error)
      else { setNewPeerUrl(''); fetchData() }
    } catch { setError('Failed to connect') }
    setAdding(false)
  }

  const removePeer = async (id) => {
    if (!window.confirm('Remove this peer and all cached content?')) return
    await fetch(`${API_URL}/federation/peers/${id}`, { method: 'DELETE', headers: authHeaders })
    fetchData()
  }

  const syncPeer = async (id) => {
    setSyncing(prev => ({ ...prev, [id]: true }))
    await fetch(`${API_URL}/federation/peers/${id}/sync`, { method: 'POST', headers: authHeaders })
    setSyncing(prev => ({ ...prev, [id]: false }))
    fetchData()
  }

  const syncAll = async () => {
    setSyncing(prev => ({ ...prev, all: true }))
    await fetch(`${API_URL}/federation/sync`, { method: 'POST', headers: authHeaders })
    setSyncing(prev => ({ ...prev, all: false }))
    fetchData()
  }

  if (!settings) return <div className="text-center py-8 text-text-muted">Loading...</div>

  return (
    <div className="space-y-6">
      {/* Instance Identity */}
      <div className="bg-bg-card rounded-2xl p-5">
        <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-4">Instance Identity</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">Instance ID</span>
            <span className="text-[12px] text-text-muted font-mono">{settings.instance_id?.substring(0, 8)}...</span>
          </div>
          <div>
            <label className="block text-[12px] text-text-muted mb-1">Instance Name</label>
            <input
              type="text" value={settings.instance_name || ''} onChange={e => setSettings(prev => ({ ...prev, instance_name: e.target.value }))}
              onBlur={e => updateSetting('instance_name', e.target.value)}
              className="w-full h-8 bg-bg-elevated rounded-lg px-3 text-[13px] text-text focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-muted mb-1">Public URL</label>
            <input
              type="text" value={settings.instance_url || ''} placeholder="https://gallery.example.com"
              onChange={e => setSettings(prev => ({ ...prev, instance_url: e.target.value }))}
              onBlur={e => updateSetting('instance_url', e.target.value)}
              className="w-full h-8 bg-bg-elevated rounded-lg px-3 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[13px] text-text">Federation</span>
              <p className="text-[11px] text-text-muted">Allow other instances to discover and sync your public images</p>
            </div>
            <button
              onClick={() => updateSetting('federation_enabled', !settings.federation_enabled)}
              className={`w-12 h-7 rounded-full transition-all duration-200 ${settings.federation_enabled ? 'bg-accent' : 'bg-white/[0.1]'}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${settings.federation_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Peers */}
      <div className="bg-bg-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide">Peers ({peers.length})</h3>
          {peers.length > 0 && (
            <button onClick={syncAll} disabled={syncing.all} className="text-[12px] font-medium text-accent hover:text-accent-hover transition-colors flex items-center gap-1">
              {syncing.all ? <CircleNotch className="w-3 h-3 animate-spin" /> : <ArrowClockwise className="w-3 h-3" />} Sync All
            </button>
          )}
        </div>

        {/* Add peer */}
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text" value={newPeerUrl} onChange={e => setNewPeerUrl(e.target.value)}
            placeholder="https://other-gallery.example.com"
            className="flex-1 h-8 bg-bg-elevated rounded-lg px-3 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30"
            onKeyDown={e => e.key === 'Enter' && addPeer()}
          />
          <button onClick={addPeer} disabled={adding || !newPeerUrl.trim()} className="h-8 px-3 bg-accent text-white rounded-lg text-[12px] font-semibold hover:bg-accent-hover disabled:opacity-40 transition-all flex items-center gap-1">
            {adding ? <CircleNotch className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
          </button>
        </div>
        {error && <p className="text-[12px] text-red mb-3">{error}</p>}

        {/* Peer list */}
        {peers.length === 0 ? (
          <div className="text-center py-6">
            <ShareNetwork className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
            <p className="text-[13px] text-text-muted">No peers added yet</p>
            <p className="text-[11px] text-text-muted/60 mt-0.5">Enter another Artifex instance URL above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {peers.map(peer => (
              <div key={peer.id} className="flex items-center gap-3 p-3 bg-bg-elevated rounded-xl">
                <span className={`w-2 h-2 rounded-full shrink-0 ${peer.status === 'active' ? 'bg-green' : peer.status === 'error' ? 'bg-red' : 'bg-yellow'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text truncate">{peer.name}</span>
                    <span className="text-[11px] text-text-muted">{peer.image_count} images</span>
                  </div>
                  <p className="text-[11px] text-text-muted/60 truncate">{peer.url}</p>
                  {peer.error && <p className="text-[10px] text-red truncate">{peer.error}</p>}
                  {peer.last_synced_at && <p className="text-[10px] text-text-muted/40">Last sync: {new Date(peer.last_synced_at).toLocaleString()}</p>}
                </div>
                <button onClick={() => syncPeer(peer.id)} disabled={syncing[peer.id]} className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-all" title="Sync now">
                  {syncing[peer.id] ? <CircleNotch className="w-4 h-4 animate-spin" /> : <ArrowClockwise className="w-4 h-4" />}
                </button>
                <button onClick={() => removePeer(peer.id)} className="p-1.5 rounded-md text-text-muted hover:text-red hover:bg-red/10 transition-all" title="Remove">
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SystemTab({ authHeaders }) {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState({})

  useEffect(() => {
    fetch(`${API_URL}/health`).then(r => r.json()).then(setHealth).catch(() => {})
  }, [])

  const runBatch = async (endpoint, key) => {
    setLoading(prev => ({ ...prev, [key]: true }))
    try {
      await fetch(`${API_URL}/tags/${endpoint}?limit=100`, { method: 'POST', headers: authHeaders })
    } catch {}
    setLoading(prev => ({ ...prev, [key]: false }))
  }

  return (
    <div className="space-y-6">
      {health && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-card rounded-xl p-4 text-center">
            <p className="text-xl font-bold text-green">{Math.floor(health.uptime / 60)}m</p>
            <p className="text-[11px] text-text-muted mt-1">Uptime</p>
          </div>
          <div className="bg-bg-card rounded-xl p-4 text-center">
            <p className="text-xl font-bold text-text">{health.images}</p>
            <p className="text-[11px] text-text-muted mt-1">Total Images</p>
          </div>
          <div className="bg-bg-card rounded-xl p-4 text-center">
            <p className="text-xl font-bold text-accent">OK</p>
            <p className="text-[11px] text-text-muted mt-1">Status</p>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-3">Batch Operations</h3>
        <div className="bg-bg-card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
          {[
            { label: 'Re-tag All Images', desc: 'Run vision tagging (WD Tagger + CLIP) on untagged images', endpoint: 'vision/batch', key: 'vision' },
            { label: 'Re-caption All Images', desc: 'Generate BLIP captions for uncaptioned images', endpoint: 'caption/batch', key: 'caption' },
            { label: 'NSFW Scan All', desc: 'Run NSFW detection on unscanned images', endpoint: 'nsfw/batch', key: 'nsfw' },
            { label: 'Backfill Metadata Tags', desc: 'Extract tags from metadata for untagged images', endpoint: 'backfill', key: 'backfill' },
          ].map(op => (
            <div key={op.key} className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[14px] font-medium text-text">{op.label}</p>
                <p className="text-[12px] text-text-secondary mt-0.5">{op.desc}</p>
              </div>
              <ActionBtn onClick={() => runBatch(op.endpoint, op.key)} loading={loading[op.key]}>Run</ActionBtn>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Admin Dashboard ───
export default function AdminSettings({ onBack }) {
  const { user, authHeaders } = useAuth()
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch(`${API_URL}/admin/stats`, { headers: authHeaders }).then(r => r.json()).then(setStats).catch(() => {})
  }, [authHeaders])

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[1100px] mx-auto px-5 sm:px-8">
          <div className="h-11 flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 -ml-1 rounded-md text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-[15px] font-semibold">Admin Dashboard</h1>
          </div>
          {/* Tabs */}
          <nav className="flex items-center gap-0.5 -mb-px overflow-x-auto pb-px">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-[13px] font-medium border-b-2 transition-all duration-200 whitespace-nowrap
                  ${tab === t.id ? 'text-accent border-accent' : 'text-text-muted border-transparent hover:text-text-secondary'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-[1100px] mx-auto px-5 sm:px-8 py-8">
        {tab === 'overview' && <OverviewTab stats={stats} authHeaders={authHeaders} />}
        {tab === 'audit' && <AuditTab authHeaders={authHeaders} />}
        {tab === 'jobs' && <JobsTab authHeaders={authHeaders} />}
        {tab === 'users' && <UsersTab authHeaders={authHeaders} currentUser={user} />}
        {tab === 'moderation' && <ModerationTab authHeaders={authHeaders} />}
        {tab === 'storage' && <StorageTab stats={stats} authHeaders={authHeaders} />}
        {tab === 'federation' && <FederationTab authHeaders={authHeaders} />}
        {tab === 'system' && <SystemTab authHeaders={authHeaders} />}
      </div>
    </div>
  )
}
