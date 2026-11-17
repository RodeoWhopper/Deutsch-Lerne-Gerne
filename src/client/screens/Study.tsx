import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from '../api.ts';
import type { Ctx } from '../main.tsx';
import { ArtText, Link, Rich, Screen, artClass, bar, nav, trackLabel, useKeys } from '../ui.tsx';

type Mode = 'daily' | 'sprint' | 'topic' | 'errors' | 'mini';
interface Q {
  card_id: string; track: string; unit: string; kind: 'choice' | 'type' | 'selfcheck'; label: string; prompt: string;
  choices?: string[]; lang?: 'de' | 'tr'; placeholder?: string; hint?: string; stage: string;
}
interface Res {
  correct: boolean; partial: boolean; grade: string; expected: string; user_line: string; expected_line: string; notes: string[];
  reveal: { explain?: string; example?: { de: string; tr: string }; trap?: string; note?: string; use?: string; article?: string };
  leech: boolean; requeue_ms: number | null;
}
interface Done { q: Q; correct: boolean; ms: number }

const mmss = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function Study({ mode, ctx }: { mode: Mode; ctx: Ctx }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const minutes = ([10, 15, 20].includes(Number(params.get('m'))) ? Number(params.get('m')) : ctx.settings.sprint_minutes) as 10 | 15 | 20;
  const track = params.get('track') ?? undefined;
  const unit = params.get('unit') ?? undefined;

  const queue = useRef<Q[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'ask' | 'busy' | 'result' | 'done'>('ask');
  const [res, setRes] = useState<Res | null>(null);
  const [picked, setPicked] = useState<string>('');
  const [text, setText] = useState('');
  const [hintOn, setHintOn] = useState(false);
  const [reveal, setReveal] = useState<{ expected: string; explain: string | null } | null>(null);
  const [left, setLeft] = useState(minutes * 60);
  const [tomorrow, setTomorrow] = useState<number | null>(null);
  const [error, setError] = useState('');
  const results = useRef<Done[]>([]);
  const retries = useRef<Record<string, number>>({});
  const t0 = useRef(0);
  const deadline = useRef(0);
  const timeUp = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // ---- load queue ----
  useEffect(() => {
    const body: Record<string, unknown> = { mode };
    if (mode === 'sprint') body.minutes = minutes;
    if (track) body.track = track;
    if (unit) body.unit = unit;
    api('POST', '/api/study/queue', body).then((r) => {
      if (r.status !== 200) { setError('Kartlar yüklenemedi'); return; }
      queue.current = r.data.questions;
      setLoaded(true);
      t0.current = performance.now();
      deadline.current = Date.now() + minutes * 60_000;
      if (queue.current.length === 0) setPhase('done');
    });
  }, []);

  // ---- sprint countdown ----
  useEffect(() => {
    if (mode !== 'sprint' || !loaded || phase === 'done') return;
    const t = setInterval(() => {
      const s = Math.round((deadline.current - Date.now()) / 1000);
      setLeft(s);
      if (s <= 0) timeUp.current = true;
    }, 500);
    return () => clearInterval(t);
  }, [mode, loaded, phase === 'done']);

  // ---- wake lock (sprint only) ----
  useEffect(() => {
    if (mode !== 'sprint' || !ctx.settings.wake_lock || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    (navigator as any).wakeLock.request('screen').then((l: WakeLockSentinel) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [mode]);

  const q = queue.current[idx];
  useEffect(() => {
    if (phase === 'ask') { t0.current = performance.now(); setText(''); setPicked(''); setHintOn(false); setReveal(null); setRes(null); if (q?.kind === 'type') setTimeout(() => input.current?.focus(), 30); }
  }, [idx, phase === 'ask']);

  useEffect(() => {
    if (phase !== 'done') return;
    api('GET', '/api/study/tomorrow').then((r) => r.status === 200 && setTomorrow(r.data.n));
  }, [phase === 'done']);

  const finish = () => setPhase('done');

  const submit = async (answer: string) => {
    if (!q || phase !== 'ask') return;
    const ms = Math.round(performance.now() - t0.current);
    setPhase('busy');
    const r = await api('POST', '/api/study/answer', { card_id: q.card_id, answer, ms, hint: hintOn, mode });
    if (r.status !== 200) { setError('Cevap gönderilemedi'); setPhase('ask'); return; }
    const d: Res = r.data;
    setRes(d); setPicked(answer);
    results.current.push({ q, correct: d.correct, ms });
    if (!d.correct && ctx.settings.vibrate && 'vibrate' in navigator) navigator.vibrate(40);
    if (d.requeue_ms !== null && (retries.current[q.card_id] ?? 0) < 3) {
      retries.current[q.card_id] = (retries.current[q.card_id] ?? 0) + 1;
      const at = Math.min(queue.current.length, idx + 1 + (d.requeue_ms <= 60_000 ? 4 : 9));
      queue.current.splice(at, 0, q);
    }
    setPhase('result');
  };

  const next = () => {
    if (timeUp.current && mode === 'sprint') return finish();
    if (idx + 1 >= queue.current.length) return finish();
    setIdx(idx + 1);
    setPhase('ask');
  };

  useKeys((e) => {
    if (e.key === 'Escape') { nav('/'); return; }
    if (phase === 'result' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); return; }
    if (phase === 'ask' && q?.kind === 'choice' && /^[1-9]$/.test(e.key)) {
      const c = q.choices?.[Number(e.key) - 1];
      if (c) submit(c);
    }
    if (phase === 'ask' && q?.kind === 'selfcheck' && reveal) {
      if (e.key === '1') submit('known');
      if (e.key === '2') submit('unknown');
    }
  }, [phase, idx, q, reveal, hintOn]);

  const insertChar = (ch: string) => {
    const el = input.current;
    if (!el) { setText(text + ch); return; }
    const s = el.selectionStart ?? text.length, e = el.selectionEnd ?? text.length;
    const v = text.slice(0, s) + ch + text.slice(e);
    setText(v);
    setTimeout(() => { el.focus(); el.setSelectionRange(s + 1, s + 1); }, 0);
  };

  const cmd = `./study --mode=${mode}${mode === 'sprint' ? ` --time=${minutes}` : ''}${track ? ` --track=${track}` : ''}${unit ? ` --unit=${unit}` : ''}`;
  const total = queue.current.length;

  if (error) return <Screen cmd={cmd} user={ctx.user} nav={false}><p class="errbox">{error}</p><Link href="/" class="btn">[ ana ekran ]</Link></Screen>;
  if (!loaded) return <Screen cmd={cmd} user={ctx.user} nav={false}><p class="boot">…</p></Screen>;
  if (phase === 'done') return <Summary cmd={cmd} ctx={ctx} results={results.current} tomorrow={tomorrow} mode={mode} empty={total === 0} />;
  if (!q) return null;

  const timer = mode === 'sprint' ? `[yoğun gün ${mmss(left)}]` : `[${mode}]`;
  const nDone = Math.min(idx + (phase === 'result' ? 1 : 0), total);

  return (
    <Screen cmd={cmd} user={ctx.user} nav={false}>
      <div class="status" aria-live="off">
        <span>{timer} {nDone}/{total}</span>
        <span class="bar">{bar(total ? nDone / total : 0)}</span>
      </div>
      <div class="study">
        <div class="qlabel">{trackLabel[q.track]} · {q.label}</div>
        <div class="qprompt">
          {q.track === 'artikel' ? q.prompt : q.kind === 'choice' && q.label === 'türkçesi?' ? <ArtText text={q.prompt} /> : <Rich text={q.prompt} />}
        </div>

        {phase === 'result' && res && <Result q={q} res={res} answer={picked} />}
        {timeUp.current && mode === 'sprint' && phase === 'ask' && <p class="dim">süre doldu: bu kartı bitir, sonra özet.</p>}
        <div class="grow" />

        <div class="thumb">
          {phase === 'result' && res && (
            <button class="btn pri block" onClick={next} autofocus>[ Enter ] devam</button>
          )}

          {phase !== 'result' && q.kind === 'choice' && (
            <div>
              {q.choices!.map((c, i) => (
                <button key={c} class={`opt ${q.track === 'artikel' ? artClass(c) : ''}`} disabled={phase === 'busy'} onClick={() => submit(c)}>
                  <span class="k">[{i + 1}]</span><span>{c}</span>
                </button>
              ))}
            </div>
          )}

          {phase !== 'result' && q.kind === 'type' && (
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) submit(text); }}>
              {hintOn && q.hint && <p class="dim">ipucu: {q.hint}</p>}
              <div class="inputline">
                <span class="gt">&gt;</span>
                <input
                  ref={input} type="text" value={text} placeholder=" " enterKeyHint="send" lang={q.lang}
                  autocapitalize="off" autocorrect="off" spellcheck={false} autocomplete="off" aria-label="cevap"
                  onInput={(e) => setText((e.target as HTMLInputElement).value)} disabled={phase === 'busy'}
                />
                <span class="cursor" aria-hidden="true">█</span>
              </div>
              {q.placeholder && <p class="dim">{q.placeholder}</p>}
              {q.lang === 'de' && (
                <div class="specials">
                  {['ä', 'ö', 'ü', 'ß'].map((ch) => (
                    <button key={ch} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => insertChar(ch)} aria-label={`${ch} ekle`}>{ch}</button>
                  ))}
                </div>
              )}
              <div class="btns">
                <button class="btn pri" type="submit" disabled={phase === 'busy' || !text.trim()}>[ Enter ] gönder</button>
                <button class="btn" type="button" onClick={() => setHintOn(true)} disabled={hintOn || !q.hint}>[?] ipucu</button>
                <button class="btn" type="button" onClick={() => submit('')} disabled={phase === 'busy'}>[ bilmiyorum ]</button>
              </div>
            </form>
          )}

          {phase !== 'result' && q.kind === 'selfcheck' && (
            reveal ? (
              <div>
                <div class="man"><div class="mh">cevap</div><Rich text={reveal.expected} />{reveal.explain && <p class="dim">{reveal.explain}</p>}</div>
                <button class="opt" disabled={phase === 'busy'} onClick={() => submit('known')}><span class="k">[1]</span><span>bildim</span></button>
                <button class="opt" disabled={phase === 'busy'} onClick={() => submit('unknown')}><span class="k">[2]</span><span>bilemedim</span></button>
              </div>
            ) : (
              <button class="btn pri block" onClick={async () => { const r = await api('POST', '/api/study/reveal', { card_id: q.card_id }); if (r.status === 200) setReveal(r.data); }}>[ cevabı göster ]</button>
            )
          )}
          <div class="status"><Link href="/">[Esc] çık</Link><span /></div>
        </div>
      </div>
    </Screen>
  );
}

