# TEST_REPORT

Tarih: 2026-11-16 · Ortam: Linux container, Node 22.23, Chromium (Playwright), Docker 29.9 · Sürüm: Faz 1-5 (canlıya alma hariç, aşağıya bak)

## Özet

| | Durum |
|---|---|
| Birim + entegrasyon testleri | **72/72 geçti** (`npm test`) |
| §4.10 testleri (12 madde) | **10 geçti**, 1 kısmi (trivy), **1 açık** (canlı TLS taraması: dağıtım yapılmadı) |
| Uçtan uca (390×844 gerçek Chromium) | geçti: giriş+TOTP, paket içe aktarma (UI), günlük + sprint oturumu, 3 tema, 7 ekran, yatay taşma yok |
| Üçüncü taraf istek | **0** |
| Lighthouse (mobil) | performans 100 · erişilebilirlik 100 · en iyi uygulamalar 100 (5 ekran) |
| `npm audit --omit=dev` | 0 açık |
| Secret taraması | temiz (3 yanlış pozitif, aşağıda) |
| Yedek / geri yükleme provası | geçti |
| **Canlıya alma** | **yapılmadı** (alan adı/ücretli barındırma kararı Hüseyin'in; bkz. DECISIONS #30) |

## §4.10 doğrulama tablosu

| # | Test | Beklenen | Sonuç | Kanıt |
|---|---|---|---|---|
| 1 | Oturumsuz her API route'una istek (rota tablosundan otomatik tarama + bilinmeyen rota) | 401, veri/yapı yok | **GEÇTİ** | `test/server.test.ts` "oturumsuz her API route'u 401" (≥ 20 rota×metot; gövdede stack/sürüm yok). Sayfalar `/login`'e 302, bilinmeyen yol 404, `/assets/../../package.json` 404 |
| 2 | Çerez bayrakları | `__Host-`, HttpOnly, Secure, SameSite=Strict, Path=/, Domain yok; DB'de yalnızca hash | **GEÇTİ** | "çerez bayrakları" testi (Set-Cookie ayrıştırıldı, ham token DB'de aranıp bulunmadı) |
| 3 | 6+ hatalı giriş | üstel gecikme, log'da kayıt | **GEÇTİ** | İlk 5 deneme 401, 6. deneme 429 + `Retry-After`, doğru parola bile 429; farklı IP etkilenmez (kalıcı kilit yok); `login_audit`'te ≥ 6 kayıt |
| 4 | Aynı TOTP kodunu tekrar kullanma | reddedilir | **GEÇTİ** | "replay" testi: aynı kod ilk girişte 200, ikinci girişte 401. Kurtarma kodu da tek kullanımlık |
| 5 | Başka origin'den mutasyon (CSRF) | reddedilir | **GEÇTİ** | `Origin: https://evil.example` → 403; Origin yok → 403; CSRF token yok/yanlış → 403; `Sec-Fetch-Site: cross-site` → 403; `x-www-form-urlencoded` → 415; ayar değişmedi |
| 6 | Pakette `<img onerror>`/`<script>`/`javascript:` | düz metin, çalışmaz | **GEÇTİ** | Paket kabul edilir, DB'de birebir saklanır (`test/pack.test.ts`, `server.test.ts`); istemci kodunda `innerHTML`/`dangerouslySetInnerHTML`/`eval`/inline script-style yok (`test/engine.test.ts` kod denetimi); CSP `script-src 'self'` |
| 7 | Şemaya uymayan / > 1 MB paket | reddedilir, kısmi yazma yok | **GEÇTİ** | Geçersiz kind → 422 ve `items` tablosu boş kaldı; 1.1 MB → 400/413/422, yazma yok; reauth başarısız → 403, yazma yok; kontrol/bidi karakter, `__proto__`, 2001 item, tekrarlı id reddedilir |
| 8 | `curl -I` başlıkları | §4.5'teki hepsi | **GEÇTİ** (yerel) | Aşağıdaki çıktı + 5 yol için otomatik başlık testi |
| 9 | Ağ izleme: açılışta üçüncü taraf istek | sıfır | **GEÇTİ** | `scripts/e2e.mjs` tüm oturum boyunca `foreign requests = 0`, konsol hatası 0 |
| 10 | `npm audit --omit=dev`, secret taraması | temiz | **GEÇTİ** (kısmi araç) | Aşağıda; `gitleaks`/`trivy` bu ortamda yok/indirilemedi, yerine `detect-secrets` + regex kullanıldı |
| 11 | Container kullanıcısı / izinler | non-root, yalnızca volume yazılabilir | **GEÇTİ** | Aşağıdaki `docker run` çıktısı |
| 12 | Dağıtım sonrası TLS + başlık taraması (testssl.sh / securityheaders) | zayıf protokol yok, not ≥ A | **AÇIK** | Dağıtım yapılmadı. Başlık seti yerelde eksiksiz; HSTS/CSP/COOP/CORP/Permissions-Policy/nosniff/Referrer-Policy hepsi var. Dağıtımdan sonra RUNBOOK'taki taramalar çalıştırılmalı |

