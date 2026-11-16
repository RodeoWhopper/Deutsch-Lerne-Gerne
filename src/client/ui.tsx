import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { parseBold } from '../shared/mdbold.ts';

/** Text-only rendering: **bold** becomes <b>, everything else is a text node. Never raw HTML. */
export function Rich({ text }: { text: string }) {
  return <>{parseBold(text).map((s, i) => (s.b ? <b key={i}>{s.t}</b> : s.t))}</>;
}

/** Block bar. Terminus' shade glyphs (░▒▓) render broken, so: █ in fg for filled, █ in --line for empty. */
export const bar = (v: number, w = 10) => {
  const n = Math.max(0, Math.min(w, Math.round(v * w)));
  return <><span class="bf">{'█'.repeat(n)}</span><span class="be">{'█'.repeat(w - n)}</span></>;
};

export const artClass = (a?: string) => (a === 'der' || a === 'die' || a === 'das' ? `art-${a}` : '');

/** Colours der/die/das in text (information, not decoration). */
export function ArtText({ text }: { text: string }) {
  const m = text.match(/^(der|die|das)(\s.*)$/s);
  if (!m) return <>{text}</>;
  return <><span class={artClass(m[1])}>{m[1]}</span>{m[2]}</>;
}

export function nav(path: string) {
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}
export function Link({ href, children, class: cls, ...rest }: { href: string; children: ComponentChildren; class?: string; [k: string]: unknown }) {
  return (
    <a href={href} class={cls} {...rest} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); nav(href); }}>
      {children}
    </a>
  );
}

export function Screen({ cmd, user, children, nav: showNav = true, path }: { cmd: string; user: string; children: ComponentChildren; nav?: boolean; path?: string }) {
  return (
    <div class="term">
      <header class="prompt"><span class="u">{user}@deutsch</span><span class="p">:~$</span> {cmd}</header>
      <main>{children}</main>
      {showNav && <Nav path={path ?? location.pathname} />}
    </div>
  );
}

const NAV: [string, string][] = [['/', 'ana'], ['/topics', 'konu'], ['/errors', 'hata'], ['/packs', 'paket'], ['/stats', 'stat'], ['/settings', 'ayar']];
export function Nav({ path }: { path: string }) {
  return (
    <nav class="nav" aria-label="gezinme">
      {NAV.map(([h, l]) => <Link key={h} href={h} aria-current={path === h ? 'page' : undefined}>{l}</Link>)}
    </nav>
  );
}

export function useKeys(handler: (e: KeyboardEvent) => void, deps: unknown[]) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const f = (e: KeyboardEvent) => ref.current(e);
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const fmtDate = (ms: number) => new Date(ms).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
export const trackLabel: Record<string, string> = {
  artikel: 'artikel', 'tr-de': 'tr→de', 'de-tr': 'de→tr', gramer: 'gramer', fiil: 'fiil', 'edat-baglac': 'edat/bağlaç',
};
