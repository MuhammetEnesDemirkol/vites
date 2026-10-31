# Vites

Her prompt için Claude Code modelini ve düşünme eforunu otomatik seçer. Hızlı işler küçük modele düşük eforla, zor işler elindeki en güçlü modele uzun düşünerek gider.

[Model Gear](https://github.com/muhamoussa7/claude-model-gear) 0.2.3'ten (MIT, Muhammad Moussa) türetilmiştir. Üzerine Türkçe arayüz ve Türkçe kelime kuralları, vites numarası, maliyet tavanı, geç vites düşürme, tek seferlik `#etiket` ezmesi, seçim günlüğü ve tasarruf raporu eklenir.

## Kurulum

Plugin destekli Claude Code gerekir. Model Gear kuruluysa önce kaldır; ikisi aynı `model` ayarı için yarışır.

```
claude plugin marketplace add C:\Users\muham\.claude\mods\vites
claude plugin uninstall model-gear@claude-model-gear
claude plugin install vites@demirkol
```

Yeni bir oturum aç. Vites her yeni oturumda kendiliğinden açılır; alt barda `Vites: Açık` çipi görünür. Çipe basınca açılıp kapanır.

## Kullanım

| Komut | Ne yapar |
| --- | --- |
| `/vites aç` | Açar, o anki modeli hatırlar. |
| `/vites kapat` | Kapatır, hatırladığı modeli geri koyar. |
| `/vites durum` veya `/vites` | Açık mı, hangi model, son seçim ve nedeni. |
| `/vites tavan <hat\|yok>` | Otomatik seçimin çıkabileceği en üst hat (varsayılan opus). |
| `/vites günlük [n]` | Son n seçim (varsayılan 10). |
| `/vites rapor [bugün\|hafta\|ay\|tümü]` | Tahmini maliyet ve tasarruf (varsayılan hafta). |

Argümanlar Türkçe harf farkı gözetmeden okunur: `ac`, `aç` ve İngilizce `on` aynı şeydir. `tavan`, `günlük` ve `rapor` sonraki sürümde eklenir.

Her prompt'tan sonra prompt'un altında gittiği vites, model ve efor yazar, örneğin `3. vites · opus · yüksek`.

## Nasıl seçer

1. Prompt yazıldığında küçük bir model (haiku) onu okur ve iki kelimeyle cevap verir: seviye, sonra efor. Çağrı 4 saniyede zaman aşımına uğrar; cevap gelmezse kelime kuralları (İngilizce ve Türkçe) tahmin eder.
2. Seviye vitesi ve model hattını belirler:

   | Vites | Seviye | Model hattı | Varsayılan efor |
   | --- | --- | --- | --- |
   | 1 | small | haiku | düşük |
   | 2 | everyday | sonnet | orta |
   | 3 | strong | opus | yüksek |
   | 4 | strongest | fable | çok yüksek |

   Model, kurulumun sunduğu seçenekler içinde hat adıyla eşlenir; yeni sürümler kod değişmeden çalışır. Bir seviye için model yoksa bir alt hatta iner.
3. Prompt'ta efor adı geçiyorsa ("ultrathink", "max effort", "yüksek efor") sınıflandırıcıyı ezer.
4. Model Claude Code'un kendi `model` ayarıyla değişir. Efor her istekle gönderilir (ana oturum ve alt ajanlar), ayarlara yazılmaz. Alt ajanlar kendi modelini korur.

Şunlara dokunmaz: slash komutları, Claude çalışırken gönderilen mesajlar, "evet", "devam et" gibi kısa cevaplar.

## Senin seçimin her zaman kazanır

`/model` ile modeli ya da `/effort` ile eforu elle değiştirirsen Vites kendini kapatır ve seçtiğini korur. Komutla veya çiple kapatınca açmadan önceki model geri gelir. Kuruluşun modeli kilitlediyse Vites kapalı kalır ve bunu söyler.

## Ne gönderir

Yazdığın her prompt'un ilk 6.000 karakteri, yalnızca sınıflandırmak için, kurulumundaki en küçük modele gider. Normal Claude Code oturumunu ve hesabını kullanır; başka bir servis yoktur. Değiştirdiği `model` ayarı dışında sakladığı şey kendi açık/kapalı durumu, son seçim ve (sonraki sürümde) seçim günlüğü ile token toplamlarıdır; hepsi makinede kalır.

## Geliştirme

Build adımı ve bağımlılık yok. Tipleri ve testleri Claude Code'un kendisi çalıştırır:

```
claude plugin validate vites
claude plugin test vites
```

Testler `claude-code/testing` modülünü kullanır; bu modül yalnızca `claude plugin test` altında vardır, `node` ve `bun test` çalıştırmaz.

| Dosya | İş |
| --- | --- |
| `vites/hooks/register.tsx` | Hook'lar, komut ve alt bar çipi. |
| `vites/hooks/logic.ts` | Saf fonksiyonlar: cevap okuma, kelime kuralları, etiketler. |
| `vites/hooks/vites.test.ts` | İkisinin testleri, mock motorla. |
| `vites/types/index.d.ts` | Eklentinin kendi tipleri ve kayıtlı durumu. |

Tasarım dokümanı: `docs/superpowers/specs/2026-11-01-vites-design.md`.

## Lisans

MIT. Bkz. [LICENSE](LICENSE).
