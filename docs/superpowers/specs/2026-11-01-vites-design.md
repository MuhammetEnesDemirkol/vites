# Vites — Tasarım Dokümanı

Tarih: 2026-11-01 · Sahip: Muhammet Enes Demirkol

## 1. Amaç ve neden

Vites, Claude Code'da her prompt için modeli ve düşünme eforunu otomatik seçen, Demirkol'a ait bir eklenti. Temeli Model Gear 0.2.3 (MIT, Muhammad Moussa, github.com/muhamoussa7/claude-model-gear). O eklenti şu an kurulu, çalışıyor ve bugün yerel kopyasına Türkçe yedek kelime desteği eklendi (36/36 test geçiyor).

Neden kendi eklentimiz:
- Başkasının eklentisinde yapılan değişiklik her güncellemede silinir; kalıcı olması için kaynağın bizde olması gerek.
- Türkçe kullanan biri için arayüz ve kurallar Türkçe olmalı.
- Orijinalde iki maliyet zayıflığı var:
  1. Her prompt'u tek başına sınıflandırıyor; görev ortasındaki kısa bir takip mesajı ("şimdi şu dosyaya da bak") küçük işe düşüp modeli haiku'ya indirebiliyor.
  2. Prompt önbelleği modele özel. Sık model değişimi uzun bağlamın yeni model için yeniden yazılmasına (ücretli cache write) yol açıyor; vites değiştirmek tasarruftan fazlasını yiyebilir.
- İleride GitHub'a ve portfolyoya taşınacak bir ürün.

Başarı: Kullanıcı Vites'i açık unutur, görev ortasında model kendiliğinden düşmez, maliyetin nereye gittiğini `/vites rapor` ile görür, gerektiğinde tek prompt için vitesi elle seçer.

## 2. Hedefler (ilk sürüm, v1.0.0)

1. **Model Gear ile işlev eşitliği** — aşağıdaki davranışlar aynen korunur:
   - prompt yazıldığında en küçük modele (haiku) "seviye effort" sorulması, 4 sn zaman aşımı, olmazsa kelime kurallarıyla tahmin;
   - seviye → model hattı: small→haiku, everyday→sonnet, strong→opus, strongest→fable; kurulumda olmayan hat için bir alta inme;
   - prompt'ta adı geçen effort'un ("ultrathink", "max effort", "yüksek efor") her şeyi ezmesi;
   - effort'un `turn.step` ile istek başına gönderilmesi (ana döngü ve alt ajanlar), ayarlara kaydedilmemesi;
   - slash komutları, çalışırken gönderilen mesajlar ve kısa onay cevaplarının atlanması;
   - elle `/model` veya `/effort` yapılınca kendini kapatıp kullanıcının seçimini koruması;
   - kuruluş modeli kilitlediyse kapalı kalması;
   - açılırken önceki modeli kaydedip kapanırken geri koyması;
   - her yeni oturumda kendiliğinden açılması (orijinal davranış, korunuyor);
   - alt bardaki aç/kapa çipi ve prompt altındaki durum satırı.
   - Bugün eklenen Türkçe yedek kurallar (`fold()`, Türkçe kök kalıpları, Türkçe onay kelimeleri, Türkçe effort ifadeleri) dahil.
2. **Türkçe arayüz** — tüm komut cevapları, toast'lar, çip ve durum satırı Türkçe.
3. **Maliyet tavanı** — otomatik seçimin çıkabileceği en üst hat.
4. **Geç vites düşürme** — yükselme anında, düşme gecikmeli.
5. **Tek seferlik ezme** — prompt başındaki etiketle tek prompt için vites seçimi.
6. **Seçim günlüğü** — her seçim nedeniyle kaydedilir.
7. **Tasarruf raporu** — token kullanımından tahmini maliyet ve karşılaştırma.

## 3. Hedef dışı (v1'de yok)

- Alt ajanların modelini seçmek (alt ajanlar kendi modelini korur, sadece effort alır — orijinaldeki gibi).
- Taban model, proje/klasör bazlı profil, günlük bütçe, `/vites yükselt|düşür` komutları, geri bildirimden öğrenme.
- GitHub'a yayın (sonraki adım; v1 yerel).
- Model Gear'ın kayıtlı durumunu (store) taşımak.

## 4. Anti-hedefler (çalışsa bile başarısızlık sayılır)

