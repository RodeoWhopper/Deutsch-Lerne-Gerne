import { useEffect, useState } from 'preact/hooks';
import { api, type Settings } from '../api.ts';
import type { Ctx } from '../main.tsx';
import { Screen, fmtDate } from '../ui.tsx';

const themes: [Settings['theme'], string][] = [['amber', 'amber'], ['green', 'yeşil fosfor'], ['dos', 'DOS mavi']];

export function SettingsScreen({ ctx }: { ctx: Ctx }) {
  const s = ctx.settings;
  const [sessions, setSessions] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');

  const loadAll = () => {
    api('GET', '/api/auth/sessions').then((r) => r.status === 200 && setSessions(r.data.sessions));
    api('GET', '/api/auth/audit').then((r) => r.status === 200 && setAudit(r.data.audit));
  };
  useEffect(loadAll, []);

  const save = async (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    ctx.setSettings(next);
    const r = await api('PUT', '/api/settings', next);
    if (r.status !== 200) setMsg('ayar kaydedilemedi');
  };
  const revoke = async (id: number, current: boolean) => { await api('DELETE', `/api/auth/sessions/${id}`); if (current) location.assign('/login'); else loadAll(); };
  const revokeAll = async () => { await api('POST', '/api/auth/sessions/revoke-all', {}); location.assign('/login'); };
  const logout = async () => { await api('POST', '/api/auth/logout', {}); location.assign('/login'); };
  const exportProgress = async () => {
    const r = await api('GET', '/api/progress/export');
    if (r.status !== 200) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `deutsch-ilerleme-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importProgress = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (!pw) { setMsg('önce parolayı yaz'); return; }
    let data: unknown;
    try { data = JSON.parse(await f.text()); } catch { setMsg('geçerli JSON değil'); return; }
    const r = await api('POST', '/api/progress/import', { data, reauth: { password: pw } });
    setPw('');
    setMsg(r.status === 200 ? 'ilerleme yüklendi' : r.status === 403 ? 'Parola yanlış' : r.data?.error ?? 'başarısız');
  };

  const toggle = (k: 'crt' | 'sprint_new' | 'vibrate' | 'wake_lock', label: string, note?: string) => (
    <button class="lsrow block" aria-pressed={s[k]} onClick={() => save({ [k]: !s[k] } as Partial<Settings>)}>
      <span class="name">{s[k] ? '[x]' : '[ ]'} {label}{note && <><br /><span class="dim">{note}</span></>}</span>
    </button>
  );

  return (
    <Screen cmd="config" user={ctx.user}>
      {msg && <p class="errbox" role="status">{msg}</p>}
      <fieldset>
        <legend>görünüm</legend>
        <div class="btns">
          {themes.map(([k, l]) => <button key={k} class={s.theme === k ? 'btn pri' : 'btn'} aria-pressed={s.theme === k} onClick={() => save({ theme: k })}>{s.theme === k ? '(•)' : '( )'} {l}</button>)}
        </div>
        {toggle('crt', 'CRT efekti', 'hafif parlama + çok silik tarama çizgisi')}
      </fieldset>

      <fieldset>
        <legend>çalışma</legend>
        <label for="dn">günlük yeni kart limiti</label>
        <input id="dn" type="number" min={0} max={50} value={s.daily_new} onChange={(e) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isInteger(n) && n >= 0 && n <= 50) save({ daily_new: n }); }} />
        <label>yoğun gün süresi</label>
        <div class="btns">
          {[10, 15, 20].map((m) => <button key={m} class={s.sprint_minutes === m ? 'btn pri' : 'btn'} aria-pressed={s.sprint_minutes === m} onClick={() => save({ sprint_minutes: m as 10 | 15 | 20 })}>{m} dk</button>)}
        </div>
        {toggle('sprint_new', "yoğun günde de yeni kart gelsin")}
        {toggle('wake_lock', 'yoğun gün sırasında ekran açık kalsın')}
        {toggle('vibrate', 'titreşim geri bildirimi')}
      </fieldset>

      <fieldset>
        <legend>açık oturumlar</legend>
        {sessions.map((x) => (
          <div key={x.id} class="lsrow">
            <span class="name">{x.ua}{x.current ? ' (bu cihaz)' : ''}<br /><span class="dim">{x.ip_trunc} · son: {fmtDate(x.last_used)}</span></span>
            <button class="btn" onClick={() => revoke(x.id, x.current)}>[ iptal ]</button>
          </div>
        ))}
        <div class="btns"><button class="btn" onClick={revokeAll}>[ tüm oturumları kapat ]</button></div>
      </fieldset>

      <fieldset>
        <legend>son 20 giriş</legend>
        {audit.map((a, i) => (
          <div key={i} class="lsrow"><span class="name">{a.ok ? '[ OK ]' : '[ERR]'} {a.event}<br /><span class="dim">{a.ip_trunc} · {a.ua}</span></span><span class="meta">{fmtDate(a.at)}</span></div>
        ))}
      </fieldset>

      <fieldset>
        <legend>ilerleme</legend>
        <div class="btns"><button class="btn" onClick={exportProgress}>[ indir (JSON) ]</button></div>
        <label for="ip">yüklemak için parola</label>
        <input id="ip" type="password" autocomplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
        <label for="if">ilerleme dosyası (yükle)</label>
        <input id="if" type="file" accept="application/json,.json" onChange={importProgress} />
      </fieldset>

      <div class="btns"><button class="btn pri" onClick={logout}>[ çıkış ]</button></div>
    </Screen>
  );
}
