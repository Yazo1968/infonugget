import { useEffect, useRef } from 'react';

// ── Animation data ──

const FRAMES = [
  { dark: 'M574.726 171 669.634 180.205 761.138 223.429 816 327.888 815.6 394.325 774.753 479.173 622.981 528 525.67 496.783 511.254 471.168 478.016 440.751 464 379.117 498.239 240.639Z', blue: null, blueOpacity: 0 },
  { dark: 'M574.726 171 669.634 180.205 761.138 223.429 816 327.888 815.6 394.325 774.753 479.173 622.981 528 525.67 496.783 511.254 471.168 478.016 440.751 464 379.117 498.239 240.639Z', blue: 'M693 208 665.774 294.943 645.945 326.156 625.736 343.749 565.667 399.04 576.89 375.505 534.049 411 482 382.285 524.841 285.77 542.858 278.99 541.256 318.473 571.685 254.263 601.313 228.739 638.548 228.34Z', blueOpacity: 1 },
  { dark: 'M693.388 192 695.102 192.808 696.264 192.385 761.138 223.948 816 328.229 816 328.229 816 328.229 815.6 394.553 774.753 479.256 622.981 528 525.67 496.836 511.254 471.265 478.016 440.9 464 379.37 464 379.37 464 379.37 464 379.37 464.036 379.226 464.065 379.223 473.602 357.793 501.509 250.318 542.556 239.331 597.619 199.044Z', blue: 'M693 208 665.774 294.943 645.945 326.156 625.736 343.749 565.667 399.04 576.89 375.505 534.049 411 482 382.285 524.841 285.77 542.858 278.99 541.256 318.473 571.685 254.263 601.313 228.739 638.548 228.34Z', blueOpacity: 1 },
  { dark: 'M693.388 192 695.102 192.808 696.264 192.385 761.138 223.948 816 328.229 816 328.229 816 328.229 815.6 394.553 774.753 479.256 622.981 528 525.67 496.836 511.254 471.265 478.016 440.9 464 379.37 464 379.37 464 379.37 464 379.37 464.036 379.226 464.065 379.223 473.602 357.793 501.509 250.318 542.556 239.331 597.619 199.044Z', blue: 'M693.207 208 665.955 294.992 633.492 346.07 677.577 308.958 730 290.879 695.011 366.687 665.955 350.725 637.567 379.324 643.244 415.57 622.204 391.295 582.21 440 554.139 423.484 576.983 375.599 534.1 411.114 482 382.383 524.883 285.814 542.917 279.03 541.314 318.535 571.773 254.289 601.43 228.75 638.702 228.351Z', blueOpacity: 1 },
  { dark: 'M590.143 215.2 629.388 216.4 696.264 192 761.138 223.6 816 328 815.6 394.4 774.753 479.2 622.981 528 525.67 496.8 511.254 471.2 478.016 440.8 464 379.2 510.052 275.6 541.688 264Z', blue: 'M601.437 228.786 638.71 228.386 693.218 208 665.964 295.139 633.5 346.304 677.587 309.13 749.329 284.347 785 319.123 744.921 299.136 714.861 389.474 751.734 427.047 705.643 400.266 608.25 444.635 614.663 495 589.413 444.635 554.143 423.85 576.988 375.883 534.103 411.458 482 382.678 524.885 285.946 542.921 279.15 541.317 318.723 571.778 254.368Z', blueOpacity: 1 },
];

const CRACK_SETS_LIGHT = [
  [{ d: 'M570 280 L545 310 L530 350', stroke: '#444' }, { d: 'M560 290 L580 330 L565 360', stroke: '#3a3a3a' }, { d: 'M540 320 L520 355', stroke: '#444' }],
  [{ d: 'M575 175 L550 210 L500 245', stroke: '#444' }, { d: 'M560 190 L530 230 L505 260', stroke: '#3a3a3a' }, { d: 'M498 241 L475 290 L465 340', stroke: '#444' }, { d: 'M520 220 L490 270', stroke: '#3a3a3a' }],
  [{ d: 'M660 300 L690 320 L710 290', stroke: '#444' }, { d: 'M640 350 L665 370 L680 340', stroke: '#3a3a3a' }, { d: 'M620 380 L650 400', stroke: '#444' }],
  [{ d: 'M700 195 L680 220 L650 215', stroke: '#444' }, { d: 'M590 200 L570 230 L545 255', stroke: '#3a3a3a' }, { d: 'M510 260 L500 280 L505 275', stroke: '#444' }, { d: 'M695 200 L720 240 L740 280', stroke: '#3a3a3a' }],
];

