import { useEffect, useRef, useState } from 'react';
import '../styles/radio-mark.css';

export function RadioMark({ size = 32, animate = false }: { size?: number; animate?: boolean }) {
  const mark = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!animate || !mark.current) return;
    let inView = false;
    const update = () => setActive(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    observer.observe(mark.current);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [animate]);
  return <svg ref={mark} className="radio-mark" data-animated={animate ? 'true' : undefined} data-active={active ? 'true' : undefined} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path className="radio-mark__arc" d="M5 13a11 11 0 0 1 22 0" />
    <path d="M5 19h22M10 23l6 5 6-5" />
    <path className="radio-mark__signal" d="M16 8v7" />
  </svg>;
}
