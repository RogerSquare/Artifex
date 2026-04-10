import { useState, useEffect } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { API_URL } from '../config'
import { useAuth } from '../context/AuthContext'

const formatSize = (bytes) => {
  if (!bytes) return '0 B'
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

// Simple horizontal bar chart component
function BarChart({ data, maxBars = 10, color = 'accent' }) {
  if (!data || data.length === 0) return <p className="text-[13px] text-text-muted py-4 text-center">No data</p>
  const items = data.slice(0, maxBars)
  const max = Math.max(...items.map(d => d.count))

  return (
    <div className="space-y-1.5">
      {items.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-[12px] text-text-secondary w-28 truncate shrink-0 text-right" title={d.name || d.value}>{d.name || d.value}</span>
          <div className="flex-1 h-5 bg-white/[0.04] rounded-full overflow-hidden">
            <div className={`h-full bg-${color} rounded-full transition-all duration-500`} style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
          <span className="text-[11px] text-text-muted w-8 shrink-0 tabular-nums">{d.count}</span>
        </div>
      ))}
    </div>
  )
}

// Mini donut-like pill distribution
function PillChart({ data }) {
  if (!data || data.length === 0) return null
  const total = data.reduce((s, d) => s + d.count, 0)
  const colors = ['bg-accent', 'bg-green', 'bg-orange', 'bg-red', 'bg-yellow', 'bg-purple-400']

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {data.map((d, i) => (
          <div key={i} className={`${colors[i % colors.length]} transition-all duration-500`} style={{ width: `${(d.count / total) * 100}%` }} title={`${d.name || d.orientation}: ${d.count}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${colors[i % colors.length]}`} />
            <span className="text-[11px] text-text-secondary">{d.name || d.orientation} <span className="text-text-muted">{d.count}</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Timeline sparkline
function Timeline({ data }) {
  if (!data || data.length === 0) return <p className="text-[13px] text-text-muted py-4 text-center">No uploads in the last 30 days</p>
  const max = Math.max(...data.map(d => d.count))

  return (
    <div className="flex items-end gap-[2px] h-20">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end group">
          <div className="w-full bg-accent/80 rounded-t-sm transition-all duration-300 group-hover:bg-accent min-h-[2px]" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} title={`${d.date}: ${d.count} uploads`} />
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-bg-card rounded-2xl p-5">
      <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  )
}

export default function StatsDashboard({ onBack }) {
  const { authHeaders } = useAuth()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/generation-stats`, { headers: authHeaders })
        if (res.ok) setStats(await res.json())
      } catch (e) {}
      setLoading(false)
    })()
  }, [authHeaders])

  if (loading) return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted">Loading...</div>

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[1100px] mx-auto px-5 sm:px-8 h-11 flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1 rounded-md text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-[15px] font-semibold">Generation Stats</h1>
        </div>
      </div>

      {stats && (
        <div className="max-w-[1100px] mx-auto px-5 sm:px-8 py-8 space-y-6">
          {/* Uploads timeline */}
          <Section title="Uploads — Last 30 Days">
            <Timeline data={stats.uploadsOverTime} />
            {stats.uploadsOverTime.length > 0 && (
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-text-muted">{stats.uploadsOverTime[0]?.date}</span>
                <span className="text-[10px] text-text-muted">{stats.uploadsOverTime[stats.uploadsOverTime.length - 1]?.date}</span>
              </div>
            )}
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Models */}
            <Section title="Most Used Models">
              <BarChart data={stats.models} color="accent" />
            </Section>

            {/* Samplers */}
            <Section title="Most Used Samplers">
              <BarChart data={stats.samplers} color="green" />
            </Section>

            {/* Steps */}
            <Section title="Steps Distribution">
              <BarChart data={stats.steps} color="orange" />
            </Section>

            {/* CFG Scale */}
            <Section title="CFG Scale Distribution">
              <BarChart data={stats.cfgScales} color="yellow" />
            </Section>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Resolution */}
            <Section title="Orientation">
              <PillChart data={stats.resolutions} />
            </Section>

            {/* Media Types */}
            <Section title="Media Types">
              <PillChart data={stats.mediaTypes} />
            </Section>
          </div>

          {/* Top Tags */}
          <Section title="Top Vision Tags">
            <div className="flex flex-wrap gap-1.5">
              {stats.topTags.map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-accent/10 text-accent">
                  {tag.name}
                  <span className="text-accent/50">{tag.count}</span>
                </span>
              ))}
            </div>
          </Section>

          {/* Per User */}
          {stats.perUser.length > 0 && (
            <Section title="Per User">
              <div className="bg-bg-elevated rounded-xl overflow-hidden divide-y divide-white/[0.04]">
                {stats.perUser.map((u, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-[13px] text-text">{u.display_name || u.username}</span>
                    <div className="flex items-center gap-4 text-[12px] text-text-muted">
                      <span>{u.image_count} images</span>
                      <span>{formatSize(u.storage_bytes)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