- Eklentideki bir hatanın prompt'u engellemesi veya geciktirmesi (4 sn sınıflandırma sınırı dışında).
- Vites açıkken, hiç kullanmamaktan daha pahalı olması (örn. sürekli model değiştirip önbelleği yakması).
- Kullanıcının elle yaptığı seçimi sessizce ezmesi.
- Raporun tahmini rakamları kesin fatura gibi göstermesi.
- Prompt içeriğinin makine dışına (sınıflandırma çağrısı hariç) çıkması.

## 5. Kısıtlar

- Bağımlılık yok, build adımı yok. Sadece Claude Code host API'si (`claude-code` modülü: `on(...)` hook'ları, `$.config`, `$.store`, `$.state` atom'ları, `$.model.complete`, `$.ui.status/toast/resolve`, `$.command.register`, `$.settings.read`).
- Tip kontrolü ve testler: `claude plugin validate <dizin>` ve `claude plugin test <dizin>`. Testler `claude-code/testing` mock motorunu kullanır; node/bun ile çalışmaz.
- `.claude-plugin/types/` Claude Code tarafından üretilir, commit edilmez (.gitignore).
- Her hook `try/catch` ile sarılır ve `next(e)`'ye düşer; her `on(...)` `.catch(...)` ile biter (orijinal kural).
- `atom({ plugin, key })` literalleri `types/index.d.ts` içindeki `PluginState` genişletmesiyle eşleşmeli; plugin adı `vites`.
- Platform: Windows 11, Claude Code CLI. Kurulum yerel dizin marketplace'i ile.
- MIT lisansı: LICENSE'ta orijinal telif satırı kalır.
- Eski `model-gear@claude-model-gear` kaldırılmadan Vites açılmaz (ikisi aynı `model` ayarı için yarışır).

## 6. Kullanıcının verdiği kararlar

- Ad: **Vites**. Komut: `/vites aç | kapat | durum` (+ aşağıdaki alt komutlar). Arayüz Türkçe.
- Dağıtım: önce yerel, sonra GitHub.
- v1 özellikleri: maliyet tavanı, Türkçe arayüz, seçim günlüğü, geç vites düşürme, tek seferlik ezme, tasarruf raporu.

## 7. Özellik ayrıntıları

### 7.1 Komutlar

| Komut | İş |
|---|---|
| `/vites` veya `/vites durum` | açık/kapalı, şu anki model, son seçim ve nedeni, tavan, tutulan vites |
| `/vites aç` / `/vites kapat` | aç (önceki modeli kaydet) / kapat (önceki modeli geri koy) |
| `/vites tavan <haiku\|sonnet\|opus\|fable\|yok>` | tavanı ayarla; argümansız: mevcut tavanı söyle |
| `/vites günlük [n]` | son n seçimi listele (varsayılan 10) |
| `/vites rapor [bugün\|hafta\|ay\|tümü]` | tasarruf raporu (varsayılan: hafta) |

Argümanlar `fold()` ile okunur: `ac`, `dusur`, `gunluk`, İngilizce `on/off/status` da kabul edilir.

### 7.2 Vites numarası (benim kararım)
Seviyeler kullanıcıya vites olarak gösterilir: 1=haiku, 2=sonnet, 3=opus, 4=fable. Durum satırı örneği: `3. vites · opus · yüksek`. Çip: `Vites: Açık` / dar terminalde `V: Açık`.

### 7.3 Maliyet tavanı
- `$.store`'da saklanır, oturumlar arası kalıcı. **Varsayılan: opus** (benim kararım — kullanıcının verdiği örnekle aynı; fable sadece istenirse).
- Sadece otomatik seçimi sınırlar. Tek seferlik ezme tavanı aşabilir (kullanıcı açıkça istedi).
- Tavana takılan seçimde effort, sınıflandırmanın verdiği değerde kalır (örn. strongest/xhigh → opus/xhigh) (benim kararım).
- Tavana takılma günlüğe ve `/vites durum`'a yazılır.

### 7.4 Geç vites düşürme
- Oturum içinde bir "tutulan vites" (seviye) vardır.
- Yeni seçim tutulan vitesten **yüksek veya eşitse**: hemen o vitese geç, hafif sayacını sıfırla.
- **Düşükse**: model değişmez, hafif sayacı +1. Sayaç **3**'e ulaşınca (sabit, benim kararım) bu 3 hafif seçimin en yükseğine düşülür ve sayaç sıfırlanır.
- Kısa onay cevapları ve çalışırken gönderilen mesajlar hiç işlenmez: model o an neyse öyle kalır, sayaç değişmez.
- Hold, tavan uygulandıktan sonraki seviyeyi tutar (benim kararım). Tavan oturum ortasında düşürülürse tutulan vites bir sonraki işlenen prompt'ta yeni tavana iner.
- Sıfırlanma: oturum başı, Vites kapat/aç. `/compact` sonrası sıfırlamak builder'ın kararı (bağlam zaten yeniden yazılıyor).
- **Effort:** Varsayılan olarak effort da modelle birlikte tutulur ve aynı anda düşer. Builder, `claude-api` skill'inden effort/thinking değişiminin prompt önbelleğini bozup bozmadığını doğrular; bozmuyorsa effort her prompt'un kendi sınıflandırmasını izler. Seçilen yol koda yorum olarak yazılır.