const CRACK_SETS_DARK = [
  [{ d: 'M570 280 L545 310 L530 350', stroke: '#71717a' }, { d: 'M560 290 L580 330 L565 360', stroke: '#52525b' }, { d: 'M540 320 L520 355', stroke: '#71717a' }],
  [{ d: 'M575 175 L550 210 L500 245', stroke: '#71717a' }, { d: 'M560 190 L530 230 L505 260', stroke: '#52525b' }, { d: 'M498 241 L475 290 L465 340', stroke: '#71717a' }, { d: 'M520 220 L490 270', stroke: '#52525b' }],
  [{ d: 'M660 300 L690 320 L710 290', stroke: '#71717a' }, { d: 'M640 350 L665 370 L680 340', stroke: '#52525b' }, { d: 'M620 380 L650 400', stroke: '#71717a' }],
  [{ d: 'M700 195 L680 220 L650 215', stroke: '#71717a' }, { d: 'M590 200 L570 230 L545 255', stroke: '#52525b' }, { d: 'M510 260 L500 280 L505 275', stroke: '#71717a' }, { d: 'M695 200 L720 240 L740 280', stroke: '#52525b' }],
];

interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; life: number; decay: number;
  color: string; rotation: number; rotSpeed: number;
}

const SLIDE_DUR = 900;
const SLIDE_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

interface ChiselLoaderProps {
  darkMode?: boolean;
}

