# Deutsch Terminal

Tek kullanıcılı, mobil öncelikli, retro-terminal görünümlü Almanca çalışma uygulaması (PWA). **Ders anlatmaz; çalıştırır, tekrar ettirir, hataları biriktirir.** Hedef sürtünmesizlik: telefonu aç, 15-20 dk çalış, kapat.

- 6 track: `artikel`, `tr→de`, `de→tr`, `gramer`, `fiil`, `edat/bağlaç`
- 5 mod: Günlük, **Yoğun gün (sprint, 10/15/20 dk)**, Konu, Hata defteri, Mini (2 dk)
- Aralıklı tekrar (SM-2 türevi), objektif cevap kontrolü (artikel zorunlu, `ae/oe/ue/ss` kabul, Türkçe I/İ doğru)
- İçerik koddan ayrı: **Content Pack** (`deutsch-pack/1`) olarak içe aktarılır
- Üçüncü taraf istek yok (CDN, analytics, harici font yok); her şey self-host

## Hızlı kurulum (Docker)

```bash
docker build -t deutsch-terminal .
docker volume create deutsch-data
# 1) tek seferlik hesap oluşturma, çıktıyı DOĞRUDAN parola yöneticisine kopyala
docker run --rm -it -v deutsch-data:/data deutsch-terminal npm run setup
# 2) çalıştır (HTTPS sonlandıran bir reverse proxy arkasında)
docker run -d --name deutsch --restart unless-stopped -v deutsch-data:/data -p 8080:8080 \
  -e TRUST_PROXY=1 deutsch-terminal
```

`setup` kullanıcı adını sorar, ≥ 24 karakterlik rastgele parola, TOTP secret (QR dahil) ve 10 kurtarma kodu üretip **bir kez** gösterir. Hiçbir yere kaydedilmez, **sohbete veya repoya yapıştırma**. Authenticator uygulamana QR'ı tara.

Proxy `X-Forwarded-For` ve `X-Forwarded-Proto` eklemeli (Fly, Railway, Caddy, nginx ekler). Barındırma adımları ve yedek için `RUNBOOK.md`.

## Günlük kullanım
1. Uygulamayı ana ekrana ekle, aç, bir kez giriş yap (oturum 30 gün açık kalır, TOTP tekrar sorulmaz).
2. Ana ekranda **günlük** (vadeli + yeni kartlar), yoğun bir günse **yoğun gün** (süre seç), 2 dakikan varsa **mini**.
3. Cevap yazarken `ä ö ü ß` satırı ekran klavyesinin üstündedir. Klavye: `1-3` seçenek, `Enter` gönder/devam, `Esc` çık.
4. Yanlışlar otomatik **hata defterine** girer; 8+ kez yanlış yapılan kartlar sülük olur. **Hata → sülük özeti** ile Claude'a yapıştırıp yeni anımsatıcı isteyebilirsin.

## Yeni içerik ekleme
1. Yeni öğrendiklerini **yeni bir Claude sohbetinde** anlat; önce `docs/LLM_BRIEF.md` içeriğini yapıştır. Claude `deutsch-pack/1` JSON'u üretir.
2. Uygulamada **paket** sekmesi → JSON'u yapıştır (veya dosya seç) → **dry-run** → özeti kontrol et → parolayla **içe aktar**.
3. Paketi **etkinleştir** (yeni paketler pasif gelir). Bundan sonra günlük/sprint'e girer.
4. Hata olursa aynı `pack.id` ile `version` artırıp tekrar yükle; ya da son içe aktarmayı **geri al**.

CLI ile doğrulama: `npm run pack:validate packs/_example.json`. Örnek paket: `packs/_example.json` (Ulaşım, 43 item).

## Geliştirme

```bash
npm ci --ignore-scripts
npm run build          # vite build + service worker
npm test               # 76 test (birim + entegrasyon)
npm run typecheck
ALLOW_INSECURE_DEV=1 DATA_DIR=./data npm run setup
ALLOW_INSECURE_DEV=1 DATA_DIR=./data npm start   # http://localhost:8080
```

`ALLOW_INSECURE_DEV=1` yalnızca yerel geliştirme içindir (HTTPS yönlendirmesini kapatır). Node ≥ 22.16 gerekir.

## Belgeler
`RUNBOOK.md` (yedek, geri yükleme, kimlik sıfırlama, güncelleme) · `SECURITY.md` · `DECISIONS.md` · `TEST_REPORT.md` · `docs/CONTENT_STANDARD.md` · `docs/LLM_BRIEF.md` · `schema/deutsch-pack.schema.json`
