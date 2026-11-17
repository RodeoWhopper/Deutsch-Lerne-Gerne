import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import type { Ctx } from '../main.tsx';
import { Link, Rich, Screen, trackLabel } from '../ui.tsx';

function Row({ e }: { e: any }) {
  return (
    <div class="lsrow">
      <span class="name"><Rich text={e.de} /></span>
      <span class="meta">{trackLabel[e.track]} · {e.lapses}x</span>
      {(e.tr || e.answer) && <span class="sub">{e.tr ? e.tr.join(' / ') : e.answer}</span>}
    </div>
  );
}

export function Errors({ ctx }: { ctx: Ctx }) {
  const [d, setD] = useState<any>(null);
  const [exp, setExp] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api('GET', '/api/errors').then((r) => r.status === 200 && setD(r.data)); }, []);
  const doExport = async () => {
    const r = await api('GET', '/api/errors/export');
    if (r.status === 200) setExp(r.data.text);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(exp); setCopied(true); } catch { /* user can select manually */ } };
  return (
    <Screen cmd="cat errors.log" user={ctx.user}>
      {!d ? <p class="boot">…</p> : (
        <>
          <div class="btns">
            <Link class="btn pri" href="/study/errors">[ hataları çalış ]</Link>
            <button class="btn" onClick={doExport}>[ zorlanılan kartların özeti ]</button>
          </div>
          {exp && (
            <fieldset>
              <legend>paylaşabileceğin özet</legend>
              <textarea readOnly value={exp} aria-label="zorlanılan kartların özeti" />
              <div class="btns"><button class="btn" onClick={copy}>{copied ? '[ kopyalandı ]' : '[ kopyala ]'}</button></div>
            </fieldset>
          )}
          <fieldset>
            <legend>çok yanlış yapılan kartlar ({d.leeches.length})</legend>
            {d.leeches.length === 0 && <p class="dim">Çok yanlış yapılan kart yok.</p>}
            {d.leeches.map((e: any) => <Row key={e.card_id} e={e} />)}
          </fieldset>
          <fieldset>
            <legend>son 14 gün ({d.recent.length})</legend>
            {d.recent.length === 0 && <p class="dim">Hata defteri boş.</p>}
            {d.recent.map((e: any) => <Row key={e.card_id} e={e} />)}
          </fieldset>
        </>
      )}
    </Screen>
  );
}
