import { useState } from 'preact/hooks';
import { api, setCsrf } from '../api.ts';

export function Login() {
  const [step, setStep] = useState<'pw' | 'otp' | 'enroll' | 'codes'>('pw');
  const [setup, setSetup] = useState<{ secret: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (status: number, data: any) => {
    if (status === 429) setErr(`Çok fazla deneme. ${data?.retry_after ?? ''} sn bekle.`);
    else if (status === 0) setErr('Sunucuya ulaşılamadı');
    else setErr('Giriş başarısız');
  };
  const submitPw = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await api('POST', '/api/auth/login', { username: user, password: pw });
    setBusy(false);
    if (r.status === 200 && r.data.ok) { setCsrf(r.data.csrf); location.assign('/'); return; }
    if (r.status === 200) {
      setChallenge(r.data.challenge); setPw('');
      if (r.data.enroll) {
        const e = await api('POST', '/api/auth/enroll-start', { challenge: r.data.challenge });
        if (e.status === 200) { setSetup({ secret: e.data.secret }); setStep('enroll'); } else fail(e.status, e.data);
      } else setStep('otp');
    } else fail(r.status, r.data);
  };
  const submitOtp = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await api('POST', '/api/auth/totp', { challenge, code: code.trim() });
    setBusy(false);
    if (r.status === 200) { setCsrf(r.data.csrf); location.assign('/'); }
    else { fail(r.status, r.data); if (r.status === 401) { setStep('pw'); setCode(''); } }
  };

  const submitEnroll = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await api('POST', '/api/auth/enroll-finish', { challenge, code: code.trim() });
    setBusy(false);
    if (r.status === 200) { setCsrf(r.data.csrf); setCodes(r.data.recovery_codes); setStep('codes'); }
    else { fail(r.status, r.data); setCode(''); }
  };

  return (
    <div class="term">
      <header class="prompt"><span class="u">deutsch</span><span class="p">:~$</span> login</header>
      <main>
        {step === 'codes' ? (
          <div>
            <h1>kurtarma kodları</h1>
            <p>Bunları şimdi parola yöneticine kopyala. Bir daha gösterilmez; her biri tek kullanımlıktır.</p>
            <pre class="pre hi" aria-label="kurtarma kodları">{codes.join('\n')}</pre>
            <div class="btns"><button class="pri btn block" onClick={() => location.assign('/')}>[ kopyaladım, devam ]</button></div>
          </div>
        ) : step === 'enroll' ? (
          <form onSubmit={submitEnroll}>
            <h1>doğrulayıcı kurulumu</h1>
            <p>Authenticator uygulamanda (Google Authenticator, Aegis, 1Password…) "kurulum anahtarı ile elle ekle" seç, tür: zamana dayalı:</p>
            <pre class="pre hi" aria-label="kurulum anahtarı">{setup?.secret}</pre>
            <label for="c">uygulamanın gösterdiği 6 haneli kod</label>
            <input id="c" type="text" name="otp" inputMode="numeric" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck={false} autofocus value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} required maxLength={6} />
            <div class="btns"><button class="pri btn block" type="submit" disabled={busy}>[ doğrula ve bitir ]</button></div>
          </form>
        ) : step === 'pw' ? (
          <form onSubmit={submitPw}>
            <label for="u">kullanıcı</label>
            <input id="u" type="text" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck={false} value={user} onInput={(e) => setUser((e.target as HTMLInputElement).value)} required maxLength={64} />
            <label for="p">parola</label>
            <input id="p" type="password" name="password" autocomplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} required maxLength={256} />
            <div class="btns"><button class="pri btn block" type="submit" disabled={busy}>[ giriş ]</button></div>
          </form>
        ) : (
          <form onSubmit={submitOtp}>
            <label for="c">doğrulama kodu (6 hane) veya kurtarma kodu</label>
            <input id="c" type="text" name="otp" inputMode="text" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck={false} autofocus value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} required maxLength={24} />
            <div class="btns"><button class="pri btn block" type="submit" disabled={busy}>[ doğrula ]</button></div>
          </form>
        )}
        {err && <p class="errbox" role="alert">{err}</p>}
      </main>
    </div>
  );
}
