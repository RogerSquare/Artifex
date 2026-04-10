import { ArrowLeft, Check } from '@phosphor-icons/react'

const THEMES = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'True black with blue accent. Clean and minimal.',
    bg: '#000000',
    card: '#1c1c1e',
    accent: '#0a84ff',
    text: '#f5f5f7',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Dark gray with warm gray accent. Professional and muted.',
    bg: '#1d1d1f',
    card: '#2a2a2c',
    accent: '#86868b',
    text: '#f5f5f7',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep navy with teal accent. Cool and calming.',
    bg: '#0a1628',
    card: '#12203a',
    accent: '#30d5c8',
    text: '#e8eef6',
  },
  {
    id: 'rosewood',
    name: 'Rosewood',
    description: 'Warm brown with rose accent. Artistic feel.',
    bg: '#1a1210',
    card: '#281c18',
    accent: '#ff6b6b',
    text: '#f2ebe7',
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Classic white with blue accent. Apple standard.',
    bg: '#ffffff',
    card: '#f2f2f7',
    accent: '#007aff',
    text: '#1d1d1f',
  },
]

export default function ThemePage({ theme, onThemeChange, onBack }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[700px] mx-auto px-5 sm:px-8 h-11 flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1 rounded-md text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-[15px] font-semibold">Appearance</h1>
        </div>
      </div>

      <div className="max-w-[700px] mx-auto px-5 sm:px-8 py-8">
        <p className="text-[13px] text-text-secondary mb-6">Choose a theme for Artifex. The selected theme applies immediately.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {THEMES.map(t => {
            const isActive = theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => onThemeChange(t.id)}
                className={`relative text-left rounded-2xl overflow-hidden transition-all duration-300 ${isActive ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : 'hover:scale-[1.02]'}`}
              >
                {/* Theme preview */}
                <div className="h-32 relative" style={{ background: t.bg }}>
                  {/* Mock UI elements */}
                  <div className="absolute top-3 left-3 right-3 h-5 rounded-md flex items-center px-2 gap-1.5" style={{ background: t.card }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: t.accent }} />
                    <div className="h-1.5 w-12 rounded-full" style={{ background: t.text, opacity: 0.3 }} />
                    <div className="flex-1" />
                    <div className="h-1.5 w-6 rounded-full" style={{ background: t.text, opacity: 0.15 }} />
                  </div>
                  {/* Mock grid */}
                  <div className="absolute bottom-3 left-3 right-3 flex gap-1.5">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="flex-1 h-14 rounded-lg" style={{ background: t.card }} />
                    ))}
                  </div>
                  {/* Active checkmark */}
                  {isActive && (
                    <div className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: t.accent }}>
                      <Check className="w-3.5 h-3.5" style={{ color: t.id === 'light' ? '#fff' : '#fff' }} />
                    </div>
                  )}
                </div>

                {/* Theme info */}
                <div className="p-4" style={{ background: t.card }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: t.accent }} />
                    <span className="text-[14px] font-semibold" style={{ color: t.text }}>{t.name}</span>
                  </div>
                  <p className="text-[12px]" style={{ color: t.text, opacity: 0.5 }}>{t.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
