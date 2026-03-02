import { useState, useEffect } from 'react';

interface LandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export default function LandingPage({ onGetStarted, onSignIn }: LandingPageProps) {
  const [visible, setVisible] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('infonugget-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('infonugget-dark-mode', String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  const transition = 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)';

  const stagger = (delay: number): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.98)',
    transition,
    transitionDelay: `${delay}ms`,
  });

  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-[#0a0a0a]' : 'bg-[#fafbfc]'}`}>
      {/* Dot grid (dark mode only) */}
      {darkMode && (
        <div
          className="fixed inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(rgba(42,159,212,0.5) 0.5px, transparent 0.5px)',
            backgroundSize: '32px 32px',
          }}
        />
      )}
      {darkMode && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center top, rgba(42,159,212,0.04) 0%, transparent 60%)',
          }}
        />
      )}

      {/* ── Nav ── */}
      <nav style={stagger(0)} className="relative z-10 shrink-0 flex items-center justify-between px-6 py-4 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent-blue rounded-full flex items-center justify-center shadow-lg">
            <div className="w-[10px] h-[10px] bg-white rounded-[2px] rotate-45" />
          </div>
          <span className={`text-xl tracking-tight ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
            <span className="font-light italic">info</span>
            <span className="font-semibold not-italic">nugget</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDarkMode((d) => !d)}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
              darkMode
                ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200'
            }`}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={onSignIn}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              darkMode
                ? 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            Sign In
          </button>
        </div>
      </nav>

      {/* ── Main content ── */}
      <div className="relative z-10 flex-1 flex flex-col items-center px-6 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <div className="max-w-4xl w-full mx-auto">

          {/* Hero */}
          <div style={stagger(100)} className="text-center mt-16 mb-16">
            <div className="mb-6">
              <div className="w-16 h-16 bg-accent-blue rounded-full flex items-center justify-center shadow-xl mx-auto mb-6"
                style={{ boxShadow: '0 0 40px 10px rgba(42, 159, 212, 0.15)' }}>
                <div className="w-6 h-6 bg-white rounded-md rotate-45" />
              </div>
            </div>
            <h1 className={`text-4xl sm:text-5xl tracking-tight mb-4 leading-tight ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
              Condense knowledge into
              <br />
              <span className="text-accent-blue">digestible insights</span>
            </h1>
            <p className={`text-base sm:text-lg max-w-xl mx-auto mb-10 leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              Upload your documents, let AI synthesize the key points, and generate beautiful infographic cards — all in one workspace.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onGetStarted}
                className="px-6 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:brightness-110 transition-all shadow-lg shadow-[rgba(42,159,212,0.25)]"
              >
                Get Started
              </button>
              <button
                onClick={onSignIn}
                className={`px-6 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                  darkMode
                    ? 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-900'
                    : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50'
                }`}
              >
                Sign In
              </button>
            </div>
          </div>

          {/* Features */}
          <div style={stagger(300)} className="mb-20">
            <h2 className={`text-center text-[13px] font-semibold uppercase tracking-wider mb-8 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
              What you can do
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  ),
                  title: 'Document Intelligence',
                  desc: 'Upload PDFs and markdown files. AI extracts structure, bookmarks, and key content automatically.',
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
                    </svg>
                  ),
                  title: 'AI Synthesis',
                  desc: 'Claude analyzes your sources and synthesizes concise, structured content cards from complex material.',
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="16" height="16" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  ),
                  title: 'Visual Cards',
                  desc: 'Generate stunning infographic cards with AI imagery. Customize styles, layouts, and color palettes.',
                },
              ].map((feature, i) => (
                <div
                  key={feature.title}
                  style={stagger(350 + i * 80)}
                  className={`p-5 rounded-xl border transition-colors ${
                    darkMode
                      ? 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                      : 'bg-white border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                    darkMode ? 'bg-zinc-800' : 'bg-zinc-100'
                  }`}>
                    <div className="text-accent-blue">{feature.icon}</div>
                  </div>
                  <h3 className={`text-[14px] font-semibold mb-1.5 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                    {feature.title}
                  </h3>
                  <p className={`text-[12px] leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div style={stagger(600)} className="mb-20">
            <h2 className={`text-center text-[13px] font-semibold uppercase tracking-wider mb-8 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
              How it works
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { step: '1', title: 'Upload', desc: 'Add your PDFs and markdown documents to a project.' },
                { step: '2', title: 'Synthesize', desc: 'AI reads, analyzes, and distills your content into structured cards.' },
                { step: '3', title: 'Generate', desc: 'Get beautiful infographic cards with custom imagery and styling.' },
              ].map((item, i) => (
                <div key={item.step} style={stagger(650 + i * 80)} className="text-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3 text-sm font-bold ${
                    darkMode
                      ? 'bg-accent-blue/15 text-accent-blue'
                      : 'bg-accent-blue/10 text-accent-blue'
                  }`}>
                    {item.step}
                  </div>
                  <h3 className={`text-[14px] font-semibold mb-1 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                    {item.title}
                  </h3>
                  <p className={`text-[12px] ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div style={stagger(900)} className="text-center mb-16">
            <h2 className={`text-xl font-semibold mb-3 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
              Ready to get started?
            </h2>
            <p className={`text-[13px] mb-6 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              Create a free account and start turning documents into insights.
            </p>
            <button
              onClick={onGetStarted}
              className="px-6 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:brightness-110 transition-all shadow-lg shadow-[rgba(42,159,212,0.25)]"
            >
              Create Free Account
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={stagger(1000)} className="relative z-10 shrink-0 py-4 flex flex-col items-center gap-1.5">
        <div className={`flex items-center gap-3 text-[10px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
          <a href="/terms" className="hover:text-accent-blue transition-colors">Terms of Service</a>
          <span>·</span>
          <a href="/privacy" className="hover:text-accent-blue transition-colors">Privacy Policy</a>
        </div>
        <p className={`text-[10px] font-light tracking-wide ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>v6.1</p>
      </div>
    </div>
  );
}
