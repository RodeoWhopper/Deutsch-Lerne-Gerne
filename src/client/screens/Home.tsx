import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import type { Ctx } from '../main.tsx';
import { Link, Screen, bar, fmtDate, nav, trackLabel } from '../ui.tsx';

export function Home({ ctx }: { ctx: Ctx }) {
  const [h, setH] = useState<any>(null);
  const [boot, setBoot] = useState(() => { try { return !sessionStorage.getItem('booted'); } catch { return false; } });

  useEffect(() => { api('GET', '/api/home').then((r) => r.status === 200 && setH(r.data)); }, []);
  useEffect(() => {
    if (!boot || !h) return;
    try { sessionStorage.setItem('booted', '1'); } catch { /* ignore */ }
    const t = setTimeout(() => setBoot(false), 900);
    return () => clearTimeout(t);
  }, [boot, h]);

  if (!h) return <div class="term"><main><p class="boot">…</p></main></div>;

  if (boot) {
    return (
      <div class="term" onClick={() => setBoot(false)} role="button" tabIndex={0}>
        <main class="boot">
          {`deutsch-terminal\nson oturum   : ${h.last_review ? fmtDate(h.last_review) : 'yok'}\nbugün tekrar : ${h.due}\nhata defteri : ${h.errors}\n\n(dokun: geç)`}
        </main>
      </div>
    );
  }

  const blocks = <>{h.last7.map((n: number, i: number) => <span key={i} class={n > 0 ? 'bf' : 'be'}>▇</span>)}</>;
  const sm = h.sprint_minutes;
  return (
    <Screen cmd="ls" user={ctx.user}>
      <div class="kv">
        <span>bugün tekrar</span><b>{h.due}</b>
        <span>yeni (bugün)</span><span>{h.new_available}</span>
        <span>hata defteri</span><span>{h.errors}</span>
        <span>son 7 gün</span><b>{blocks}</b>
      </div>

      {h.active_packs === 0 && (
        <p class="errbox">Aktif paket yok. <Link href="/packs">/packs</Link> sayfasından bir paket yükle ve etkinleştir.</p>
      )}

      <fieldset>
        <legend>başlat</legend>
        <Link class="lsrow" href="/study/daily"><span class="name">[1] günlük</span><span class="meta">{h.due} tekrar + {h.new_available} yeni</span></Link>
        <div class="lsrow">
          <span class="name">[2] yoğun gün</span>
          <span class="meta">süreli</span>
        </div>
        <div class="btns">
          {[10, 15, 20].map((m) => (
            <button key={m} class={m === sm ? 'btn pri' : 'btn'} onClick={() => nav(`/study/sprint?m=${m}`)}>[ {m} dk ]</button>
          ))}
        </div>
        <Link class="lsrow" href="/study/mini"><span class="name">[3] mini (2 dk)</span><span class="meta">en fazla 10 kart</span></Link>
      </fieldset>

      <fieldset>
        <legend>konular</legend>
        <div class="ls">
          {Object.entries<any>(h.tracks).map(([t, v]) => (
            <Link key={t} class="lsrow" href={`/study/topic?track=${t}`}>
              <span class="name">{trackLabel[t]}</span>
              <span class="meta">tekrar {v.due} · {v.cards} kart</span>
              <span class="bar">{bar(v.strength)} {Math.round(v.strength * 100)}%</span>
            </Link>
          ))}
        </div>
      </fieldset>

      {h.units.length > 0 && (
        <fieldset>
          <legend>üniteler</legend>
          <div class="ls">
            {h.units.map((u: any) => (
              <Link key={u.unit} class="lsrow" href={`/study/topic?unit=${u.unit}`}>
                <span class="name">{u.title}</span>
                <span class="meta">{u.cards} kart · tekrar {u.due}</span>
                <span class="bar">{bar(u.strength)} {Math.round(u.strength * 100)}%</span>
              </Link>
            ))}
          </div>
        </fieldset>
      )}
    </Screen>
  );
}
