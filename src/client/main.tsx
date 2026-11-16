import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './style.css';
import { api, applyStoredTheme, applyTheme, setCsrf, type Settings } from './api.ts';
import { Login } from './screens/Login.tsx';
import { Home } from './screens/Home.tsx';
import { Study } from './screens/Study.tsx';
import { Topics } from './screens/Topics.tsx';
import { Errors } from './screens/Errors.tsx';
import { Packs } from './screens/Packs.tsx';
import { Stats } from './screens/Stats.tsx';
import { SettingsScreen } from './screens/Settings.tsx';

applyStoredTheme();

export interface Ctx { user: string; settings: Settings; setSettings: (s: Settings) => void }

function App() {
  const [path, setPath] = useState(location.pathname);
  const [ctx, setCtx] = useState<{ user: string; settings: Settings } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const f = () => setPath(location.pathname);
    addEventListener('popstate', f);
    return () => removeEventListener('popstate', f);
  }, []);

  useEffect(() => {
    if (path === '/login') { setChecked(true); return; }
    api('GET', '/api/auth/me').then((r) => {
      if (r.status === 200) {
        setCsrf(r.data.csrf);
        applyTheme(r.data.settings);
        setCtx({ user: r.data.user, settings: r.data.settings });
      }
      setChecked(true);
    });
  }, [path === '/login']);

  if (path === '/login') return <Login />;
  if (!checked || !ctx) return <div class="term"><main><p class="boot">…</p></main></div>;
  const c: Ctx = {
    user: ctx.user, settings: ctx.settings,
    setSettings: (s) => { applyTheme(s); setCtx({ ...ctx, settings: s }); },
  };
  const m = path.match(/^\/study\/(daily|sprint|topic|errors|mini)$/);
  if (m) return <Study key={path + location.search} mode={m[1] as any} ctx={c} />;
  switch (path) {
    case '/': return <Home ctx={c} />;
    case '/topics': return <Topics ctx={c} />;
    case '/errors': return <Errors ctx={c} />;
    case '/packs': return <Packs ctx={c} />;
    case '/stats': return <Stats ctx={c} />;
    case '/settings': return <SettingsScreen ctx={c} />;
    default: return <Home ctx={c} />;
  }
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
