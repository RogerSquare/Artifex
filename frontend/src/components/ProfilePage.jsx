import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Image, Heart, Calendar, PencilSimple, Check, X, CircleNotch, Camera } from '@phosphor-icons/react'
import { API_URL, UPLOADS_URL } from '../config'
import { useAuth } from '../context/AuthContext'
import ImageCard from './ImageCard'

export default function ProfilePage({ username, onBack, onSelectImage }) {
  const { user: currentUser, authHeaders } = useAuth()
  const [profile, setProfile] = useState(null)
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef(null)

  const isOwnProfile = currentUser?.username === username

  const fetchProfile = useCallback(async () => {
    try {
      const [profileRes, imagesRes] = await Promise.all([
        fetch(`${API_URL}/auth/users/${username}`),
        fetch(`${API_URL}/auth/users/${username}/images?limit=100`),
      ])
      if (profileRes.ok) {
        const data = await profileRes.json()
        setProfile(data)
        setEditName(data.display_name || '')
        setEditBio(data.bio || '')
      }
      if (imagesRes.ok) {
        const data = await imagesRes.json()
        setImages(data.images)
      }
    } catch (e) { /* ignore */ }
    finally { setLoading(false) }
  }, [username])

  useEffect(() => { fetchProfile() }, [fetchProfile])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_URL}/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ display_name: editName, bio: editBio })
      })
      if (res.ok) {
        const data = await res.json()
        setProfile(prev => ({ ...prev, display_name: data.display_name, bio: data.bio }))
        setEditing(false)
      }
    } catch (e) { /* ignore */ }
    finally { setSaving(false) }
  }

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)
      const res = await fetch(`${API_URL}/auth/avatar`, { method: 'POST', headers: authHeaders, body: formData })
      if (res.ok) {
        const data = await res.json()
        setProfile(prev => ({ ...prev, avatar: data.avatar }))
      }
    } catch (e) { /* ignore */ }
    finally { setUploadingAvatar(false); e.target.value = '' }
  }

  if (loading) return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted">Loading...</div>
  if (!profile) return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted">User not found</div>

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[1000px] mx-auto px-5 sm:px-8 h-11 flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1 rounded-md text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-[15px] font-semibold">Profile</h1>
        </div>
      </div>

      <div className="max-w-[1000px] mx-auto px-5 sm:px-8 py-8">
        {/* Profile header */}
        <div className="mb-8">
          {editing ? (
            /* Edit mode — centered, full width */
            <div className="max-w-[440px] mx-auto">
              <div className="flex flex-col items-center mb-5">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative w-20 h-20 rounded-full overflow-hidden group shrink-0"
                  disabled={uploadingAvatar}
                >
                  {profile.avatar ? (
                    <img src={`${UPLOADS_URL}/${profile.avatar}`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-b from-accent/60 to-accent flex items-center justify-center text-2xl font-bold text-white">
                      {(editName || profile.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {uploadingAvatar ? <CircleNotch className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
                  </div>
                </button>
                <input ref={avatarInputRef} type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleAvatarUpload} className="hidden" />
                <span className="text-[11px] text-text-muted mt-2">Tap to change</span>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide block mb-1.5">Display Name</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Display name"
                    className="w-full h-10 bg-bg-card rounded-xl px-4 text-[15px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted uppercase tracking-wide block mb-1.5">Bio</label>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Write a short bio..."
                    rows={3}
                    className="w-full bg-bg-card rounded-xl px-4 py-3 text-[14px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={handleSave} disabled={saving} className="h-9 px-4 bg-accent text-white rounded-xl text-[13px] font-semibold hover:bg-accent-hover transition-colors flex items-center gap-1.5">
                    {saving ? <CircleNotch className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
                  </button>
                  <button onClick={() => setEditing(false)} className="h-9 px-4 text-text-secondary hover:text-text rounded-xl text-[13px] font-medium hover:bg-white/[0.06] transition-colors">Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            /* View mode — avatar + info side by side */
            <div className="flex gap-6">
              <div className="flex flex-col items-center shrink-0" style={{ paddingTop: '4px' }}>
                <div className="w-20 h-20 rounded-full overflow-hidden">
                  {profile.avatar ? (
                    <img src={`${UPLOADS_URL}/${profile.avatar}`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-b from-accent/60 to-accent flex items-center justify-center text-2xl font-bold text-white">
                      {(profile.display_name || profile.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                {isOwnProfile && (
                  <button onClick={() => setEditing(true)} className="mt-2 px-3 py-1 rounded-full text-[11px] font-medium text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all">
                    Edit
                  </button>
                )}
              </div>
              <div className="flex-1 min-w-0" style={{ paddingTop: '8px' }}>
                <div className="flex items-center gap-3">
                  <h2 className="text-[22px] font-bold text-text">{profile.display_name || profile.username}</h2>
                </div>
                <p className="text-[13px] text-text-muted mt-0.5">@{profile.username}</p>
                {profile.bio && <p className="text-[14px] text-text-secondary mt-2 max-w-[400px]">{profile.bio}</p>}

                <div className="flex items-center gap-5 mt-4">
                  <div className="flex items-center gap-1.5 text-[13px]">
                    <Image className="w-4 h-4 text-text-muted" />
                    <span className="font-semibold text-text">{profile.public_count}</span>
                    <span className="text-text-muted">public</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px]">
                    <Heart className="w-4 h-4 text-text-muted" />
                    <span className="font-semibold text-text">{profile.total_favorites_received}</span>
                    <span className="text-text-muted">favorites</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px]">
                    <Calendar className="w-4 h-4 text-text-muted" />
                    <span className="text-text-muted">Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Public images grid */}
        {images.length > 0 ? (
          <div>
            <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-4">Public Gallery</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map(image => (
                <ImageCard
                  key={image.id}
                  image={image}
                  onClick={onSelectImage}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <Image className="w-12 h-12 text-text-muted/15 mx-auto mb-3" />
            <p className="text-[14px] text-text-muted">No public images yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
