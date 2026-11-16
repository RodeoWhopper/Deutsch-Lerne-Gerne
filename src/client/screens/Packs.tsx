import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import type { Ctx } from '../main.tsx';
import { Screen, fmtDate } from '../ui.tsx';

export function Packs({ ctx }: { ctx: Ctx }) {
  const [d, setD] = useState<any>(null);
  const [raw, setRaw] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [pw, setPw] = useState('');
  const [reset, setReset] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [undoId, setUndoId] = useState<number | null>(null);

  const load = () => api('GET', '/api/packs').then((r) => r.status === 200 && setD(r.data));
  useEffect(() => { load(); }, []);

  const onFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) { setErrs(['dosya 1 MB sınırını aşıyor']); return; }
    setRaw(await f.text()); setPlan(null); setErrs([]); setMsg('');
  };
  const dry = async () => {
    setBusy(true); setPlan(null); setErrs([]); setMsg('');
    const r = await api('POST', '/api/packs/dry-run', { raw });
    setBusy(false);
    if (r.status === 200) setPlan(r.data.plan);
    else setErrs(r.data?.errors ?? ['istek başarısız']);
  };
  const doImport = async () => {
    setBusy(true); setErrs([]);
    const r = await api('POST', '/api/packs/import', { raw, reset_progress: reset, reauth: { password: pw } });
    setBusy(false); setPw('');
    if (r.status === 200) { setMsg('içe aktarıldı. Paketi etkinleştirmeyi unutma.'); setPlan(null); setRaw(''); load(); }
    else if (r.status === 403) setErrs(['Doğrulama başarısız']);
    else setErrs(r.data?.errors ?? [r.data?.error ?? 'başarısız']);
  };
  const toggle = async (id: string, active: boolean) => { await api('PUT', `/api/packs/${id}/active`, { active }); load(); };
  const undo = async (id: number) => {
    const r = await api('POST', '/api/packs/undo', { import_id: id, reauth: { password: pw } });
    setPw(''); setUndoId(null);
    setMsg(r.status === 200 ? 'geri alındı' : r.status === 403 ? 'Doğrulama başarısız' : r.data?.error ?? 'başarısız');
    load();
  };

  return (
    <Screen cmd="ls packs/" user={ctx.user}>
      {msg && <p class="errbox" role="status">{msg}</p>}
      <fieldset>
        <legend>paketler</legend>
        {!d && <p class="boot">…</p>}
        {d && d.packs.length === 0 && <p class="dim">Henüz paket yok.</p>}
        {d?.packs.map((p: any) => (
          <div key={p.id} class="lsrow">
            <span class="name">{p.title}<br /><span class="dim">{p.id} · v{p.version} · {p.level} · {p.items} item{p.retired ? ` (+${p.retired} emekli)` : ''}</span></span>
            <button class={p.active ? 'btn pri' : 'btn'} aria-pressed={!!p.active} onClick={() => toggle(p.id, !p.active)}>{p.active ? '[x] aktif' : '[ ] pasif'}</button>
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>içe aktar</legend>
        <p class="dim">deutsch-pack/1 JSON yapıştır veya dosya seç. Önce dry-run yapılır, hiçbir şey yazılmaz.</p>
        <textarea value={raw} placeholder='{"standard":"deutsch-pack/1", …}' spellcheck={false} autocapitalize="off" autocorrect="off" aria-label="paket JSON"
          onInput={(e) => { setRaw((e.target as HTMLTextAreaElement).value); setPlan(null); setErrs([]); }} />
        <label for="pf">veya dosya</label>
        <input id="pf" type="file" accept="application/json,.json" onChange={onFile} />
        <div class="btns"><button class="btn pri" disabled={!raw.trim() || busy} onClick={dry}>[ dry-run ]</button></div>
        {errs.length > 0 && <div class="errbox" role="alert">{errs.map((e) => <div key={e}>{e}</div>)}</div>}
        {plan && (
          <div class="man">
            <div class="mh">{plan.pack.title} · v{plan.pack.version}</div>
            <div class="kv">
              <span>eklenecek</span><b>{plan.add}</b>
              <span>güncellenecek</span><b>{plan.update + plan.restore}</b>
              <span>değişmeyecek</span><span>{plan.unchanged}</span>
              <span>emekliye</span><b>{plan.retire}</b>
              <span>yeni kart</span><span>{plan.new_cards}</span>
            </div>
            {plan.answer_changed.length > 0 && (
              <>
                <p class="hi">Cevabı etkileyen alan değişti ({plan.answer_changed.length} item): ilerleme sıfırlanabilir.</p>
                <p class="dim">{plan.answer_changed.join(', ')}</p>
                <label><input type="checkbox" checked={reset} onChange={(e) => setReset((e.target as HTMLInputElement).checked)} /> bu itemların ilerlemesini sıfırla</label>
              </>
            )}
            <label for="rp">onay için parola</label>
            <input id="rp" type="password" autocomplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
            <div class="btns"><button class="btn pri" disabled={!pw || busy} onClick={doImport}>[ içe aktar ]</button></div>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>içe aktarma geçmişi</legend>
        {d?.log.length === 0 && <p class="dim">Kayıt yok.</p>}
        {d?.log.map((l: any) => (
          <div key={l.id} class="lsrow">
            <span class="name">{l.pack_id} v{l.version}<br /><span class="dim">{fmtDate(l.at)} · #{l.sha256} · +{l.added} ~{l.updated} ={l.unchanged} −{l.retired}{l.undone_at ? ' · geri alındı' : ''}</span></span>
            {l.undoable && <button class="btn" onClick={() => setUndoId(undoId === l.id ? null : l.id)}>[ geri al ]</button>}
            {undoId === l.id && (
              <div class="sub">
                <label for="up">parola</label>
                <input id="up" type="password" autocomplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
                <div class="btns"><button class="btn pri" disabled={!pw} onClick={() => undo(l.id)}>[ onayla ]</button></div>
              </div>
            )}
          </div>
        ))}
      </fieldset>
    </Screen>
  );
}
