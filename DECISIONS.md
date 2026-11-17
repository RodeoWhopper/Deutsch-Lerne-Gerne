# DECISIONS

Belirsizlikte seçilen varsayımlar. Biçim: tarih · karar · gerekçe. (Hepsi 2026-11-16, geliştirme agent'ı.)

## Yığın
1. **`node:sqlite` (Node ≥ 22.16 yerleşik) kullanıldı, `better-sqlite3` değil.** `npm ci --ignore-scripts` zorunluluğu (§4.8) native modülün derlenmesini/indirilmesini engeller; yerleşik modül sıfır bağımlılık, WAL ve `backup()` API'si var. Bedeli: modül Node'da hâlâ "experimental" uyarısı verir (`--disable-warning=ExperimentalWarning` ile susturuldu).
2. **Sunucu için derleme adımı yok.** Node 22 TypeScript'i yerinde çalıştırır (type stripping); `tsconfig` `erasableSyntaxOnly` ile enum/parametre-özelliği gibi sözdizimini yasaklar. Tip denetimi: `npm run typecheck`.
3. **TOTP (RFC 6238) 40 satırda elle yazıldı** (`src/server/totp.ts`), `otpauth` bağımlılığı eklenmedi (SOP §0.5). RFC test vektörleri yerine canlı doğrulayıcı uygulamayla uyumlu standart parametreler (SHA-1, 6 hane, 30 sn) kullanıldı.
4. **Çalışma zamanı bağımlılıkları (6):** hono, @hono/node-server, zod, @node-rs/argon2, qrcode-terminal (yalnızca setup CLI), preact. Frontend UI kiti yok, router/state kütüphanesi yok.
5. **Hash parametreleri:** argon2id, m=64 MiB, p=1; `timeCost` setup sırasında bu makinede ~300 ms olana kadar artırılır (üretimde ölçülen t, hash içinde saklanır).

## Güvenlik
6. **Brute-force eşikleri:** IP başına 5 hatadan sonra gecikme `2^(n-4)` sn (n=hata sayısı; 5. hatadan sonra 2 sn, tavan 900 sn). Global sayaç eşiği 20 (tek IP'nin sahibi kilitlemesini sınırlar ama dağıtık saldırıyı da yavaşlatır). Sayaçlar 24 saat sonra söner; hesap asla kalıcı kilitlenmez. IP'ler sayaçta `SHA-256(salt+ip)` olarak tutulur, loglarda `/24` (IPv6 `/48`) kısaltmasıyla görünür.
7. **Sıkı rate-limit yalnızca `/api/auth/login` ve `/api/auth/totp`'ta** (20/dk/IP). İlk denemede `/api/auth/me` de kapsanıyordu ve her sayfa yüklemesi 429 alıyordu; hata sayacı zaten tüm kimlik doğrulama yüzeyini koruyor. Diğer API: 400/dk/IP.
8. **Cevaplar sunucuda değerlendirilir** (`POST /api/study/answer`). Kuyruk yanıtı doğru cevabı içermez; kullanıcı yazdığı metni gönderir, sunucu doğrular, notlar (SRS) hesaplar. Bu hem not üretimini istemciden bağımsız kılar hem de "içerik JS bundle'ında değildir" kuralını güçlendirir. Tek istisna `qa` kartlarında cevabı gösteren `POST /api/study/reveal`.
9. **TOTP secret DB'de düz metin** saklanır (doğrulama için ham değer gerekir). Önlem: DB `0600`, veri dizini `0700`, yedekler `age` ile şifreli. Ek bir `DATA_KEY` şifrelemesi eklenmedi (anahtarı aynı makinede olurdu).
10. **Yeniden kimlik doğrulama (içe aktarma, geri alma, ilerleme içe aktarma): parola.** TOTP de kabul edilir ama oturum açma anındaki adım replay korumasıyla tüketildiği için pratikte parola kullanılır. Başarısız reauth de hata sayacına yazılır.
11. **CSRF:** Origin = Host zorunlu + `Sec-Fetch-Site` (varsa) `same-origin` + oturuma bağlı rastgele token (`X-CSRF-Token`) + yalnızca `application/json`. Giriş uçları için token yok (oturum yok), Origin + SameSite=Strict + JSON kısıtı var.
12. **HTTPS yönlendirmesi** `X-Forwarded-Proto`'ya dayanır (`TRUST_PROXY>0`). Başlık yoksa yönlendirme yapılmaz; Fly/Railway/Caddy/nginx bu başlığı ekler. `/healthz` yönlendirmeden muaftır.
13. `X-Frame-Options: DENY` SOP listesine ek olarak eklendi (eski tarayıcılar için `frame-ancestors` yedeği). `Permissions-Policy`'den Chrome'un tanımadığı `bluetooth`/`interest-cohort` çıkarıldı (konsol uyarısı veriyordu), `browsing-topics=()` eklendi.
14. **Faz 2 (passkey) yapılmadı** (SOP'ta opsiyonel).

## Çalışma motoru
15. **Gün sınırı** 04:00 Europe/Istanbul = 01:00 UTC (Türkiye sabit UTC+3). `due` UTC epoch ms; gün hesabı `studyDay()`.
16. **Erken tekrar:** vadesi gelmemiş bir `review` kartı doğru cevaplanırsa (sprint dolgusu/hata defteri) aralık ve vade **değişmez** (yalnızca kayıt ve seri güncellenir); yanlışsa normal sülük/relearning uygulanır. Böylece sprint dolgusu aralıkları şişirmez.
17. **Oturum içi yeniden gösterim:** öğrenme adımındaki kart (1 dk / 10 dk) kuyrukta 4 / 9 kart sonrasına eklenir, kart başına en fazla 3 kez; sonrası zaten SRS vadesine bırakılır (kapatsan bile 1 dk sonra vadeli olur).
18. **Türkçe cevapta** büyük/küçük harf ve aksan farkı kabul edilir, doğrusu gösterilir, `good` notu verilir. **Almancada** yalnızca büyük/küçük harf hatası `hard`; `ae/oe/ue/ss` karşılığı kabul edilir ve ceza yoktur. Artikel yazılı büyük harfle ("Der Bus") de kabul.
19. **Sprint:** (a) vadeli ≤ %60, (b) hata/sülük ≤ %80 kümülatif (yani ek %20), (c) her track'ten ≥ 2 kart, (d) ayar açıksa yeni kart (bütçenin ≤ %25'i), (e) zayıf/taze dolgu. **Hiç öğrenilmemiş (yalnızca yeni kartı olan) bir track kapsama garantisine giremez**, çünkü yeni kart yalnızca ayarda açıksa serbesttir (§6 madde 4).
20. **Kardeş kart aralığı** "en az 5" hedeftir; aktif item sayısı azsa mümkün olan en geniş aralık korunur (4 itemlik bir günde 5 mümkün değildir).
21. **İçe aktarma geri alma:** yalnızca **en son** (geri alınmamış) içe aktarma geri alınabilir; sıralı yığın düzeni, ara durumların tutarsızlaşmasını önler. Geri alınan içe aktarmanın eklediği kartların cevap geçmişi silinir.
22. İlerleme içe aktarma yalnızca mevcut kartların SRS durumunu, ayarları, paket aktifliğini ve cevap geçmişini geri yükler; paket/item içeriği içe aktarmaz (içerik paketlerle gelir).
23. `de-tr` kartlarında seçenek sayısı 4; aynı `kind` + aynı ünitede yeterli yanlış şık yoksa diğer ünite, sonra diğer türler kullanılır; 3'ten az şık bulunamazsa kart yazarak sorulur.

## Arayüz
24. **Gölge blokları `░▒▓` kullanılmadı.** Seçilen font Terminus (OFL; ä ö ü ß Ä Ö Ü ğ Ğ ş Ş ı İ ç Ç, `─│┌┐└┘`, `█▓▒░` için cmap kapsamı tam). Ancak glif testinde TTF'teki `░` boş, `▒` iç içe dikdörtgen, `▓` düz blok çıkıyor (bozuk vektörleştirme). Bu yüzden çubuklar `█` (dolu, `--fg`) + `█` (boş, `--line`) ile çizilir; kutu çizgi karakterleri yerine 1px CSS border kullanılır. Alternatif adaylar (VT323/Departure Mono) Almanca+Türkçe+kutu kapsamını sağlamıyor veya pakette bulunamadı.
25. **Font boyutu 17px** (spec), Terminus sadece küçük boyutlarda bitmap gibi netleşir; ölçekli ekranlarda (DPR 2-3) görünüm kabul edilebilir. Kalın (bold) font yok, vurgu `--hi` rengiyle yapılır (`font-synthesis: none`).
26. **Tema paletleri kontrast testiyle ayarlandı** (`node scripts/contrast.mjs`): amber `--line` `#5A3F0A` → `#8A6414` (3.66:1), yeşil `--fg-dim`/`--line` açıldı, DOS `--line` `#5555FF` → `#7B7BFF`, `--fg-dim` `#7F7FCC` → `#A0A0E8`, DOS `die` `#FF5555` → `#FF6E6E` (4.88:1). Hepsi gövde ≥ 4.5:1, çizgi ≥ 3:1.
27. **CRT efektinin tarama çizgisi** CSS gradient değil, 1×2 piksellik PNG dokusudur (§8.6 gradient yasağına uygun), opaklık 0.06, varsayılan kapalı.
28. **Doğru/yanlış damgası:** `[ OK ]` çerçeveli, `[ERR]` ters video (dolu zemin), `[ ~ ]` kesikli çerçeve + metin. Artikel renkleri yalnızca der/die/das bilgisi taşır.
29. **PWA:** service worker yalnızca hash'li `assets/` ve `fonts/*.woff2` dosyalarını önbelleğe alır; HTML ve `/api/*` asla. Dolayısıyla çevrimdışı açılış yoktur (Faz 2 isteğe bağlı). Lighthouse 12+ PWA kategorisini kaldırdığı için PWA doğrulaması manifest/ikon/SW etkinleşme/önbellek içeriği kontrolüyle yapıldı (TEST_REPORT).

## Teslimat
30. **Canlıya alma yapılmadı.** Alan adı satın alma ve ücretli barındırma kararı SOP §0.1 gereği Hüseyin'e aittir; bu yüzden §4.10'un "dağıtım sonrası TLS/başlık taraması" maddesi açık kalır (TEST_REPORT'ta işaretli). Yerelde yapılabilen her şey yapıldı.
31. **Dockerfile tabanı `node:22-trixie-slim`** (`age` paketi bookworm'da yok, trixie'de var). `INSTALL_AGE=0` build argümanı ağsız CI için `age` kurulumunu atlar; yedek alacak üretim imajı varsayılanla (=1) derlenmelidir. Taban imaj `NODE_IMAGE` argümanıyla değiştirilebilir.
32. Paket sürümleri `package.json`'da tam olarak sabitlenmiştir (`--save-exact`), `package-lock.json` commit'lidir.
33. **Alan adı `dlg.runiksoft.com`, Cloudflare Tunnel** (2026-11-17, Hüseyin'in kararı; DNS/tunnel'ı o tanımlar). `docker-compose.yml` uygulama + cloudflared'ı birlikte çalıştırır, host portu açılmaz. `APP_HOST` ile Host/Origin tek alan adına kilitlenir (Host header saldırılarına karşı ek katman). `TRUST_PROXY=1` (tek hop).
