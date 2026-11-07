import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const ICONS: Record<string, string> = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  prev: 'M6 5v14M19 5L9 12l10 7z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  save: 'M5 4h11l4 4v12H5zM8 4v5h7V4M8 20v-6h8v6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  export: 'M12 3v12M7 8l5-5 5 5M5 15v4h14v-4',
  import: 'M12 15V3M7 10l5 5 5-5M5 17v3h14v-3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1.5-2-3.5-2.4.8-1.6-1L14.6 4h-4l-.4 2.8-1.6 1-2.4-.8-2 3.5L6 12l-2 1.5 2 3.5 2.4-.8 1.6 1 .4 2.8h4l.4-2.8 1.6-1 2.4.8 2-3.5z',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  send: 'M4 12l16-8-6 16-3-7z',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 7.5L20 18M8.5 16.5L20 6',
  wand: 'M5 19L17 7M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z',
  thumbUp: 'M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2l-1.5 7a2 2 0 0 1-2 1.5H7',
  thumbDown: 'M7 13V4H4v9zM7 13l4 8a2 2 0 0 0 2-2v-4h6a2 2 0 0 0 2-2l-1.5-7A2 2 0 0 0 17.500 4H7',
  chevron: 'M9 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.200 9.500l6.100-.9z',
  speaker: 'M4 9v6h4l5 4V5L8 9zM16.500 8.500a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.500 4.500L19 7.500',
  music: 'M9 18V5l10-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  wave: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2',
  sparkle: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM18 16l.8 2.200L21 19l-2.200.8L18 22l-.8-2.200L15 19l2.200-.8z',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
};

export function Icon({ n, size = 16, stroke = 1.6, fill = false }: { n: string; size?: number; stroke?: number; fill?: boolean }): JSX.Element {
  const d = ICONS[n] ?? ICONS.plus;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" style={{ flex: 'none' }}>
      <path d={d} />
    </svg>
  );
}

export function Btn(p: { children?: ComponentChildren; onClick?: (e: MouseEvent) => void; cls?: string; title?: string; icon?: string; sm?: boolean; on?: boolean; disabled?: boolean; primary?: boolean; onContextMenu?: (e: MouseEvent) => void }): JSX.Element {
  const cls = ['btn', p.sm ? 'sm' : '', p.on ? 'on' : '', p.primary ? 'primary' : '', !p.children ? 'icon' : '', p.cls ?? ''].join(' ');
  return (
    <button class={cls} title={p.title} disabled={p.disabled} onClick={p.onClick as never} onContextMenu={p.onContextMenu as never}>
      {p.icon && <Icon n={p.icon} size={p.sm ? 13 : 15} />}
      {p.children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 3, width: 60 });
  useLayoutEffect(() => {
    const el = ref.current?.querySelector('button.on') as HTMLElement | null;
    if (el) setPos({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div class="seg" ref={ref}>
      <div class="thumb" style={{ left: pos.left + 'px', width: pos.width + 'px' }} />
      {options.map((o) => (
        <button key={o.value} class={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, min, max, step = 0.01, onInput, onChange, log }: { value: number; min: number; max: number; step?: number; onInput?: (v: number) => void; onChange?: (v: number) => void; log?: boolean }): JSX.Element {
  const toPos = (v: number) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : ((v - min) / (max - min)) * 1000);
  const fromPos = (x: number) => (log ? min * Math.pow(max / min, x / 1000) : min + ((max - min) * x) / 1000);
  const p = toPos(Math.max(min, Math.min(max, value)));
  const snap = (v: number) => (step >= 1 ? Math.round(v / step) * step : v);
  return (
    <input
      type="range"
      min={0}
      max={1000}
      step={1}
      value={p}
      style={{ '--p': p / 10 + '%' } as never}
      onInput={(e) => onInput?.(snap(fromPos(+(e.target as HTMLInputElement).value)))}
      onChange={(e) => onChange?.(snap(fromPos(+(e.target as HTMLInputElement).value)))}
    />
  );
}

export function Modal({ title, onClose, children, footer, narrow }: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; narrow?: boolean }): JSX.Element {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={'modal' + (narrow ? ' narrow' : '')}>
        <div class="mh">
          <h2>{title}</h2>
          <Btn icon="close" cls="ghost" onClick={onClose} />
        </div>
        <div class="mb">{children}</div>
        {footer && <div class="mf">{footer}</div>}
      </div>
    </div>
  );
}

export type MenuItem = { label: string; run: () => void; hint?: string } | 'sep';

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const off = () => onClose();
    window.addEventListener('mousedown', off);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('blur', off);
    };
  }, []);
  return (
    <div class="menu" style={{ left: Math.min(x, window.innerWidth - 210) + 'px', top: Math.min(y, window.innerHeight - items.length * 24 - 12) + 'px' }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it === 'sep' ? <hr key={i} /> : (
          <div key={i} onClick={() => { it.run(); onClose(); }}>
            <span>{it.label}</span>
            {it.hint && <small>{it.hint}</small>}
          </div>
        ),
      )}
    </div>
  );
}

/** Time formatted as 1:23.4 */
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function useRaf(cb: () => void, deps: unknown[] = []): void {
  useEffect(() => {
    let id = 0;
    const loop = () => {
      cb();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, deps);
}
