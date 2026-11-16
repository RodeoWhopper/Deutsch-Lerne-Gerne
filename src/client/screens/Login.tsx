import { useState } from 'preact/hooks';
import { api, setCsrf } from '../api.ts';

export function Login() {
  const [step, setStep] = useState<'pw' | 'otp'>('pw');
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
    if (r.status === 200) { setChallenge(r.data.challenge); setPw(''); setStep('otp'); } else fail(r.status, r.data);
  };
  const submitOtp = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await api('POST', '/api/auth/totp', { challenge, code: code.trim() });
    setBusy(false);
    if (r.status === 200) { setCsrf(r.data.csrf); location.assign('/'); }
    else { fail(r.status, r.data); if (r.status === 401) { setStep('pw'); setCode(''); } }
  };

  return (
    <div class="term">
      <header class="prompt"><span class="u">deutsch</span><span class="p">:~$</span> login</header>
      <main>
        {step === 'pw' ? (
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