function Result({ q, res, answer }: { q: Q; res: Res; answer: string }) {
  const stamp = res.correct ? (res.partial ? <span class="stamp part">[ ~ ]</span> : <span class="stamp ok">[ OK ]</span>) : <span class="stamp err">[ERR]</span>;
  const art = res.reveal.article;
  const isChoice = q.kind === 'choice';
  return (
    <div role="status">
      <div>{stamp} {res.leech && <span class="dim">bu kartı sık yanlış yapıyorsun</span>}</div>
      {!res.correct && (
        <div class="diff">
          {!isChoice && <div class="minus">{res.user_line || '(boş)'}</div>}
          {isChoice && <div class="minus">{answer || '(boş)'}</div>}
          <div class="plus">{art && q.track !== 'de-tr' ? <ArtText text={res.expected_line} /> : res.expected_line}</div>
        </div>
      )}
      {res.correct && res.partial && (
        <div class="diff sub"><div class="plus">{res.expected_line}</div></div>
      )}
      {res.correct && !res.partial && q.track === 'artikel' && <p>{<ArtText text={res.expected} />}</p>}
      {res.notes.map((n) => <p key={n} class="hi">{n}</p>)}
      {(res.reveal.explain || res.reveal.example || res.reveal.trap || res.reveal.note || res.reveal.use) && (
        <div class="man">
          {res.reveal.explain && <p><Rich text={res.reveal.explain} /></p>}
          {res.reveal.use && <p><span class="dim">kullanım:</span> {res.reveal.use}</p>}
          {res.reveal.trap && <p><span class="dim">tuzak:</span> {res.reveal.trap}</p>}
          {res.reveal.note && <p><span class="dim">not:</span> {res.reveal.note}</p>}
          {res.reveal.example && <p><Rich text={res.reveal.example.de} /><br /><span class="dim">{res.reveal.example.tr}</span></p>}
        </div>
      )}
    </div>
  );
}