### 7.5 Tek seferlik ezme
- Prompt'un başındaki etiket(ler): model `#haiku #sonnet #opus #fable`, effort `#düşük #orta #yüksek #çokyüksek #maks` (ASCII yazımları da: `#dusuk #yuksek #cokyuksek`), kısayol `#hızlı`/`#hizli` = haiku + düşük (benim kararım).
- Model ve effort etiketi birlikte kullanılabilir (`#opus #maks ...`).
- **Model etiketi vitesi oraya takar** (kullanıcı kararı): tutulan vites doğrudan etiketteki hatta ayarlanır (yukarı da aşağı da), sayaç sıfırlanır; sonrası normal geç düşürme kuralıyla yürür. Böylece `#fable <büyük iş>` ardından gelen "şimdi şu dosyaya da bak" modeli düşürmez.
- Etiketle takılan vites tavanı aşabilir ve otomatik düşene kadar tavan ona uygulanmaz (kullanıcı vitesi kendisi seçti). Otomatik bir yükselme ise yine tavanla sınırlanır.
- Model etiketi varsa haiku sınıflandırması çağrılmaz (gereksiz maliyet).
- **Sadece effort etiketi** (veya prompt'ta adı geçen effort: "ultrathink", "yüksek efor") varsa: effort sabitlenir; model için sınıflandırıcı normal çalışır ve seçim normal hold/sayaç mantığından geçer (benim kararım).
- Vites kapalıyken etiketler işlenmez, düz metin olarak modele gider; elle seçilen modele dokunulmaz (benim kararım).
- Etiket, `prompt.submit` metni değiştirmeye izin veriyorsa modele giden metinden çıkarılır; izin vermiyorsa bırakılır (zararsız). Builder doğrular.
- Bu model değişimi eklentinin kendi `config.set`'i olduğu için "elle seçim → kapan" kuralını tetiklememeli.

### 7.6 Seçim günlüğü
- Her işlenen prompt için bir kayıt: zaman, prompt'un ilk 120 karakteri (benim kararım; ayarlamaya yetecek kadar, makinede kalır), kaynak (`sınıflandırıcı | kelime-kuralı | ezme`), ham seviye/effort, uygulanan model/effort, işaretler (`tavana takıldı`, `vites tutuldu`, `düştü`).
- Saklama: `$.store`'da son 500 kayıt, eskisi silinir (benim kararım). Host API dosyaya yazmaya izin veriyorsa ek olarak `~/.claude/vites/gunluk.jsonl` yazmak builder'ın kararı.
- `/vites kapat` günlüğü silmez.

### 7.7 Tasarruf raporu
- Veri: `turn.step` sonucundaki `usage` (input, output, cache read, cache write) ve istek modeli. Ana döngü + alt ajanlar sayılır; ayırt edilebiliyorsa ayrı gösterilir. Sınıflandırma çağrılarının kendi `usage`'ı da sayılır (dürüst muhasebe).
- Sadece Vites açıkken kaydedilir (benim kararım).
- Saklama: **gün × kaynak (ana / alt-ajan / sınıflandırıcı) × model hattı** bazında toplamlar `$.store`'da (tek tek istek değil), artı **her gün için karşılaştırma hattı** (o gün geçerli `previous`'un hattı; gün içinde değişirse ilk geçerli değer) (benim kararım). Toplamlar sonradan yeniden kurulamayacağı için şema baştan böyle.
- Fiyat tablosu: hat başına input/output/cache-write/cache-read ($/MTok) ve **fiyat tarihi**, `logic` tarafında tek bir sabit tabloda. Değerler build sırasında `claude-api` skill'inden alınır, ezberden yazılmaz.
- Rapor içeriği: dönem, model başına token ve tahmini maliyet, toplam; **karşılaştırma** (benim kararım):
  - Vites tarafı = ana + alt-ajan + sınıflandırıcı, gerçek modellerin fiyatıyla.
  - "Vites olmasaydı" tarafı = ana döngü token'ları o günün karşılaştırma hattıyla fiyatlanır + alt-ajanlar gerçek fiyatlarıyla (Vites onların modelini değiştirmez) + sınıflandırıcı yok.
  - `previous` bir hatta eşlenemiyorsa (örn. "Default") opus kullanılır.
  - Fark $ ve %. Dönem birden fazla karşılaştırma hattı içeriyorsa bu belirtilir.
