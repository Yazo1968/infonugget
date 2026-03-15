import { useEffect, useRef, useCallback } from 'react';
import LogoIcon from './LogoIcon';
import './LandingPage.css';

interface LandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export default function LandingPage({ onGetStarted, onSignIn }: LandingPageProps) {
  const navRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Scroll reveal via IntersectionObserver
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('vis');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' },
    );

    root.querySelectorAll('.rv').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Nav scroll background
  useEffect(() => {
    const handler = () => {
      navRef.current?.classList.toggle('scrolled', window.scrollY > 60);
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  // Smooth-scroll to anchor
  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="landing" ref={rootRef}>
      {/* ═══ NAV ═══ */}
      <nav className="lp-nav" ref={navRef}>
        <div className="inner">
          <span className="logo" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <LogoIcon size={22} darkMode />
            <span>
              <i>info</i>
              <b>nugget</b>
            </span>
          </span>
          <div className="nav-r">
            <button className="nav-link" onClick={() => scrollTo('features')}>
              Features
            </button>
            <button className="nav-link" onClick={() => scrollTo('how')}>
              How It Works
            </button>
            <button className="nav-link" onClick={() => scrollTo('capabilities')}>
              More
            </button>
            <button className="cta-sm" onClick={onGetStarted}>
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="hero">
        <div className="hero-inner">
          <h1 className="rv">
            Your documents.
            <br />
            Your insights.
            <br />
            Your <em>infographics</em>.
          </h1>
          <p className="rv rv-d1">
            Upload your PDFs and markdown. AI synthesizes the content and generates
            presentation-ready infographic cards — styled your way, at the detail level you choose.
          </p>
          <div className="hero-btns rv rv-d2">
            <button className="btn-p" onClick={onGetStarted}>
              Start Free
            </button>
            <button className="btn-g" onClick={() => scrollTo('how')}>
              See How It Works
            </button>
          </div>
        </div>
      </section>

      {/* ═══ METRICS ═══ */}
      <div className="lp-metrics light-section rv">
        <div>
          <h3>PDF &amp; MD</h3>
          <small>Source Formats</small>
        </div>
        <div>
          <h3>50+</h3>
          <small>Cards Per Deck</small>
        </div>
        <div>
          <h3>100%</h3>
          <small>Your Content</small>
        </div>
        <div>
          <h3>1-Click</h3>
          <small>Full Deck</small>
        </div>
      </div>

      {/* ═══ FEATURES ═══ */}
      <section className="features" id="features">
        <div className="features-head rv">
          <div className="tag">Features</div>
          <h2>Five panels. Full control.</h2>
        </div>
        <div className="feat-grid">
          <div className="feat-card rv">
            <div className="feat-tag">Cards &amp; Assets</div>
            <h3>Your style. Your detail level.</h3>
            <p>
              14 visual styles or create your own. Three detail levels. Any aspect ratio. Folders,
              drag-and-drop, inline editing. Full image album per card.
            </p>
          </div>

          <div className="feat-card rv rv-d1">
            <div className="feat-tag">Auto-Deck</div>
            <h3>AI proposes. You approve.</h3>
            <p>
              Set the detail level and card count. AI reads your documents and proposes a full deck
              plan — every card title, description, and source reference laid out for your review.
              Nothing gets produced until you say so.
            </p>
          </div>

          <div className="feat-card rv rv-d2">
            <div className="feat-tag">AI Chat</div>
            <h3>Ask anything. Create from answers.</h3>
            <p>
              Ask questions about your documents and get answers with exact page references. Found
              an insight worth keeping? Turn it into a card with one click — pick the detail level,
              choose the folder, done.
            </p>
          </div>

          <div className="feat-card rv rv-d1">
            <div className="feat-tag">Brief &amp; Quality</div>
            <h3>Set the brief. Check the sources.</h3>
            <p>
              Define your audience, objective, tone, and focus — AI uses your brief to shape every
              card. Run a quality assessment that scores relevance, coverage, consistency, freshness,
              and depth.
            </p>
          </div>

          <div className="feat-card rv rv-d2">
            <div className="feat-tag">Annotation Workbench</div>
            <h3>Mark it up. AI redraws it.</h3>
            <p>
              Drop pins on what needs changing. Draw arrows to show direction. Box a region with
              instructions. AI redraws the card exactly as you marked it. Every version is saved in
              the album.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ CAPABILITIES ═══ */}
      <section className="caps light-section" id="capabilities">
        <div className="caps-head rv">
          <div className="tag">Capabilities</div>
          <h2>Control at every level.</h2>
        </div>
        <div className="cap-grid">
          <div className="cap-card rv">
            <h3>PDF Intelligence</h3>
            <p>
              Upload any PDF. AI detects bookmarks and structure automatically. Edit headings,
              convert to markdown, or keep native.
            </p>
          </div>
          <div className="cap-card rv rv-d1">
            <h3>Card Folders</h3>
            <p>
              Organize cards into folders. Drag to reorder, move between projects, duplicate entire
              sets.
            </p>
          </div>
          <div className="cap-card rv rv-d2">
            <h3>Image Albums</h3>
            <p>
              Every card keeps an album of all generated images. Compare variants, switch the active
              one, regenerate anytime.
            </p>
          </div>
          <div className="cap-card rv">
            <h3>Style Studio</h3>
            <p>
              Create custom visual styles — set your palette, pick fonts, describe your visual
              identity. Save per project or reuse globally.
            </p>
          </div>
          <div className="cap-card rv rv-d1">
            <h3>Zero Hallucination</h3>
            <p>
              Everything on your cards comes from your documents. Nothing made up, nothing borrowed
              from the internet.
            </p>
          </div>
          <div className="cap-card rv rv-d2">
            <h3>Cloud Sync</h3>
            <p>
              Start on your laptop, pick up on your tablet. Projects, documents, and cards always in
              sync.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="how" id="how">
        <div className="how-head rv">
          <div className="tag">How It Works</div>
          <h2>Four steps. Your decisions.</h2>
        </div>
        <div className="steps">
          <div className="step rv">
            <div className="step-num">1</div>
            <div>
              <h3>Upload &amp; Curate</h3>
              <p>
                Drop your PDFs and markdown files. Enable or disable individual sources. Edit
                bookmarks. You choose exactly what feeds into generation.
              </p>
            </div>
          </div>
          <div className="step rv rv-d1">
            <div className="step-num">2</div>
            <div>
              <h3>Brief &amp; Assess</h3>
              <p>
                Set your audience, objective, and tone. Run a quality check on your sources. Know
                what&apos;s solid and what&apos;s missing before you start.
              </p>
            </div>
          </div>
          <div className="step rv rv-d2">
            <div className="step-num">3</div>
            <div>
              <h3>Generate &amp; Style</h3>
              <p>
                Pick your style, detail level, and aspect ratio. Generate one card at a time or a
                full deck. Every visual comes strictly from your content.
              </p>
            </div>
          </div>
          <div className="step rv rv-d3">
            <div className="step-num">4</div>
            <div>
              <h3>Annotate &amp; Perfect</h3>
              <p>
                Mark up any card with pins, arrows, and notes. AI redraws exactly what you marked.
                Keep every version in the album.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="cta-section light-section">
        <div className="cta-card rv">
          <h2>Ready to take creative control?</h2>
          <p>
            Create an account. Upload your documents. Generate infographic cards you fully own.
          </p>
          <button className="btn-p" onClick={onGetStarted}>
            Get Started
          </button>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="lp-footer">
        <div className="inner">
          <div className="ft-top">
            <div>
              <div className="ft-brand">
                <LogoIcon size={20} darkMode />
                <span>
                  <i>info</i>
                  <b>nugget</b>
                </span>
              </div>
              <p className="ft-tagline">
                AI-powered insights & infographics from your documents. Full control at every step.
              </p>
            </div>
            <div className="ft-col">
              <h4>Product</h4>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>Cards &amp; Assets</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>Auto-Deck</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>AI Chat</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>Quality Check</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>Workbench</a>
            </div>
            <div className="ft-col">
              <h4>Resources</h4>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>Documentation</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>Style Gallery</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>Changelog</a>
            </div>
            <div className="ft-col">
              <h4>Company</h4>
              <a href="#" onClick={(e) => e.preventDefault()}>About</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Contact</a>
            </div>
          </div>
          <div className="ft-bottom">
            <span className="ft-copy">&copy; 2026 InfoNugget &middot; v6.1</span>
            <div className="ft-legal">
              <a href="/terms">Terms</a>
              <a href="/privacy">Privacy</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
