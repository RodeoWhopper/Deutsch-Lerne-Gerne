# RUNBOOK

Tüm komutlar sunucu kabuğunda (veya `docker exec`/`docker run --rm -it -v deutsch-data:/data deutsch-terminal ...`) çalışır. Veri `DATA_DIR` (Docker'da `/data`) altındadır: `app.db` (+ `-wal`, `-shm`).

## İlk kurulum
```bash
npm run setup          # kullanıcı adı sorar; parola, TOTP secret/QR, 10 kurtarma kodu basar (bir kez)
```
Çıktıyı doğrudan parola yöneticisine kopyala. Zaten kullanıcı varsa komut reddeder.

## Kimlik bilgisi sıfırlama (parola/TOTP kaybı)
```bash
npm run reset-credentials   # yeni parola + TOTP + kurtarma kodları, TÜM oturumlar düşer
```
İlerleme ve içerik korunur. Web üzerinden sıfırlama yoktur. Telefon kaybında: önce bunu çalıştır, sonra Ayarlar → "tüm oturumları kapat" gereksizdir (zaten düşer).

Yalnızca bir kurtarma kodu kullandıysan girişten sonra yenisini üret: `reset-credentials`.

## Yedek (şifreli)
Bir kez anahtar çifti üret (özel anahtarı **sunucuda tutma**, parola yöneticisine koy):
```bash
age-keygen -o deutsch-backup.key     # "Public key: age1..." satırını not et
```
Yedek al:
```bash
BACKUP_AGE_RECIPIENT=age1... npm run backup      # /data/backups/deutsch-<zaman>.db.age
# Docker: docker exec -e BACKUP_AGE_RECIPIENT=age1... deutsch npm run backup
```
`INSTALL_AGE=0` ile derlenmiş imajda `age` yoktur; varsayılan imajda vardır. Yedek SQLite'ın tutarlı çevrimiçi kopyasıdır (uygulama çalışırken alınabilir). Yedekleri sunucudan dışarı kopyala (örn. `docker cp`, `scp`). Haftalık cron önerilir. Ek olarak uygulamada Ayarlar → ilerleme **dışa aktar (JSON)** vardır.

Yedek, `age` anahtarı olmadan okunamaz; anahtarsız yedek alma komutu reddeder.

## Geri yükleme
```bash
# 1) uygulamayı durdur
docker stop deutsch
# 2) geri yükle (mevcut DB app.db.pre-restore-<ts> olarak saklanır)
docker run --rm -it -v deutsch-data:/data -v "$PWD":/in deutsch-terminal \
  npm run restore -- /in/deutsch-<zaman>.db.age /in/deutsch-backup.key
# 3) başlat
docker start deutsch
```
`restore` şifreyi çözer, `PRAGMA integrity_check` ve şema/kullanıcı kontrolü yapar; başarısızsa mevcut DB'ye dokunmaz. Geri yüklenen DB'deki oturumlar yedek anındaki hâlidir; şüphe varsa `reset-credentials` çalıştır.

**Prova (yapıldı, TEST_REPORT.md):** yedek → boş dizine geri yükleme → `integrity_check = ok`, kullanıcı mevcut; yanlış anahtarla geri yükleme reddedildi.

## Güncelleme
```bash
git pull
docker build -t deutsch-terminal .
docker stop deutsch && docker rm deutsch
docker run -d --name deutsch --restart unless-stopped -v deutsch-data:/data -p 8080:8080 -e TRUST_PROXY=1 deutsch-terminal
```
Şema `CREATE TABLE IF NOT EXISTS` ile açılışta uygulanır. Güncellemeden önce yedek al. Service worker sürümü her derlemede değişir; istemciler bir sonraki açılışta yeni kabuğu alır.

## Barındırma notları
- Tek container + kalıcı volume (`/data`). Fly.io/Railway/Molder.sh/VPS fark etmez.
- TLS'i platform/reverse proxy sonlandırır; `TRUST_PROXY=1` (zincirde 1 proxy). Proxy `X-Forwarded-For/Proto` göndermeli.
- Sağlık: `GET /healthz` → `ok` (imajda `HEALTHCHECK` var).
- **Tek örnek** çalıştır (SQLite). Ölçeklendirme yok.
- Dağıtım sonrası bir kez `testssl.sh` ve securityheaders benzeri tarama yap; sonuçları `TEST_REPORT.md`'ye ekle (şu an açık madde).

## Sorun giderme
| Belirti | Çözüm |
|---|---|
| Giriş "Çok fazla deneme" | Bekle (≤ 15 dk), sayaç kendi söner; kimlik bilgilerini sıfırlamak sayaçları da temizler |
| 429 her yerde | Proxy gerçek IP'yi iletmiyor: `TRUST_PROXY` ve `X-Forwarded-For` kontrol et |
| Çerez set edilmiyor | Siteye HTTPS ile eriş (`__Host-` çerezi `Secure` ister) |
| Paket "sürüm" hatası | Aynı `pack.id` için `version` artır |
| Disk dolu | `/data/backups` eski yedekleri temizle |
