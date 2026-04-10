import { useEffect } from 'react'
import { X } from '@phosphor-icons/react'

const Key = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-white/[0.08] border border-white/[0.12] rounded-md text-[11px] font-medium text-text-secondary shadow-sm">
    {children}
  </kbd>
)

const Shortcut = ({ keys, label }) => (
  <div className="flex items-center justify-between py-1.5">
    <span className="text-[13px] text-text/80">{label}</span>
    <div className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-text-muted">+</span>}
          <Key>{k}</Key>
        </span>
      ))}
    </div>
  </div>
)

const Section = ({ title, children }) => (
  <div className="mb-5">
    <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">{title}</h3>
    <div className="divide-y divide-white/[0.04]">{children}</div>
  </div>
)

export default function ShortcutsOverlay({ onClose, context = 'gallery' }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' || e.key === '?') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg-card rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden border border-white/[0.06]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 h-12 border-b border-white/[0.06]">
          <h2 className="text-[15px] font-semibold">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-white/[0.06] transition-all duration-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          {context === 'viewer' ? (
            <>
              <Section title="Photo Viewer">
                <Shortcut keys={['Esc']} label="Close viewer" />
                <Shortcut keys={['←']} label="Previous image" />
                <Shortcut keys={['→']} label="Next image" />
                <Shortcut keys={['I']} label="Toggle info panel" />
                <Shortcut keys={['Scroll']} label="Zoom in / out" />
                <Shortcut keys={['Click']} label="Zoom to point" />
              </Section>
              <Section title="Gallery">
                <Shortcut keys={['Ctrl', 'Shift', 'A']} label="Toggle select mode" />
                <Shortcut keys={['Ctrl', 'V']} label="Paste image to upload" />
                <Shortcut keys={['?']} label="Show this overlay" />
              </Section>
            </>
          ) : (
            <>
              <Section title="Gallery">
                <Shortcut keys={['Ctrl', 'Shift', 'A']} label="Toggle select mode" />
                <Shortcut keys={['Esc']} label="Exit select mode" />
                <Shortcut keys={['Ctrl', 'V']} label="Paste image to upload" />
                <Shortcut keys={['?']} label="Show this overlay" />
              </Section>
              <Section title="Photo Viewer">
                <Shortcut keys={['Esc']} label="Close viewer" />
                <Shortcut keys={['←']} label="Previous image" />
                <Shortcut keys={['→']} label="Next image" />
                <Shortcut keys={['I']} label="Toggle info panel" />
                <Shortcut keys={['Scroll']} label="Zoom in / out" />
                <Shortcut keys={['Click']} label="Zoom to point" />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