### §4.10-8: `curl -I` (konteynerden, `ALLOW_INSECURE_DEV=1` ile HTTP; HSTS yalnızca HTTPS'te etkilidir)
```
HTTP/1.1 200 OK
cache-control: no-store
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
content-type: text/html; charset=utf-8
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()
referrer-policy: no-referrer
strict-transport-security: max-age=63072000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
x-robots-tag: noindex, nofollow
```
(`/login` yanıtı; API yanıtlarında ek olarak `Cache-Control: no-store`. `robots.txt` → `Disallow: /`. HTTP→HTTPS 308 yönlendirmesi `X-Forwarded-Proto: http` ile test edildi.)

### §4.10-11: container (`docker run --read-only --cap-drop ALL --security-opt no-new-privileges -v dtdata:/data`)
```
uid=1000(node) gid=1000(node) groups=1000(node)
touch: cannot touch '/app/x': Read-only file system
touch: cannot touch '/etc/x': Read-only file system
touch: cannot touch '/tmp/x': Read-only file system
(/data) yazıldı
healthcheck: ok     ·   HEALTHCHECK tanımlı (node fetch /healthz)
-rw------- 1 node node 4096 app.db        (veri dizini 0700'e sıkılaştırıldı; WAL/SHM dizin izniyle korunur)
setup ikinci kez: "Kullanıcı zaten var. Kimlik bilgilerini yenilemek için: npm run reset-credentials"
```
Not: Sandbox'ta imaj içi `npm ci` ve `apt` adımları ağ kısıtı yüzünden çalışmadı (TLS-intercept proxy). Bu yüzden **son aşama** (kullanıcı, izinler, healthcheck, çalışma) önceden kurulmuş `node_modules` ile derlenip doğrulandı (`INSTALL_AGE=0`). `Dockerfile`'ın tam derlemesi (npm ci + vite build aşamaları) ağ erişimli bir makinede ilk dağıtımda doğrulanmalıdır; `vite build` ve `npm ci --omit=dev --ignore-scripts` aynı komutlarla yerelde çalıştı.

