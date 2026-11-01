# Vites

Her prompt için Claude Code modelini ve düşünme eforunu otomatik seçer. Hızlı işler küçük modele düşük eforla, zor işler elindeki en güçlü modele uzun düşünerek gider.

[Model Gear](https://github.com/muhamoussa7/claude-model-gear) 0.2.3'ten (MIT, Muhammad Moussa) türetilmiştir. Üzerine Türkçe arayüz ve Türkçe kelime kuralları, vites numarası, maliyet tavanı, geç vites düşürme, `#etiket` ile tek seferlik seçim, seçim günlüğü ve tasarruf raporu eklenir.

## Kurulum

Plugin destekli Claude Code gerekir. Model Gear kuruluysa önce kaldır; ikisi aynı `model` ayarı için yarışır.

```
claude plugin marketplace add MuhammetEnesDemirkol/vites
claude plugin uninstall model-gear@claude-model-gear
claude plugin install vites@demirkol
```

Repo özelse önce `gh auth login` ile erişimi olan hesapla giriş yap. Yerel bir kopyadan kurmak için ilk satırda repo adı yerine klasör yolunu ver (örn. `claude plugin marketplace add C:\yol\vites`).

Yeni bir oturum aç. Vites her yeni oturumda kendiliğinden açılır; alt barda `Vites: Açık` çipi görünür. Çipe basınca açılıp kapanır.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `/vites aç` | Açar, o anki modeli hatırlar. |
| `/vites kapat` | Kapatır, hatırladığı modeli geri koyar. Günlüğü ve token toplamlarını silmez. |
| `/vites durum` veya `/vites` | Açık mı, hangi model, son seçim ve nedeni, tavan, tutulan vites. |
| `/vites tavan` | Mevcut tavanı söyler. |
| `/vites tavan <haiku\|sonnet\|opus\|fable\|yok>` | Otomatik seçimin çıkabileceği en üst hattı ayarlar. Varsayılan `opus`. Oturumlar arası kalıcı. |
| `/vites günlük [n]` | Son n seçimi listeler, en yenisi üstte (varsayılan 10, en çok 500). |
| `/vites rapor [bugün\|hafta\|ay\|tümü]` | Tahmini maliyet ve tasarruf (varsayılan `hafta` = son 7 gün; `ay` = son 30 gün). |

Argümanlar Türkçe harf farkı gözetmeden okunur: `ac`, `aç` ve İngilizce `on` aynı şeydir; `gunluk`, `tumu`, `hepsi` de geçer.

## Prompt'un üstündeki blok

Prompt'un hemen üstünde ana döngünün ve çalışan her alt ajanın o an hangi modelde, hangi eforda olduğu ve hangi dosya ya da klasörle uğraştığı görünür. Efor olarak Vites'in isteğe gerçekten verdiği değer yazılır (kendi seçimini yazdıysa onu, yazmadıysa motorun getirdiğini):

```
● Ana       Opus 5.5 · yüksek · 3. vites › src/hooks/register.tsx
↳ Tarama    Haiku 5.5 · düşük › src
```

- Ana satır ilk istekten sonra hep görünür. `N. vites` yalnızca Vites açıkken ve bir seçim yapılmışsa yazılır. `› hedef` yalnızca bir dosya aracı (Read, Edit, Write, NotebookEdit, Glob, Grep) çağrılmışsa yazılır; Bash hedefi siler. Yeni bir turun ilk isteği eski hedefi siler.
- Alt ajan satırı yalnızca ajan beklemede, çalışırken ya da yanıt beklerken görünür; bitenin kaydı silinir. Etiket ajanın adı, yoksa açıklaması, yoksa türüdür.
- Model adı kimlikten okunur: `claude-opus-5-5[1m]` → `Opus 5.5`, `opus` → `Opus`. Efor modelde yoksa `varsayılan` yazar.
- Hedef oturumun klasörüne göre kısa yazılır; klasör dışındaysa olduğu gibi, en çok yaklaşık 40 karakter (soldan `…` ile kesilir).
- Renkler temanın anahtarlarından gelir (`claude`, `suggestion`, `text`, `inactive`), sabit renk yoktur. Bir anket açıkken blok çekilir.

Önceki sürümün prompt altına sabitlediği `3. vites · opus · yüksek` satırı kaldırıldı; yeni oturumda eski sabitleme temizlenir.

## Nasıl seçer

1. Prompt yazıldığında kurulumundaki en küçük model (haiku) onu okur ve iki kelimeyle cevap verir: seviye, sonra efor. Çağrı 4 saniyede zaman aşımına uğrar; cevap gelmezse kelime kuralları (İngilizce ve Türkçe) tahmin eder.
2. Seviye vitesi ve model hattını belirler:

   | Vites | Seviye | Model hattı | Varsayılan efor |
   | --- | --- | --- | --- |
   | 1 | small | haiku | düşük |
   | 2 | everyday | sonnet | orta |
   | 3 | strong | opus | yüksek |
   | 4 | strongest | fable | çok yüksek |

   Model, kurulumun sunduğu seçenekler içinde hat adıyla eşlenir; yeni sürümler kod değişmeden çalışır. Bir hat kurulumda yoksa bir alt hatta iner; altı da yoksa bir üst hatta çıkar.
3. Prompt'ta efor adı geçiyorsa ("ultrathink", "max effort", "yüksek efor") sınıflandırıcının eforunu ezer ve o prompt için tutulmaz.
4. Tavan ve geç vites düşürme uygulanır (aşağıda).
5. Model Claude Code'un kendi `model` ayarıyla değişir. Efor her istekle gönderilir (ana oturum ve alt ajanlar), ayarlara yazılmaz. Alt ajanlar kendi modelini korur.

Şunlara dokunmaz: slash komutları, Claude çalışırken gönderilen mesajlar, "evet", "devam et" gibi kısa cevaplar (etiketli kısa cevap hariç).

### Maliyet tavanı

Otomatik seçim tavanın üstüne çıkmaz; varsayılan tavan `opus`. Tavana takılan seçimde efor sınıflandırmanın verdiği değerde kalır (örneğin strongest/çok yüksek → opus/çok yüksek). Takılma günlüğe ve `/vites durum`'a "tavana takıldı" olarak yazılır. Etiketle yapılan seçim tavanı aşabilir.

### Geç vites düşürme

Oturum içinde bir "tutulan vites" vardır. Yeni seçim tutulandan yüksek veya eşitse hemen o vitese geçilir. Düşükse model değişmez, hafif seçim sayılır; üst üste 3. hafif seçimde (ilk ikisi tutulan viteste çalışır) bu üçünün en yükseğine düşülür. Araya daha güçlü bir seçim girerse sayaç sıfırlanır. Böylece görev ortasındaki "şimdi şu dosyaya da bak" gibi kısa bir takip modeli düşürmez ve prompt önbelleği korunur.

Efor da modelle birlikte tutulur: aynı viteste daha yüksek efor hemen alınır, daha düşüğü tutulur ve modelle birlikte düşer. Sebebi: efor değişikliği de prompt önbelleğini bozar.

Tutulan vites oturum başında ve `/vites kapat` → `/vites aç` sonrası sıfırlanır. Tavan oturum ortasında düşürülürse tutulan vites bir sonraki prompt'ta yeni tavana iner (etiketle takılan vites hariç; o kendi düşene kadar bekler).

### `#etiket` ile seçim

Prompt'un başına yazılan etiketler o prompt için vitesi elle seçer:

| Etiket | Anlamı |
| --- | --- |
| `#haiku` `#sonnet` `#opus` `#fable` | Model hattı. Vitesi oraya takar, yukarı da aşağı da; tavanı aşabilir. Haiku sınıflandırması çağrılmaz. |
| `#düşük` `#orta` `#yüksek` `#çokyüksek` `#maks` | Efor. Tek başına yazılırsa model için sınıflandırıcı normal çalışır, efor sabitlenir. |
| `#hızlı` | `#haiku` + `#düşük` kısayolu. |

Kurallar:

- Etiketler birleştirilebilir: `#opus #maks şu modülü yeniden yaz`.
- ASCII yazım da geçer: `#dusuk`, `#yuksek`, `#cokyuksek`, `#hizli`. Büyük/küçük harf fark etmez.
- Yalnızca prompt'un başındaki etiketler okunur; ilk etiket olmayan kelimede okuma durur. `merhaba #opus` etiket değildir. `#sonnet14` ve `#maks2` de etiket değildir.
- Model etiketi tutulan vitesi oraya ayarlar ve sayacı sıfırlar; sonrası normal geç düşürme kuralıyla yürür. `#fable <büyük iş>` ardından gelen ilk iki hafif prompt fable'da kalır, üçüncüde düşülür.
- Etiketler modele giden metinden çıkarılır. Prompt yalnızca etiketten oluşuyorsa olduğu gibi gider (boş prompt reddedilir).
- Etiketler yalnızca Vites açıkken işlenir; kapalıyken düz metin olarak modele gider ve model değişmez.
- Etiketle yapılan model değişimi Vites'i kapatmaz.

## Senin seçimin her zaman kazanır

`/model` ile modeli ya da `/effort` ile eforu elle değiştirirsen Vites kendini kapatır ve seçtiğini korur; bunu bir toast ile söyler. `/effort` menüsünü açıp vazgeçersen açık kalır. Komutla veya çiple kapatınca açmadan önceki model geri gelir. Kuruluşun modeli kilitlediyse Vites kapalı kalır ve bunu söyler.

`/compact` sonrası veya başka bir pencereden değişen model Vites'i kapatmaz; bir sonraki prompt'ta yeniden seçer.

## Seçim günlüğü

Her işlenen prompt için bir kayıt tutulur: zaman, prompt'un ilk 120 karakteri, kaynak (sınıflandırıcı, kelime kuralı, etiket), ham seviye/efor, uygulanan vites/model/efor ve işaretler (tavana takıldı, vites tutuldu, düştü, etiketli). Son 500 kayıt saklanır; eskisi silinir. `/vites günlük 5` son 5'i gösterir.

## Tasarruf raporu

Vites açıkken her isteğin token sayıları (girdi, çıktı, önbellek okuma, önbellek yazma) gün × kaynak (ana döngü / alt ajan / sınıflandırıcı) × model hattı bazında toplanır. Tek tek istekler saklanmaz. Vites kapalıyken sayılmaz.

Rapor iki tarafı karşılaştırır:

- **Vites ile:** ana döngü + alt ajanlar + sınıflandırıcı çağrıları, gerçek modellerin fiyatıyla.
- **Vites olmasaydı:** ana döngü token'ları o gün Vites açılmadan önceki modelin hattıyla fiyatlanır (hat bilinmiyorsa, örneğin "Default", opus sayılır); alt ajanlar gerçek fiyatıyla (Vites onların modelini değiştirmez); sınıflandırıcı yok.

Rakamlar **tahmindir**: API liste fiyatlarıyla hesaplanır (fiyat tarihi kodda yazılıdır ve raporda görünür). Abonelik (Pro/Max) kullanıyorsan bu para değil, kullanım limiti karşılığıdır. Farklı bir model farklı sayıda token üretirdi. Haiku, uzun bağlam (100K token üstü) tarifesiyle fiyatlanır çünkü Claude Code oturumları genelde bu sınırı aşar; bu yüzden gösterilen tasarruf bir miktar düşük çıkabilir. Bu uyarılar her raporun altında yazar.

## Ne gönderir, ne saklar

Yazdığın her prompt'un ilk 6.000 karakteri, yalnızca sınıflandırmak için, kurulumundaki en küçük modele gider. Normal Claude Code oturumunu ve hesabını kullanır; başka bir servis yoktur.

Değiştirdiği `model` ayarı dışında sakladıkları: açık/kapalı durumu, açmadan önceki model, son uygulanan model ve efor, son seçim (yeni oturumun ilk istekleri de o eforla gitsin diye; Vites kapanınca silinir), tavan, tutulan vites, seçim günlüğü (her işlenen prompt'un ilk 120 karakteriyle) ve günlük token toplamları. Hepsi Claude Code'un eklenti deposunda, yalnızca bu makinede kalır. Üstteki bloğun kayıtları (hangi döngü hangi modelde, hangi dosyada) yalnızca bellekte tutulur, hiçbir yere yazılmaz.

## Geliştirme

Build adımı ve bağımlılık yok. Tipleri ve testleri Claude Code'un kendisi çalıştırır:

```
claude plugin validate vites
claude plugin test vites
```

Testler `claude-code/testing` modülünü kullanır; bu modül yalnızca `claude plugin test` altında vardır, `node` ve `bun test` çalıştırmaz.

| Dosya | İş |
| --- | --- |
| `vites/hooks/hooks.json` | Tek modülü (`register.tsx`) bildirir. |
| `vites/hooks/register.tsx` | Hook'lar, `/vites` komutu, alt bar çipi, prompt üstü blok. Motorla konuşan tek dosya. |
| `vites/hooks/display.ts` | Blok için saf fonksiyonlar: model adı, hedef kısaltma, araç çağrısından hedef, döngü kayıtları, satırlar. |
| `vites/hooks/logic.ts` | Saf fonksiyonlar: sınıflandırıcı cevabını okuma, kelime kuralları (İngilizce ve Türkçe), kısa cevap tespiti, model eşleme, vites numarası ve Türkçe efor adları. |
| `vites/hooks/gear.ts` | `#etiket` okuma, tavan, geç vites düşürme (tutulan vites ve sayaç). |
| `vites/hooks/journal.ts` | Seçim günlüğü: kayıt şekli, 500 sınırı, 120 karakter kesiti, listeleme. |
| `vites/hooks/usage.ts` | Token toplamları: gün × kaynak × hat defteri, karşılaştırma hattı. |
| `vites/hooks/pricing.ts` | Hat başına fiyat tablosu ve fiyat tarihi. |
| `vites/hooks/report.ts` | Dönem seçimi, rapor hesabı ve Türkçe rapor metni. |
| `vites/hooks/vites.test.ts` | `logic.ts` testleri ve mock motorla uçtan uca testler. |
| `vites/hooks/gear.test.ts` | Etiket, tavan ve vites düşürme testleri. |
| `vites/hooks/records.test.ts` | Günlük, token defteri, fiyat ve rapor testleri. |
| `vites/hooks/display.test.ts` | Model adı, hedef, kayıt ve satır testleri. |
| `vites/types/index.d.ts` | Eklentinin kendi tipleri ve `$.state` şeması. |

Tasarım dokümanı: `docs/superpowers/specs/2026-11-01-vites-design.md`.

## Lisans

MIT. Bkz. [LICENSE](LICENSE).