function Summary({ cmd, ctx, results, tomorrow, mode, empty }: { cmd: string; ctx: Ctx; results: Done[]; tomorrow: number | null; mode: Mode; empty: boolean }) {
  const ok = results.filter((r) => r.correct).length;
  const byTrack = new Map<string, { n: number; ok: number }>();
  for (const r of results) {
    const t = byTrack.get(r.q.track) ?? { n: 0, ok: 0 };
    t.n++; if (r.correct) t.ok++;
    byTrack.set(r.q.track, t);
  }
  const weakest = [...results].sort((a, b) => Number(a.correct) - Number(b.correct) || b.ms - a.ms);
  const seen = new Set<string>();
  const weak5 = weakest.filter((w) => !seen.has(w.q.card_id) && seen.add(w.q.card_id)).slice(0, 5);
  return (
    <Screen cmd={cmd} user={ctx.user} nav={false}>
      {empty ? (
        <>
          <h1>çalışılacak kart yok</h1>
          <p>Bu mod için şu an çalışılacak kart yok.</p>
          {mode === 'errors' ? <p class="dim">Son 14 günde yanlış yapılan kart yok.</p> : <p class="dim">Aktif paketler ve günlük yeni kart limiti için <Link href="/packs">/packs</Link> ve <Link href="/settings">/settings</Link>.</p>}
        </>
      ) : (
        <>
          <h1>özet</h1>
          <div class="kv">
            <span>toplam</span><b>{results.length}</b>
            <span>doğru</span><b>{ok} ({results.length ? Math.round((ok / results.length) * 100) : 0}%)</b>
            <span>yarın için tahmini</span><span>{tomorrow ?? '…'} kart</span>
          </div>
          <fieldset>
            <legend>konu başına</legend>
            {[...byTrack].map(([t, v]) => (
              <div key={t} class="lsrow"><span class="name">{trackLabel[t]}</span><span class="meta">{v.ok}/{v.n} {bar(v.ok / v.n, 8)}</span></div>
            ))}
          </fieldset>
          <fieldset>
            <legend>en zayıf 5 kart</legend>
            {weak5.map((w) => (
              <div key={w.q.card_id} class="lsrow"><span class="name"><Rich text={w.q.prompt} /></span><span class="meta">{w.correct ? 'doğru' : 'yanlış'} · {Math.round(w.ms / 100) / 10}s</span></div>
            ))}
          </fieldset>
        </>
      )}
      <div class="btns">
        <Link class="btn pri" href="/errors">[ hata defterine bak ]</Link>
        <Link class="btn" href="/">[ ana ekran ]</Link>
      </div>
    </Screen>
  );
}