export default function ChiselLoader({ darkMode = false }: ChiselLoaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const incomingRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);
  const animIdRef = useRef<number | null>(null);
  const darkModeRef = useRef(darkMode);

  // Keep ref in sync so the running animation loop uses latest value
  darkModeRef.current = darkMode;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const currentWrap = currentRef.current;
    const incomingWrap = incomingRef.current;
    if (!root || !canvas || !currentWrap || !incomingWrap) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    cancelledRef.current = false;

    function resizeCanvas() {
      canvas!.width = root!.offsetWidth;
      canvas!.height = root!.offsetHeight;
    }

    function spawnDebris(count: number, ox: number, oy: number) {
      const dm = darkModeRef.current;
      for (let i = 0; i < count; i++) {
        const angle = (Math.random() - 0.5) * Math.PI * 1.2 - Math.PI / 2;
        const speed = 2 + Math.random() * 6;
        const size = 2 + Math.random() * 5;
        particlesRef.current.push({
          x: ox + (Math.random() - 0.5) * 60, y: oy + (Math.random() - 0.5) * 40,
          vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
          vy: Math.sin(angle) * speed - 2, size, life: 1,
          decay: 0.015 + Math.random() * 0.025,
          color: Math.random() > 0.3 ? (dm ? '#a1a1aa' : '#262626') : (dm ? '#6d6d73' : '#555'),
          rotation: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.3,
        });
      }
    }

    function updateParticles() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.vx *= 0.98;
        p.life -= p.decay; p.rotation += p.rotSpeed;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        ctx!.save();
        ctx!.translate(p.x, p.y); ctx!.rotate(p.rotation);
        ctx!.globalAlpha = p.life; ctx!.fillStyle = p.color;
        ctx!.beginPath();
        ctx!.moveTo(-p.size, -p.size * 0.4);
        ctx!.lineTo(p.size * 0.3, -p.size * 0.8);
        ctx!.lineTo(p.size, p.size * 0.2);
        ctx!.lineTo(-p.size * 0.2, p.size * 0.6);
        ctx!.closePath(); ctx!.fill(); ctx!.restore();
      }
    }

    function particleLoop() {
      updateParticles();
      if (particlesRef.current.length > 0) {
        animIdRef.current = requestAnimationFrame(particleLoop);
      } else {
        animIdRef.current = null;
      }
    }

    function impact(intensity: number) {
      const sf: Keyframe[] = [];
      for (let i = 0; i < 3; i++) {
        sf.push({ transform: `translate(${(Math.random() - 0.5) * 3.5 * intensity}px,${(Math.random() - 0.5) * 2.5 * intensity}px)` });
      }
      sf.push({ transform: 'translate(0,0)' });
      root!.animate(sf, { duration: 200, easing: 'ease-out' });
      spawnDebris(Math.floor(12 * intensity), canvas!.width * 0.48, canvas!.height * 0.45);
      if (!animIdRef.current) particleLoop();
    }

    function setFrame(wrap: HTMLDivElement, i: number) {
      const f = FRAMES[i];
      const dm = darkModeRef.current;
      wrap.querySelector<SVGPathElement>('.chisel-dark')!.setAttribute('d', f.dark);
      wrap.querySelector<SVGPathElement>('.chisel-dark')!.setAttribute('fill', dm ? '#4e4e52' : '#262626');
      if (f.blue) {
        wrap.querySelector<SVGPathElement>('.chisel-blue')!.setAttribute('d', f.blue);
        wrap.querySelector<SVGPathElement>('.chisel-blue-clip')!.setAttribute('d', f.blue);
      }
      wrap.querySelector<SVGPathElement>('.chisel-blue')!.setAttribute('opacity', String(f.blueOpacity));
    }

    function showCracks(wrap: HTMLDivElement, crackIndex: number) {
      const g = wrap.querySelector<SVGGElement>('.chisel-cracks')!;
      const cracks = (darkModeRef.current ? CRACK_SETS_DARK : CRACK_SETS_LIGHT)[crackIndex];
      let html = '';
      cracks.forEach(c => { html += `<path d="${c.d}" stroke="${c.stroke}" stroke-width="1.5" fill="none" opacity="0.8" stroke-linecap="round"/>`; });
      g.innerHTML = html;
      g.setAttribute('opacity', '1');
      g.querySelectorAll('path').forEach(p => {
        const len = p.getTotalLength?.() ?? 100;
        p.style.strokeDasharray = String(len);
        p.style.strokeDashoffset = String(len);
        p.style.transition = 'stroke-dashoffset 150ms ease-out';
        requestAnimationFrame(() => { p.style.strokeDashoffset = '0'; });
      });
    }

    function hideCracks(wrap: HTMLDivElement) {
      const g = wrap.querySelector<SVGGElement>('.chisel-cracks')!;
      g.setAttribute('opacity', '0');
      g.innerHTML = '';
    }

    function showShimmer(wrap: HTMLDivElement) { wrap.querySelector<SVGRectElement>('.chisel-shimmer')!.setAttribute('opacity', '1'); }
    function hideShimmer(wrap: HTMLDivElement) { wrap.querySelector<SVGRectElement>('.chisel-shimmer')!.setAttribute('opacity', '0'); }

    function resetWrap(wrap: HTMLDivElement) {
      wrap.querySelector<SVGPathElement>('.chisel-dark')!.setAttribute('d', '');
      wrap.querySelector<SVGPathElement>('.chisel-blue')!.setAttribute('d', '');
      wrap.querySelector<SVGPathElement>('.chisel-blue')!.setAttribute('opacity', '0');
      wrap.querySelector<SVGPathElement>('.chisel-blue-clip')!.setAttribute('d', '');
      hideCracks(wrap);
      hideShimmer(wrap);
    }

    async function guardedSleep(ms: number) {
      await sleep(ms);
      if (cancelledRef.current) throw new Error('cancelled');
    }

    async function slideTransition(finishedWrap: HTMLDivElement, freshWrap: HTMLDivElement) {
      particlesRef.current = [];
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      resetWrap(freshWrap);
      setFrame(freshWrap, 0);
      freshWrap.style.transition = 'none';
      freshWrap.style.transform = 'translateX(-110%)';
      await guardedSleep(50);
      finishedWrap.style.transition = `transform ${SLIDE_DUR}ms ${SLIDE_EASE}`;
      freshWrap.style.transition = `transform ${SLIDE_DUR}ms ${SLIDE_EASE}`;
      finishedWrap.style.transform = 'translateX(110%)';
      freshWrap.style.transform = 'translateX(0%)';
      await guardedSleep(SLIDE_DUR + 50);
      finishedWrap.style.transition = 'none';
      finishedWrap.style.transform = 'translateX(-110%)';
      resetWrap(finishedWrap);
    }

    async function chisel(wrap: HTMLDivElement) {
      const intensities = [1, 1.2, 1.0, 1.4];
      const delays = [700, 650, 700, 500];
      for (let i = 0; i < 4; i++) {
        showCracks(wrap, i);
        await guardedSleep(200);
        setFrame(wrap, i + 1);
        hideCracks(wrap);
        impact(intensities[i]);
        if (i === 0) showShimmer(wrap);
        await guardedSleep(delays[i]);
      }
      await guardedSleep(500);
    }

    let useCurrentFirst = true;

    async function runLoop() {
      while (!cancelledRef.current) {
        const active = useCurrentFirst ? currentWrap! : incomingWrap!;
        const standby = useCurrentFirst ? incomingWrap! : currentWrap!;
        await chisel(active);
        await slideTransition(active, standby);
        useCurrentFirst = !useCurrentFirst;
      }
    }

    async function start() {
      resizeCanvas();
      incomingWrap!.style.transform = 'translateX(-110%)';
      resetWrap(currentWrap!);
      setFrame(currentWrap!, 0);
      currentWrap!.style.transition = 'none';
      currentWrap!.style.transform = 'translateX(-110%)';
      await guardedSleep(200);
      currentWrap!.style.transition = `transform ${SLIDE_DUR}ms ${SLIDE_EASE}`;
      currentWrap!.style.transform = 'translateX(0%)';
      await guardedSleep(SLIDE_DUR);
      impact(0.6);
      await guardedSleep(600);
      runLoop().catch(() => { /* cancelled */ });
    }

    const onResize = () => resizeCanvas();
    window.addEventListener('resize', onResize);
    start().catch(() => { /* cancelled */ });

    return () => {
      cancelledRef.current = true;
      window.removeEventListener('resize', onResize);
      if (animIdRef.current) { cancelAnimationFrame(animIdRef.current); animIdRef.current = null; }
      particlesRef.current = [];
    };
  }, []);

  const dm = darkMode;
  const conveyorStroke = dm ? '#52525b' : '#d0d0d0';
  const shadowBg = dm
    ? 'radial-gradient(ellipse,rgba(255,255,255,0.08) 0%,transparent 70%)'
    : 'radial-gradient(ellipse,rgba(0,0,0,0.18) 0%,transparent 70%)';

  const nuggetSvg = (idSuffix: string) => (
    <svg className="chisel-svg" viewBox="-250 -150 1780 1020" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={`shimmer-${idSuffix}`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0%" stopColor="rgba(180,200,230,0)" />
          <stop offset="45%" stopColor="rgba(180,200,230,0)" />
          <stop offset="50%" stopColor="rgba(180,200,230,0.8)" />
          <stop offset="55%" stopColor="rgba(180,200,230,0)" />
          <stop offset="100%" stopColor="rgba(180,200,230,0)" />
          <animate attributeName="x1" from="-1" to="1" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="x2" from="0" to="2" dur="2.5s" repeatCount="indefinite" />
        </linearGradient>
        <clipPath id={`blue-clip-${idSuffix}`}><path className="chisel-blue-clip" d="" /></clipPath>
      </defs>
      <path className="chisel-dark" fill={dm ? '#4e4e52' : '#262626'} fillRule="evenodd" d="" />
      <g className="chisel-cracks" opacity="0" />
      <path className="chisel-blue" fill="#78AAE6" fillRule="evenodd" d="" opacity="0" />
      <rect className="chisel-shimmer" x="0" y="0" width="1280" height="720" fill={`url(#shimmer-${idSuffix})`} clipPath={`url(#blue-clip-${idSuffix})`} opacity="0" />
    </svg>
  );

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '280px', height: '158px', overflow: 'hidden', margin: '0 auto' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }} />
      {/* Conveyor line */}
      <div style={{ position: 'absolute', bottom: '47px', left: 0, right: 0, height: '1px', zIndex: 1 }}>
        <svg width="100%" height="1" style={{ display: 'block' }}>
          <line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={conveyorStroke} strokeWidth="0.75" />
        </svg>
      </div>
      {/* Current nugget */}
      <div ref={currentRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        <div style={{ position: 'absolute', bottom: '35px', left: '50%', transform: 'translateX(-50%)', width: '80px', height: '6px', background: shadowBg, borderRadius: '50%', zIndex: 0 }} />
        {nuggetSvg('current')}
      </div>
      {/* Incoming nugget */}
      <div ref={incomingRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: 'translateX(-110%)' }}>
        <div style={{ position: 'absolute', bottom: '35px', left: '50%', transform: 'translateX(-50%)', width: '80px', height: '6px', background: shadowBg, borderRadius: '50%', zIndex: 0 }} />
        {nuggetSvg('incoming')}
      </div>
    </div>
  );
}
