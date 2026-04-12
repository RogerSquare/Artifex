import { useState, useEffect, useCallback } from 'react'
import { Sparkle, X, ArrowsDownUp, Tag } from '@phosphor-icons/react'
import { API_URL } from '../config'

export default function SearchFilterBar({ filters, onFiltersChange, galleryTab, authHeaders = {} }) {
  const [tags, setTags] = useState({ models: [], samplers: [] })

  useEffect(() => {
    const params = galleryTab ? `?tab=${galleryTab}` : ''
    fetch(`${API_URL}/images/tags${params}`, { headers: authHeaders })
      .then(res => res.json())
      .then(data => setTags(data))
      .catch(() => {})
  }, [galleryTab, authHeaders])

  const setFilter = useCallback((key, value) => {
    const next = { ...filters, [key]: value || undefined }
    Object.keys(next).forEach(k => { if (next[k] === undefined || next[k] === '') delete next[k] })
    onFiltersChange(next)
  }, [filters, onFiltersChange])

  const activeCount = [filters.model, filters.sampler, filters.has_metadata !== undefined ? String(filters.has_metadata) : null, filters.media_type, filters.sort, filters.tag].filter(Boolean).length

  if (activeCount === 0 && tags.models.length === 0 && tags.samplers.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {tags.models.length > 0 && (
        <select
          value={filters.model || ''}
          onChange={(e) => setFilter('model', e.target.value)}
          className={`h-7 max-w-[160px] bg-white/[0.06] rounded-md px-2.5 text-[12px] font-medium cursor-pointer focus:outline-none appearance-none overflow-hidden text-ellipsis transition-all duration-200
            ${filters.model ? 'text-accent bg-accent/10' : 'text-text-secondary'}`}
          title={filters.model || 'Model'}
        >
          <option value="">Model</option>
          {tags.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      )}

      {tags.samplers.length > 0 && (
        <select
          value={filters.sampler || ''}
          onChange={(e) => setFilter('sampler', e.target.value)}
          className={`h-7 max-w-[140px] bg-white/[0.06] rounded-md px-2.5 text-[12px] font-medium cursor-pointer focus:outline-none appearance-none overflow-hidden text-ellipsis transition-all duration-200
            ${filters.sampler ? 'text-accent bg-accent/10' : 'text-text-secondary'}`}
          title={filters.sampler || 'Sampler'}
        >
          <option value="">Sampler</option>
          {tags.samplers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      <select
        value={filters.media_type || ''}
        onChange={(e) => setFilter('media_type', e.target.value)}
        className={`h-7 bg-white/[0.06] rounded-md px-2.5 text-[12px] font-medium cursor-pointer focus:outline-none appearance-none transition-all duration-200
          ${filters.media_type ? 'text-accent bg-accent/10' : 'text-text-secondary'}`}
      >
        <option value="">All Media</option>
        <option value="image">Images</option>
        <option value="video">Videos</option>
      </select>

      <button
        onClick={() => setFilter('has_metadata', filters.has_metadata === 'true' ? undefined : 'true')}
        className={`h-7 px-2.5 rounded-md text-[12px] font-medium flex items-center gap-1.5 transition-all duration-200
          ${filters.has_metadata === 'true' ? 'bg-accent/10 text-accent' : 'bg-white/[0.06] text-text-secondary hover:text-text'}`}
      >
        <Sparkle className="w-3 h-3" />
        Metadata
      </button>

      <button
        onClick={() => setFilter('sort', filters.sort === 'oldest' ? undefined : 'oldest')}
        className={`h-7 px-2.5 rounded-md text-[12px] font-medium flex items-center gap-1.5 transition-all duration-200
          ${filters.sort === 'oldest' ? 'bg-accent/10 text-accent' : 'bg-white/[0.06] text-text-secondary hover:text-text'}`}
      >
        <ArrowsDownUp className="w-3 h-3" />
        {filters.sort === 'oldest' ? 'Oldest' : 'Newest'}
      </button>

      {filters.tag && (
        <div className="h-7 px-2.5 rounded-md bg-accent/10 text-accent text-[12px] font-medium flex items-center gap-1.5">
          <Tag className="w-3 h-3" />
          {filters.tag}
          <button onClick={() => setFilter('tag', undefined)} className="hover:text-white transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

    </div>
  )
}
