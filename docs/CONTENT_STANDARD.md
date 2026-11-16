# İçerik standardı: `deutsch-pack/1`

Tek biçim, katı JSON (YAML değil). Doğrulayıcı: `npm run pack:validate <dosya>` ve uygulamadaki içe aktarma ekranı **aynı** kodu kullanır (`src/shared/pack.ts`). JSON Schema 2020-12 dosyası `schema/deutsch-pack.schema.json` aynı kaynaktan üretilir (`npm run schema:gen`); çapraz alan kuralları (tek `{{cloze}}`, `answer ∈ choices`, tekil id, isim büyük harfi) yalnızca uygulama doğrulayıcısında vardır.

## Zarf

| Alan | Kural |
|---|---|
| `standard` | sabit `"deutsch-pack/1"` |
| `pack.id` | `^[a-z0-9][a-z0-9-]{2,63}$`, değişmez |
| `pack.title` | 1-80 karakter |
| `pack.version` | tam sayı ≥ 1; aynı id + aynı/küçük sürüm reddedilir |
| `pack.level` | `A1 \| A2 \| B1 \| B2` |
| `pack.taught_on` | geçerli `YYYY-MM-DD` (yeni kart açma sırası) |
| `pack.unit` | `^[a-z0-9-]{2,32}$` |
| `items` | ≤ 2000 |
| `retire` | emekliye ayrılacak item id'leri (silme yalnızca burada) |

Tüm nesnelerde bilinmeyen alan reddedilir. Metinler NFC'ye normalize edilir; kontrol karakterleri, sıfır genişlikli ve çift yönlü (bidi) karakterler reddedilir. Paket üst sınırı 1 MB.

## Item türleri ve üretilen kartlar

| kind | alanlar | kartlar (track) |
|---|---|---|
| `noun` | `de`(büyük harf, artikelsiz), `article`, `plural?`, `plural_only?`, `tr[]`, `example?` | artikel, tr-de ("der Bus"), de-tr |
| `word` | `pos`, `de`, `tr[]`, `forms?` (yalnız fiil), `example?` | tr-de, de-tr, `forms` varsa gramer (çekim, form başına bir kart) |
| `verb_case` | `de`, `tr[]`, `case`: akk\|dat\|both, `reverse_structure?`, `cloze?`, `trap?`, `example?` | fiil (hâl), `cloze` varsa fiil (boşluk), de-tr |
| `prep` | `de`, `tr[]`, `case`: akk\|dat\|gen\|wechsel, `use?`, `example` | edat-baglac (hâl), de-tr |
| `conj` | `de`, `tr[]`, `verb_position`: end\|second\|none, `example` | edat-baglac (fiil konumu), de-tr |
| `grammar` | `format`: mcq (`prompt`,`choices`,`answer`) \| cloze (`text`,`accept?`) \| qa (`prompt`,`answer`); `explain?` | gramer |
| `phrase` | `de`, `tr[]` | tr-de, de-tr |

Ortak: `id` (`^[a-z0-9][a-z0-9._-]{2,63}$`, global tekil, değişmez), `kind`, `note?` (≤400), `tags?` (≤8).

## İçe aktarma semantiği

- Önce **dry-run**: eklenecek / güncellenecek / değişmeyecek / emekliye ayrılacak sayıları; cevabı etkileyen değişiklikler (`de`, `article`, `answer`, `case`, `verb_position`, `text`, `accept`, `forms`, `cloze`, `choices`) ayrıca listelenir ve ilerlemenin sıfırlanıp sıfırlanmayacağı seçilir.
- Aynı `id` + değişmiş içerik: yerinde güncellenir, SRS ilerlemesi korunur (sıfırlama seçilmediyse).
- Pakette artık bulunmayan item **silinmez**; yalnızca `retire` ile emekliye ayrılır (çalışmadan çıkar, ilerleme arşivde kalır).
- Tek transaction: hata varsa hiçbir şey yazılmaz. Parola doğrulaması gerekir. `import_log`'a (hash, sayılar, zaman) yazılır; **en son** içe aktarma geri alınabilir.
- Yeni içe aktarılan paket **pasiftir**; Paketler ekranından etkinleştirilir.

## Yazım kuralları (insan / LLM)

1. İsimler büyük harfle, artikel yalnızca `article` alanında.
2. `tr` her zaman dizi; yaygın eş anlamlıları ekle.
3. Her `verb_case` için mümkünse `cloze` ve Türkçe `trap`.
4. Edat/bağlaç item'larında en az bir `example`.
5. `id` önekleri: `n.` `w.` `v.` `p.` `c.` `g.` `s.`; id ASCII (ä → ae).
6. Düz metin; HTML yok. Yalnızca `**kalın**` serbest.
7. `pack.id` ve `item.id` değişmez; düzeltme aynı id ile `version` artırılarak yapılır.

Çalışan örnek: `packs/_example.json` (43 item, 6 track'in hepsine kart üretir).
