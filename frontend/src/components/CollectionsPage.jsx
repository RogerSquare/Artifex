import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash, Globe, Lock, FolderOpen, X, Image, Play } from '@phosphor-icons/react'
import { useAuth } from '../context/AuthContext'
import { API_URL, UPLOADS_URL } from '../config'

export default function CollectionsPage({ onSelectCollection, onSelectImage }) {
  const { user, authHeaders } = useAuth()
  const [collections, setCollections] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newVisibility, setNewVisibility] = useState('private')

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/collections`, { headers: authHeaders })
      if (res.ok) setCollections(await res.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [authHeaders])

  useEffect(() => { fetchCollections() }, [fetchCollections])

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const res = await fetch(`${API_URL}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null, visibility: newVisibility })
      })
      if (res.ok) {
        setNewName('')
        setNewDesc('')
        setNewVisibility('private')
        setShowCreate(false)
        fetchCollections()
      }
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this collection? Images will not be deleted.')) return
    try {
      await fetch(`${API_URL}/collections/${id}`, { method: 'DELETE', headers: authHeaders })
      fetchCollections()
    } catch (e) { console.error(e) }
  }

  if (loading) return <div className="text-center py-16 text-text-muted text-[14px]">Loading collections...</div>

  return (
    <div className="max-w-[1400px] mx-auto px-5 sm:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[20px] font-bold text-text">Collections</h2>
          <p className="text-[13px] text-text-muted mt-0.5">{collections.length} collection{collections.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="h-8 px-4 bg-accent text-white rounded-lg text-[12px] font-semibold hover:bg-accent-hover transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> New Collection
        </button>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="mb-6 bg-bg-card rounded-2xl p-5 border border-white/[0.06]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[15px] font-semibold text-text">New Collection</h3>
            <button onClick={() => setShowCreate(false)} className="p-1.5 text-text-muted hover:text-text rounded-md hover:bg-white/[0.06] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name"
              autoFocus
              className="w-full h-10 bg-bg rounded-xl px-4 text-[14px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full bg-bg rounded-xl px-4 py-3 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => setNewVisibility(newVisibility === 'public' ? 'private' : 'public')}
                className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary hover:text-text transition-colors"
              >
                {newVisibility === 'public' ? <Globe className="w-3.5 h-3.5 text-green" /> : <Lock className="w-3.5 h-3.5" />}
                {newVisibility === 'public' ? 'Public' : 'Private'}
              </button>
              <div className="flex-1" />
              <button onClick={() => setShowCreate(false)} className="h-8 px-4 text-text-secondary text-[12px] font-medium hover:text-text transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!newName.trim()} className="h-8 px-5 bg-accent text-white rounded-lg text-[12px] font-semibold hover:bg-accent-hover transition-colors disabled:opacity-40">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {collections.length === 0 && !showCreate ? (
        <div className="text-center py-20">
          <FolderOpen className="w-12 h-12 text-text-muted/20 mx-auto mb-3" />
          <p className="text-[15px] text-text-muted">No collections yet</p>
          <p className="text-[13px] text-text-muted/60 mt-1">Create one to organize your images</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {collections.map(col => {
            const isOwn = col.user_id === user?.id
            const previews = col.preview_items || []
            return (
              <div
                key={col.id}
                onClick={() => onSelectCollection?.(col)}
                className="group cursor-pointer"
              >
                {/* 2x2 Preview Grid */}
                <div className="aspect-square rounded-2xl overflow-hidden bg-bg-card mb-2.5 relative">
                  {previews.length > 0 ? (
                    <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-[1px]">
                      {[0, 1, 2, 3].map(i => {
                        const item = previews[i]
                        const isVideo = item?.media_type === 'video'
                        const src = item ? `${UPLOADS_URL}/${item.filepath}` : null
                        const isLast = i === 3 && col.image_count > 4
                        return (
                          <div key={i} className="relative overflow-hidden bg-bg">
                            {src ? (
                              <>
                                {isVideo ? (
                                  <video
                                    src={`${src}#t=0.5`}
                                    muted
                                    preload="auto"
                                    playsInline
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  />
                                ) : (
                                  <img src={src} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                )}
                                {isVideo && !isLast && (
                                  <div className="absolute bottom-1 right-1 bg-black/60 backdrop-blur-sm rounded-full p-0.5">
                                    <Play className="w-2.5 h-2.5 text-white" fill="white" />
                                  </div>
                                )}
                                {isLast && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <span className="text-white text-[15px] font-bold">+{col.image_count - 3}</span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="w-full h-full bg-bg-card" />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image className="w-10 h-10 text-text-muted/15" />
                    </div>
                  )}
                  {/* Visibility */}
                  {col.visibility === 'public' && (
                    <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-md rounded-full p-1">
                      <Globe className="w-3 h-3 text-white/70" />
                    </div>
                  )}
                  {/* Delete on hover */}
                  {isOwn && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(col.id) }}
                      className="absolute top-2 left-2 bg-black/50 backdrop-blur-md rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red/80"
                    >
                      <Trash className="w-3 h-3 text-white" />
                    </button>
                  )}
                </div>
                {/* Info */}
                <h3 className="text-[14px] font-semibold text-text truncate">{col.name}</h3>
                {col.description && <p className="text-[12px] text-text-muted truncate mt-0.5">{col.description}</p>}
                {col.owner_username && col.user_id !== user?.id && (
                  <p className="text-[11px] text-text-muted/60 mt-0.5">by {col.owner_username}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
