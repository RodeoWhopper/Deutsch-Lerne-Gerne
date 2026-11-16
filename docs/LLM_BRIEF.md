# Deutsch Terminal: içerik paketi üretme özeti (Claude'a yapıştır)

Aşağıdaki kurallara göre, öğrendiğim konuyu **yalnızca geçerli JSON** olarak üret (açıklama, markdown çiti, yorum yok). Çıktı `deutsch-pack/1` standardındadır.

**Zarf:** `{"standard":"deutsch-pack/1","pack":{"id","title","version","level","taught_on","unit"},"items":[...],"retire":[]}`
`pack.id` `^[a-z0-9][a-z0-9-]{2,63}$` (bir kez verilir, değişmez) · `version` tam sayı ≥1 (düzeltme = aynı id, version+1) · `level` A1|A2|B1|B2 · `taught_on` YYYY-MM-DD · `unit` `^[a-z0-9-]{2,32}$` · ≤2000 item · `retire`: kaldırılacak item id'leri.

**Genel kurallar:** Bilinmeyen alan yasak. Düz metin, HTML yok (yalnızca `**kalın**`). Her item `id` ister: `^[a-z0-9][a-z0-9._-]{2,63}$`, ASCII (ä→ae), global tekil, değişmez. Önekler: `n.` isim, `w.` kelime, `v.` fiil+hâl, `p.` edat, `c.` bağlaç, `g.` gramer, `s.` kalıp. `tr` her zaman **dizi** (tek anlam bile `["..."]`, yaygın eş anlamlıları ekle). İsimler büyük harfle, artikel yalnızca `article` alanında. Opsiyonel: `note` (≤400), `tags` (≤8).

```json
{"id":"n.bus","kind":"noun","de":"Bus","article":"der","plural":"Busse","tr":["otobüs"],"example":{"de":"Ich fahre mit dem Bus.","tr":"Otobüsle gidiyorum."}}
{"id":"w.fahren","kind":"word","pos":"verb","de":"fahren","tr":["araçla gitmek"],"forms":{"ich":"fahre","du":"fährst","er":"fährt"}}
{"id":"v.folgen","kind":"verb_case","de":"folgen","tr":["takip etmek"],"case":"dat","cloze":"Ich folge {{dem}} Fahrer.","example":{"de":"Ich folge dem Fahrer.","tr":"Şoförü takip ediyorum."},"trap":"Türkçede -i alır ama Dativ."}
{"id":"p.mit","kind":"prep","de":"mit","tr":["ile"],"case":"dat","use":"araç veya kişi","example":{"de":"Ich fahre mit dem Bus.","tr":"Otobüsle gidiyorum."}}
{"id":"c.weil","kind":"conj","de":"weil","tr":["çünkü"],"verb_position":"end","example":{"de":"Ich lerne, weil ich arbeiten möchte.","tr":"Çalışmak istediğim için öğreniyorum."}}
{"id":"g.dat.mit.fem","kind":"grammar","format":"mcq","prompt":"Wir fahren mit ___ U-Bahn.","choices":["dem","der","den","die"],"answer":"der","explain":"mit + Dativ; dişil → der"}
{"id":"g.vom","kind":"grammar","format":"cloze","text":"Er kommt {{vom}} Bahnhof.","accept":["vom","von dem"],"explain":"von + dem = vom"}
{"id":"s.wo-ist-haltestelle","kind":"phrase","de":"Wo ist die Haltestelle?","tr":["Durak nerede?"]}
```

**Alan kısıtları:** `noun.article` der|die|das; `plural_only:true` ise article `die`. `word.pos` verb|adj|adv|other, `forms` (ich,du,er,wir,ihr,sie) yalnızca fiilde. `verb_case.case` akk|dat|both (`both`: kişi Dativ, şey Akkusativ); `reverse_structure:true` gefallen/gehören gibi ters yapı; mümkünse `cloze` (tam bir `{{...}}`) ve Türkçe `trap`. `prep.case` akk|dat|gen|wechsel, `example` zorunlu. `conj.verb_position` end|second|none, `example` zorunlu. `grammar.format`: `mcq` (2-6 `choices`, `answer` choices içinden), `cloze` (`text` içinde tam bir `{{...}}`, opsiyonel `accept`), `qa` (`prompt` + `answer`).

**Çıktı:** yalnızca JSON. Başlamadan önce eksik bilgiyi (konu, seviye, ders tarihi) sor; sonra paketi ver.
