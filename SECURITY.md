# SECURITY

Tek kullanıcılı, internete açık, kişisel içerik. Bu belge uygulanan önlemleri, doğrulama yöntemlerini ve bilinen sınırları özetler. Ayrıntılı kanıt: `TEST_REPORT.md`.

## Kimlik doğrulama
- **Genel kayıt endpoint'i yok.** Hesap `npm run setup` ile veya yalnızca kullanıcı yokken `SEED_USERNAME`/`SEED_PASSWORD` ortam değişkenleriyle oluşur (DECISIONS #35); seed'li hesapta TOTP ilk girişte kaydedilir. İkinci setup `--reset` olmadan reddedilir.
- Parola CSPRNG ile 28 karakter üretilir, bir kez terminale basılır, hiçbir yere yazılmaz. argon2id (m=64 MiB, t=makineye göre ~300 ms) ile saklanır.
- TOTP varsayılan olarak zorunlu; `REQUIRE_TOTP=0` ile kapatılabilir (DECISIONS #36, tek faktör: güçlü parola şart). TOTP açıkken (RFC 6238, ±1 pencere, **replay koruması**: son kullanılan time-step saklanır). 10 tek kullanımlık kurtarma kodu yalnızca SHA-256 hash olarak saklanır.
- Sıfırlama yalnızca sunucu kabuğundan (`npm run reset-credentials`): parola, TOTP, kurtarma kodları yenilenir, tüm oturumlar düşer. Web'de "şifremi unuttum" yoktur.
- Tek tip hata ("Giriş başarısız"); kullanıcı adı var/yok ayrımı sızmaz (sahte hash ile eşit süre).

## Oturum
- 32 byte rastgele opak token; DB'de yalnızca SHA-256 hash'i. Çerez `__Host-sid`, `HttpOnly; Secure; SameSite=Strict; Path=/`, Domain yok. Girişte yeni token (fixation yok). Mutlak 30 gün, boşta 14 gün.
- Ayarlar'da oturum listesi (cihaz, son kullanım, kısaltılmış IP), tek tek/toplu iptal, son 20 giriş.

## Brute-force
IP başına ve global sayaç, 5. hatadan sonra üstel gecikme (tavan 15 dk), hesap kalıcı kilitlenmez. `/api/auth/login|totp` için ayrı rate limit. Tüm girişler `login_audit`'e (yalnızca olay türü + kısaltılmış IP).

## Taşıma ve başlıklar
HTTPS-only (HTTP→HTTPS 308, `TRUST_PROXY` ile gerçek IP). Tüm yanıtlarda: katı CSP (inline script/style yok), HSTS (2 yıl, includeSubDomains), nosniff, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP/CORP same-origin, `X-Robots-Tag: noindex`, API için `Cache-Control: no-store`.

## Erişim kontrolü
Varsayılan **deny**: `/login`, `/api/auth/login|totp`, `/healthz`, `robots.txt` ve hash'li statik dosyalar dışında her şey oturum ister; bilinmeyen yollar 404 (oturumsuz API istekleri 401). Mutasyonlar: JSON-only + Origin=Host + CSRF token. Her girdi `zod` strict şemasından geçer. SQL yalnızca parametreli. İçerik JS bundle'ında değildir; yalnızca yetkili API'den gelir. Stack trace / sürüm bilgisi dönmez.

## İçerik paketi içe aktarma
Düz metin JSON; HTML/URL/dosya eki yok; uygulama dışarıya hiç istek atmaz (SSRF yüzeyi sıfır). 1 MB / 2000 item sınırı, NFC, kontrol/bidi karakterleri reddedilir. İstemci **asla** `innerHTML` kullanmaz (testle denetlenir), yalnızca metin düğümleri; tek biçim `**kalın**` kendi ayrıştırıcısıyla DOM düğümlerine çevrilir. Dry-run → parola ile onay → tek transaction → `import_log` → geri alınabilir.

## Altyapı
Container non-root (`node`), kök dosya sistemi salt-okunur çalıştırılabilir, yalnızca `/data` yazılabilir, `HEALTHCHECK` var. Lockfile commit'li, sürümler pin'li, `npm ci --ignore-scripts`, `npm audit --omit=dev` temiz. `.env` repoda yok, secret yalnızca ortam değişkeninden.

## Log ve yedek
Yapısal log; parola, token, TOTP, kurtarma kodu, tam IP, çerez loglanmaz. `npm run backup` SQLite online-backup ile tutarlı kopya alır ve `age` ile şifreler (anahtarsız yedek almayı reddeder). `npm run restore` bütünlüğü doğrular.

## Bilinen sınırlar / varsayımlar
- TOTP secret doğrulama için DB'de düz metindir; DB dosyasına erişim = secret'a erişim. Önlem: dosya izinleri + şifreli yedek + disk şifrelemesi (barındırıcıda).
- İlk kimlik bilgileri sunucu kabuğunun çıktısında bir kez görünür; barındırıcı log toplayıcısı bu oturumu kaydediyorsa kimlik bilgilerini sıfırla (`npm run reset-credentials`).
- Hız sınırı bellek içidir (yeniden başlatmada sıfırlanır); kalıcı olan hata sayacı (DB) asıl korumadır.
- Çevrimdışı mod ve passkey (Faz 2) uygulanmadı.

## Sorun bildirme
Kişisel proje: sahibine doğrudan bildirin.
