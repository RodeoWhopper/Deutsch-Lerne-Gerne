export interface Settings {
  theme: 'amber' | 'green' | 'dos'; crt: boolean; daily_new: number; sprint_minutes: 10 | 15 | 20;
  sprint_new: boolean; vibrate: boolean; wake_lock: boolean;
}
let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };

export interface Res<T> { status: number; data: T }
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { status: 0, data: { error: 'Sunucuya ulaşılamadı' } as T };
  }
  if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/totp') && location.pathname !== '/login') {
    location.assign('/login');
  }
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const THEME_COLOR = { amber: '#0E0B05', green: '#07100A', dos: '#0000AA' } as const;
export function applyTheme(s: Pick<Settings, 'theme' | 'crt'>) {
  const r = document.documentElement;
  r.dataset.theme = s.theme;
  r.dataset.crt = s.crt ? 'on' : 'off';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[s.theme]);
  try { localStorage.setItem('theme', JSON.stringify({ theme: s.theme, crt: s.crt })); } catch { /* private mode */ }
}
export function applyStoredTheme() {
  try {
    const t = JSON.parse(localStorage.getItem('theme') ?? 'null');
    if (t && ['amber', 'green', 'dos'].includes(t.theme)) applyTheme({ theme: t.theme, crt: !!t.crt });
  } catch { /* ignore */ }
}
