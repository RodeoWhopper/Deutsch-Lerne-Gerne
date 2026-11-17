import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import type { Ctx } from '../main.tsx';
import { Link, Screen, bar, trackLabel } from '../ui.tsx';

export function Topics({ ctx }: { ctx: Ctx }) {
  const [h, setH] = useState<any>(null);
  useEffect(() => { api('GET', '/api/home').then((r) => r.status === 200 && setH(r.data)); }, []);
  return (
    <Screen cmd="ls topics/" user={ctx.user}>
      {!h ? <p class="boot">…</p> : (
        <>
          <fieldset>
            <legend>track</legend>
            {Object.entries<any>(h.tracks).map(([t, v]) => (
              <Link key={t} class="lsrow" href={`/study/topic?track=${t}`}>
                <span class="name">{trackLabel[t]}</span>
                <span class="meta">{v.cards} kart · tekrar {v.due} · yeni {v.new}</span>
                <span class="bar">{bar(v.strength, 20)} {Math.round(v.strength * 100)}%</span>
              </Link>
            ))}
          </fieldset>
          <fieldset>
            <legend>ünite</legend>
            {h.units.length === 0 && <p class="dim">Aktif paket yok.</p>}
            {h.units.map((u: any) => (
              <Link key={u.unit} class="lsrow" href={`/study/topic?unit=${u.unit}`}>
                <span class="name">{u.title}</span>
                <span class="meta">{u.cards} kart · tekrar {u.due}</span>
                <span class="bar">{bar(u.strength, 20)} {Math.round(u.strength * 100)}%</span>
              </Link>
            ))}
          </fieldset>
        </>
      )}
    </Screen>
  );
}