- "hafta" = son 7 gün, "ay" = son 30 gün, yerel saat (benim kararım).
- Raporda açıkça yazar: "API liste fiyatlarıyla tahmindir; abonelik (Pro/Max) kullanıyorsan bu para değil kullanım limiti karşılığıdır; farklı model farklı token sayısı üretirdi; fiyat tarihi: …".

## 8. Paket yapısı ve kurulum

- Kaynak: `C:\Users\muham\.claude\mods\vites\` (git reposu)
  - `.claude-plugin/marketplace.json` — marketplace adı `demirkol` (benim kararım), tek eklenti `vites`, kaynak `./vites`
  - `vites/.claude-plugin/plugin.json` — ad `vites`, sürüm `1.0.0`, yazar Muhammet Enes Demirkol, `types`
  - `vites/hooks/` — `hooks.json`, `register.tsx`, saf fonksiyonlar (`logic.ts`; builder fiyat/günlük/rapor için ayrı dosyalara bölebilir), testler
  - `vites/types/index.d.ts`
  - `README.md` (Türkçe; "Model Gear'dan türetilmiştir" + link), `LICENSE` (orijinal satır + "Copyright (c) 2026 Muhammet Enes Demirkol"), `CLAUDE.md`, `.gitignore`
  - `docs/superpowers/specs/2026-11-01-vites-design.md` (bu doküman)
- Git: repo-yerel kimlik `Muhammet Enes Demirkol <enesdemirkol1903@gmail.com>` (global ayar değiştirilmez) (benim kararım).
- Kurulum sırası: `claude plugin marketplace add C:\Users\muham\.claude\mods\vites` → `claude plugin uninstall model-gear@claude-model-gear` → `claude plugin install vites@demirkol` → eski `claude-model-gear` marketplace'ini kaldır → yeni oturumda doğrula. Eski eklentinin model ayarı Vites açılmadan önce kullanıcının asıl modeline dönmüş olmalı.
- Proje takibi: Notion "🚀 Projeler" DB'de "Vites" sayfası (plan orada güncel tutulur).

## 9. Kabul kriterleri

- `claude plugin validate` ve `claude plugin test` geçer; orijinal 36 testin karşılıkları (Türkçe mesajlarla) + her yeni özellik için testler.
- Tavan: tavan opus iken strongest sınıflandırması opus seçer; `#fable` ezmesi fable seçer; `/vites tavan yok` sonrası strongest fable seçer.
- Geç düşürme: strong → small → small → aynı modelde kalır; 3. hafif seçimde düşer; arada strong gelirse sayaç sıfırlanır.
- Ezme: `#fable` → fable, tavan opus olsa bile; ardından gelen hafif prompt fable'da kalır, 3. hafif prompt'ta düşer; Vites kapanmaz; haiku çağrılmaz. `#yüksek` tek başına → sınıflandırıcı çağrılır, effort high. Vites kapalıyken `#opus` modeli değiştirmez.
- Rapor: alt-ajan token'ları iki tarafta aynı fiyatlanır; sınıflandırıcı maliyeti sadece Vites tarafında.
- Günlük: 501. kayıtta en eski silinir; `/vites günlük 5` son 5'i gösterir.
- Rapor: bilinen usage ve fiyatlarla hesap doğru; previous=sonnet iken karşılaştırma sonnet fiyatıyla; uyarı satırları görünür.
- Elle `/model` → Vites kapanır, Türkçe toast; `/vites kapat` → önceki model geri gelir.
- Gerçek oturumda: çip görünür, durum satırı `N. vites · model · effort` gösterir, bir Türkçe prompt beklenen vitese gider.

## 10. Builder'a bırakılanlar

Dosya bölümlemesi, store anahtar adları, Türkçe mesajların tam metni (kısa, ne olduğunu ve neyin değişmediğini söyleyen cümleler — orijinal üslup), test organizasyonu, etiketi metinden çıkarma yöntemi, `/compact` sonrası sıfırlama, dosya günlüğü, ana/alt ajan ayrımının gösterimi.