### §4.10-10: bağımlılık ve secret taramaları
```
$ npm audit --omit=dev
found 0 vulnerabilities

$ npm ls --omit=dev --depth=0
deutsch-terminal@1.0.0 /home/user/Deutsch-Lerne-Gerne
+-- @hono/node-server@2.1.8
+-- @node-rs/argon2@2.2.2
+-- hono@4.13.19
+-- preact@11.2.0
+-- qrcode-terminal@0.12.0
`-- zod@4.6.7
```
`detect-secrets scan --all-files` (lockfile/dist/screenshot hariç) 3 bulgu verdi, hepsi yanlış pozitif: `src/server/totp.ts` (base32 alfabesi sabiti), `test/server.test.ts` (test parolası dizgileri `'wrong-'`, `'nope'`). Repo geçmişi (`git log -p`) üzerinde `PRIVATE KEY`, `AGE-SECRET-KEY`, 32 karakterlik base32, `password/token/api_key = '...'` kalıpları arandı: yalnızca `package-lock.json` bütünlük hash'leri eşleşti. `.env` repoda yok (`.gitignore`). `trivy` imajı ağ kısıtı nedeniyle indirilemedi (403): imaj taraması **yapılmadı**, dağıtım öncesi `trivy image deutsch-terminal` çalıştırılmalı.

## Faz kanıtları

### Faz 1: temel + güvenlik
- Kurulum çıktısı (secret'lar gizli): bkz. container bölümü; `argon2id m=64 MiB, t=19, p=1 (~303 ms)`, ≥ 28 karakter parola, 10 kurtarma kodu (DB'de yalnızca hash), TOTP QR + otpauth URI, ikinci çalıştırma reddi.
- §4.10'un 1-5. testleri yukarıda; ek olarak: boşta 14 gün sonra oturum düşer, tüm oturumları kapatma/tek tek iptal, çıkış sonrası 401, audit ve oturum listesinde tam IP yok (`a.b.c.0`), audit'te parola/secret yok.

### Faz 2: çalışma motoru (birim test raporu)
`test/answer.test.ts`, `test/srs.test.ts`, `test/engine.test.ts`: Türkçe I/İ/ı/i ("ISI"→"ısı", "İstanbul", "IŞIK", `toLowerCase()` ile farkı), ae/oe/ue/ss kabulü ve ipucu, artikel eksik ("artikeli yaz"), yanlış artikel, isim küçük harf → doğru + `hard` + not, kart üretim tablosu §7.3, tüm örnek kartlar için soru üretimi + doğru/yanlış değerlendirme, de-tr kademeli zorluk, günlük yeni kart limiti, `taught_on` sıralaması, SM-2 adımları (1 dk→10 dk→1 gün→3 gün→×ease, ease alt sınırı 1.3, ±5% sapma, 04:00 gün sınırı), not üretimi (again/hard/good/easy), erken tekrar, hata defteri 14 gün penceresi, sülük (≥ 8), mini ≤ 10, sprint (yeni kart yok, süre bütçesi ≤ %112, 6 track kapsaması, art arda ≤ 3 aynı track, 10 dk < 15 dk, ayarla yeni kart).

### Faz 3: içerik standardı
`test/pack.test.ts` (geçerli / geçersiz / zararlı örnekler): örnek paket geçerli; Ajv ile JSON Schema 2020-12 aynı kararı verir; bilinmeyen alan, yanlış standard/id/level/tarih/sürüm, küçük harfli/artikelli isim, `plural_only`, cloze/mcq kuralları, tekrarlı id, 2001 item, kontrol/sıfır-genişlik/bidi karakteri, NFC normalizasyonu, 1 MB üstü, bozuk JSON, `__proto__`, zararlı stringler (düz metin kalır). Entegrasyon: dry-run yazmaz, reauth zorunlu, atomik, import_log, aynı sürüm reddi, **geri alma** (öğeler silinir, paket kaydı geri döner).
CLI: `npm run pack:validate packs/_example.json` → `GEÇERLİ: h1g2-ulasim v1, 43 item, 0 retire`.

### Faz 4: yoğun gün, hata defteri, arayüz, PWA
Mobil ekran görüntüleri (390×844, DPR 2) `screenshots/` altında, `scripts/e2e.mjs` ile üretildi:

| Dosya | Ekran |
|---|---|
| `01-login`, `02-login-totp` | giriş (parola, sonra TOTP) |
| `03-boot-or-home`, `17-home`, `08-home-amber` | ana ekran (amber) |
| `06-home-green`, `07-home-dos`, `06b-settings-dos` | yeşil fosfor ve DOS mavi temalar |
| `04-packs-dryrun`, `05-packs` | paket içe aktarma: dry-run özeti, etkinleştirme |
| `09-study-choice`, `10-study-type`, `11-study-result` | çalışma: artikel seçimi, yazarak cevap (ä ö ü ß satırı), sonuç damgası |
| `12-sprint-summary`, `12a-daily-summary`, `12b-mini`, `12c-errors-session` | oturum özetleri, mini, hata modu |
| `13-topics`, `14-errors`, `14b-errors-export`, `15-stats`, `16-settings` | konular, hata defteri + sülük özeti, istatistik, ayarlar |
| `18-crt-on` | CRT efekti açık |

Kontrast testi (`node scripts/contrast.mjs`): 3 tema × (fg, dim, hi, der, die, das ≥ 4.5:1; line ≥ 3:1), hepsi OK.

Lighthouse (mobil emülasyon 390×844, oturum çerezi ile): 

| Sayfa | Performans | Erişilebilirlik | En iyi uygulamalar |
|---|---|---|---|
| `/login` | 100 | 100 | 100 |
| `/` | 100 | 100 | 100 |
| `/study/daily` | 100 | 100 | 100 |
| `/settings` | 100 | 100 | 100 |
| `/packs` | 100 | 100 | 100 |

SEO kategorisi bilinçli olarak 54: sayfalar `noindex` (kişisel uygulama) ve meta açıklaması yok. Lighthouse 12+ "PWA" kategorisini kaldırdığı için PWA kontrolü elle yapıldı: manifest `display: standalone`, `start_url /`, 192/512 ve maskable 512 ikon (kendi üretimimiz `>_` piksel ikonu, `scripts/make-icons.py`), hepsi HTTP 200; service worker `activated`, scope `/`, önbellek yalnızca `/assets/*.js`, `/assets/*.css`, `/fonts/*.woff2`; `/api/*` önbellekte **yok**. Çevrimdışı açılış bilinçli olarak yok (HTML ve API önbelleğe alınmaz).

Önceki turlarda yakalanıp düzeltilen gerçek hatalar: Terminus'ta `░▒▓` glifleri bozuk (bkz. DECISIONS #24); `/api/auth/me`'nin sıkı rate-limit'e takılıp sayfa yüklemesini 429'a düşürmesi; `Permissions-Policy` içinde tanınmayan `bluetooth` özelliği; alt gezinmenin son satırı örtmesi (Lighthouse `target-size`).

### Faz 5: yedek / geri yükleme provası
```
$ BACKUP_AGE_RECIPIENT=age1... npm run backup
yedek yazıldı: /tmp/bk/deutsch-2026-11-16T21-51-47-119Z.db.age        (139496 bayt, düz metin SQLite başlığı yok)
$ BACKUP_AGE_RECIPIENT= npm run backup
BACKUP_AGE_RECIPIENT (age1... genel anahtar) ayarlı olmalı. Şifresiz yedek alınmaz.
$ npm run restore -- yedek.db.age key.txt        # boş veri dizinine
geri yüklendi. Uygulamayı yeniden başlat; ...
restored user= huseyin  integrity= ok
$ npm run restore -- yedek.db.age yanlis-anahtar.txt
şifre çözme başarısız        (mevcut DB'ye dokunulmadı)
```

## Tam test listesi (`npm test`)
```
ok 1 - Türkçe I/İ/ı/i: tr-aware lowercasing
ok 2 - Türkçe cevap: "ISI" -> "ısı" tam doğru, uyarı yok
ok 3 - Türkçe cevap: "ışık" yazılınca "ışık" kabul
ok 4 - Türkçe cevap: "İstanbul" ve "istanbul"
ok 5 - Türkçe: ısı ile isi karışmaz ama aksan toleransı notla kabul
ok 6 - Türkçe: ç/ş/ğ/ö/ü aksansız kabul, doğrusu gösterilir
ok 7 - Türkçe: eş anlamlı varyantlar
ok 8 - trFold ASCII dönüşümü
ok 9 - Almanca: ae/oe/ue/ss kabul, doğrusu ipucu, ceza yok
ok 10 - Almanca: tam doğru -> not yok
ok 11 - Almanca: yalnızca büyük/küçük harf -> doğru ama caseOnly (hard)
ok 12 - Almanca: yanlış cevap
ok 13 - Almanca: trailing noktalama
ok 14 - Almanca tr-locale ile "I" bozulmaz (de lower)
ok 15 - İsim: artikel eksik -> yanlış + "artikeli yaz"
ok 16 - İsim: yanlış artikel
ok 17 - İsim: doğru
ok 18 - İsim: küçük harf -> doğru ama hard + not
ok 19 - İsim: umlaut transliterasyonu + artikel
ok 20 - Artikel büyük harfle yazılsa da kabul
ok 21 - §7.3 kart üretimi tablosu
ok 22 - örnek paket 6 track'in hepsine kart üretir
ok 23 - her kart için soru üretilir ve doğru cevap doğru değerlendirilir (tüm kartlar)
ok 24 - de-tr kademeli zorluk: new/learning -> 4 seçenek, review (>=3 gün) -> yazarak
ok 25 - seçenek şıkları benzer kelimelerden (aynı kind + ünite), kendi cevabını tekrarlamaz
ok 26 - günlük limit: yeni kart sayısı ayardaki limiti aşmaz, sonra 0
ok 27 - yeni kartlar paketin taught_on / item sırasına göre açılır
ok 28 - §6 sprint: yeni kart yok (ayar kapalı), süre bütçesi, track kapsama, art arda ≤3 aynı track
ok 29 - sprint: ayarda "sprint'te yeni kart" açıkken ve limit varken yeni kart eklenir
ok 30 - mini en fazla 10 kart
ok 31 - hata defteri: son 14 günde again alan kartlar; 14 gün sonra düşer
ok 32 - sülük: lapses >= 8
ok 33 - erken tekrar (vadesi gelmemiş, doğru) aralığı şişirmez
ok 34 - hint kullanımı -> hard, ease düşer
ok 35 - istemci kodunda innerHTML / dangerouslySetInnerHTML / eval yok (§4.7)
ok 36 - örnek paket geçerli
ok 37 - JSON Schema (2020-12) örneği kabul eder, zod ile aynı sonuç
ok 38 - bilinmeyen alan reddedilir (üst, pack, item)
ok 39 - yanlış standard, id, level, tarih
ok 40 - noun kuralları: küçük harf de, artikelli de, plural_only+article
ok 41 - cloze tam bir {{}} içermeli; mcq answer choices içinde
ok 42 - tekrarlı item id, 2000+ item
ok 43 - kontrol karakterleri ve bidi reddedilir
ok 44 - NFC normalizasyonu uygulanır
ok 45 - 1 MB üstü ve geçersiz JSON reddedilir
ok 46 - zararlı string içerikli paket geçerli ama düz metin olarak saklanır
ok 47 - __proto__ anahtarı reddedilir
ok 48 - setup: parola >= 24 karakter, 10 kurtarma kodu, argon2id hash, TOTP
ok 49 - setup ikinci kez --reset olmadan reddedilir
ok 50 - §4.10-1: oturumsuz her API route'u 401, veri yok
ok 51 - oturumsuz sayfa istekleri /login'e yönlenir, bilinmeyen yol 404
ok 52 - §4.10-2: çerez bayrakları (__Host-, HttpOnly, Secure, SameSite=Strict, Path=/, Domain yok)
ok 53 - §4.10-3: 6+ hatalı giriş -> üstel gecikme, audit kaydı
ok 54 - yanlış kullanıcı adı ile yanlış parola aynı hata
ok 55 - §4.10-4: aynı TOTP kodu tekrar kullanılamaz (replay)
ok 56 - kurtarma kodu tek kullanımlık
ok 57 - §4.10-5: CSRF: başka origin / CSRF token yok / yanlış content-type reddedilir
ok 58 - §4.10-8: tüm yanıtlarda güvenlik başlıkları
ok 59 - HTTP -> HTTPS yönlendirmesi (proxy arkasında)
ok 60 - §4.10-6/7: paket içe aktarma: dry-run, yeniden kimlik doğrulama, atomik, zararlı string düz metin
ok 61 - akış: import -> aktif et -> kuyruk -> cevap -> SRS -> geri al
ok 62 - oturum yönetimi: liste, iptal, hepsini kapat; çıkış sonrası 401
ok 63 - oturum: boşta 14 gün ve mutlak 30 gün sonra düşer
ok 64 - gizli bilgi logda yok: audit yalnızca olay türü içerir
ok 65 - gün sınırı 04:00 Europe/Istanbul
ok 66 - yeni kart: good -> 10 dk -> good -> 1 gün
ok 67 - yeni kart: again -> 1 dk
ok 68 - mezuniyet: 1 gün, sonra 3 gün, sonra interval x ease
ok 69 - review again: lapse, ease düşer (alt sınır 1.3), relearning
ok 70 - hard/easy ease değişimi
ok 71 - ±5% sapma sınırı
ok 72 - not üretimi
# tests 72
# pass 72
# fail 0
```

## Uçtan uca koşu (`scripts/e2e.mjs`)
```
ok  : login + TOTP
ok  : paket içe aktarma + etkinleştirme (UI)
ok  : günlük oturum (37 kart cevaplandı)
ok  : sprint oturumu (33 kart cevaplandı)
ok  : yatay taşma yok: / (0)
ok  : yatay taşma yok: /topics (0)
ok  : yatay taşma yok: /errors (0)
ok  : yatay taşma yok: /packs (0)
ok  : yatay taşma yok: /stats (0)
ok  : yatay taşma yok: /settings (0)
ok  : yatay taşma yok: /study/sprint (0)
ok  : üçüncü taraf istek sayısı = 0 
ok  : konsol hatası yok
```

## Açık maddeler (dürüst liste)
1. **Canlıya alma ve canlı TLS/başlık taraması yapılmadı** (§4.10 #12). Hüseyin barındırıcıyı/alan adını seçince: dağıtım → `testssl.sh <alan>` + securityheaders taraması → sonuçları bu dosyaya ekle.
2. **`trivy` imaj taraması ve `gitleaks`** bu ortamda çalıştırılamadı (ağ kısıtı); `npm audit` + `detect-secrets` + regex taraması yapıldı. Dağıtım öncesi `trivy image` ve `gitleaks detect` çalıştırılmalı.
3. **Dockerfile'ın tam (npm ci dahil) derlemesi** sandbox ağında engellendi; son aşama doğrulandı, derleme aşamaları aynı komutlarla yerelde çalıştı.
4. **Gerçek telefon testi yapılmadı**; 390×844 emülasyon + Lighthouse mobil. iOS Safari'de `__Host-` çerezi yalnızca HTTPS'te çalışır; ilk dağıtımda gerçek cihazda giriş, ana ekrana ekleme ve `ä ö ü ß` satırı denenmeli.
5. Faz 2 (passkey, çevrimdışı çalışma) kapsam dışı bırakıldı.
