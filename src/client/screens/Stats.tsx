import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import type { Ctx } from '../main.tsx';
import { Screen, bar, trackLabel } from '../ui.tsx';

export function Stats({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => { api('GET', '/api/stats').then((r) => r.status === 200 && setS(r.data)); }, []);
  if (!s) return <Screen cmd="stats" user={ctx.user}><p class="boot">…</p></Screen>;
  const maxMin = Math.max(1, ...s.minutes.map((m: any) => m.min));
  const maxF = Math.max(1, ...s.forecast.map((m: any) => m.n));
  return (
    <Screen cmd="stats --days=30" user={ctx.user}>
      <fieldset>
        <legend>isabet (son 30 gün)</legend>
        {s.accuracy.length === 0 && <p class="dim">Henüz veri yok.</p>}
        {s.accuracy.map((a: any) => (
          <div key={a.track} class="lsrow"><span class="name">{trackLabel[a.track]}</span><span class="meta">{a.ok}/{a.n} {bar(a.ok / a.n, 10)} {Math.round((a.ok / a.n) * 100)}%</span></div>
        ))}
      </fieldset>
      <fieldset>
        <legend>çalışma süresi (dk, son 14 gün)</legend>
        {s.minutes.map((m: any) => (
          <div key={m.day} class="lsrow"><span class="name dim">{m.day.slice(5)}</span><span class="meta">{bar(m.min / maxMin, 12)} {m.min}</span></div>
        ))}
      </fieldset>
      <fieldset>
        <legend>tahmini yük (vadesi gelecek kart)</legend>
        {s.forecast.map((m: any, i: number) => (
          <div key={m.day} class="lsrow"><span class="name dim">{i === 0 ? 'bugün' : m.day.slice(5)}</span><span class="meta">{bar(m.n / maxF, 12)} {m.n}</span></div>
        ))}
      </fieldset>
      <p class="dim">toplam kayıtlı cevap: {s.reviews_total}</p>
    </Screen>
  );
}
