import { useState, useEffect, useCallback, useRef } from 'react'
import { PaperPlaneRight, Trash, ChatCircle } from '@phosphor-icons/react'
import { API_URL, UPLOADS_URL } from '../config'
import { useAuth } from '../context/AuthContext'

export default function CommentSection({ imageId }) {
  const { user, authHeaders } = useAuth()
  const [comments, setComments] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/images/${imageId}/comments`)
      if (res.ok) setComments(await res.json())
    } catch (e) { /* ignore */ }
  }, [imageId])

  useEffect(() => { fetchComments() }, [fetchComments])

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!input.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`${API_URL}/images/${imageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ content: input.trim() })
      })
      if (res.ok) {
        const comment = await res.json()
        setComments(prev => [...prev, comment])
        setInput('')
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
      }
    } catch (e) { /* ignore */ }
    finally { setSending(false) }
  }

  const handleDelete = async (commentId) => {
    try {
      const res = await fetch(`${API_URL}/images/${imageId}/comments/${commentId}`, { method: 'DELETE', headers: authHeaders })
      if (res.ok) setComments(prev => prev.filter(c => c.id !== commentId))
    } catch (e) { /* ignore */ }
  }

  const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'now'
    if (min < 60) return `${min}m`
    const hr = Math.floor(diff / 3600000)
    if (hr < 24) return `${hr}h`
    const day = Math.floor(diff / 86400000)
    return `${day}d`
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ChatCircle className="w-3.5 h-3.5 text-text-secondary" />
        <span className="text-[12px] font-semibold text-text-secondary uppercase tracking-wide">Comments</span>
        {comments.length > 0 && <span className="text-[11px] text-text-muted">{comments.length}</span>}
      </div>

      {/* Comment list */}
      {comments.length > 0 ? (
        <div className="space-y-3 mb-3 max-h-[300px] overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2.5 group">
              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 mt-0.5">
                {c.avatar ? (
                  <img src={`${UPLOADS_URL}/${c.avatar}`} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-bg-elevated flex items-center justify-center text-[9px] font-bold text-text-muted">
                    {(c.display_name || c.username || '?').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-text">{c.display_name || c.username}</span>
                  <span className="text-[10px] text-text-muted">{timeAgo(c.created_at)}</span>
                  {(c.user_id === user?.id || user?.role === 'admin') && (
                    <button onClick={() => handleDelete(c.id)} className="p-0.5 text-text-muted/0 group-hover:text-text-muted hover:!text-red rounded transition-colors ml-auto">
                      <Trash className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <p className="text-[13px] text-text-secondary leading-relaxed break-words">{c.content}</p>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      ) : (
        <p className="text-[12px] text-text-muted mb-3">No comments yet</p>
      )}

      {/* Input */}
      {user && (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a comment..."
            maxLength={2000}
            className="flex-1 h-8 bg-bg-elevated rounded-lg px-3 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="w-8 h-8 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-30 text-white flex items-center justify-center transition-all"
          >
            <PaperPlaneRight className="w-3.5 h-3.5" />
          </button>
        </form>
      )}
    </div>
  )
}
