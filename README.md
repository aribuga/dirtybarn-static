# Dirtybarn WooCommerce migrasyonu ve Astro ürün sitesi

Bu proje iki bağımsız ancak aynı ürün verisini kullanan bölüm içerir:

1. WooCommerce REST API’den ürünleri Markdown ve yerel medya dosyalarına aktaran
   Node.js migrasyon aracı.
2. Migrasyon çıktılarından tamamen statik ürün sayfaları oluşturan Astro sitesi.

Site arayüzü Astro üzerinde çalışan, prototipten uyarlanmış üretim Store/Journal
tasarımını kullanır. Ürün ve blog içerikleri gerçek migrasyon çıktılarından gelir;
Ürün ve Journal koleksiyonları kök dizindeki `.pages.yml` üzerinden Pages CMS ile
düzenlenebilir.

## Gereksinimler

- Node.js 20 veya üzeri
- npm
- Migrasyon çalıştırılacaksa ürünleri okuyabilen WooCommerce REST API anahtarları

Bağımlılıkları kurun:

```bash
npm install
```

## Astro sitesi

Geliştirme sunucusu:

```bash
npm run dev
```

Production build:

```bash
npm run build
```

Build çıktısını yerel olarak önizleme:

```bash
npm run preview
```

JavaScript testleri, ürün verisi ve duplicate permalink kontrolü, TypeScript ve
Astro kontrolleri:

```bash
npm run check
```

Site statik çıktı üretir; SSR veya deploy adapter’ı kullanılmaz.

### Pages CMS

Proje Pages CMS için hazırdır. `.pages.yml` şu içerik alanlarını tanımlar:

- `content/products/` altındaki ürünler
- `content/posts/` altındaki Journal yazıları
- `public/media/products/` altındaki ürün görselleri
- `public/media/posts/` altındaki Journal görselleri

Pages CMS doğrudan GitHub deposundaki Markdown ve medya dosyalarını düzenler; ayrı
bir içerik veritabanı oluşturmaz. Kullanmak için `https://app.pagescms.org/`
adresinde GitHub ile giriş yapın, Pages CMS GitHub App’i depo için yetkilendirin ve
bu depoyu seçin.

Yeni kayıt oluşturulabilir. Migrasyondan gelen URL bütünlüğünü korumak için mevcut
dosyaları CMS üzerinden yeniden adlandırma ve silme kapalıdır. Yayınlama veya domain
bağlama Pages CMS’in görevi değildir; GitHub deposu ayrıca seçilecek bir statik site
hosting hizmetine bağlanmalıdır.

### Ürün verisi ve URL’ler

Ürünlerin tek veri kaynağı:

```text
content/products/
```

Astro content collection bu klasörü doğrudan okur. Yalnızca
`status: "published"` olan ürünler halka açık sayfalarda görünür.

Ürün route’ları slug tahminiyle değil, her Markdown dosyasındaki gerçek
`permalink` alanıyla oluşturulur. Örneğin:

```text
/p/3d-lighter-mockup-5-scenes/
```

Build öncesinde eksik, geçersiz, `/p/` dışında veya duplicate permalink değerleri
kontrol edilir. Duplicate URL bulunduğunda build iki ürünün adını gösteren anlamlı
bir hatayla durur.

`excerpt` alanı kart özeti değil, tam ürün açıklamasıdır. Detay sayfasında açıklama
önceliği şöyledir:

1. `excerpt`
2. Markdown gövdesi
3. Boş durum metni

Kartlarda açıklama, kategori veya etiket gösterilmez.

Ürün görselleri `public/media/products/` altında kalır ve migrasyonun oluşturduğu
`/media/products/...` yolları değiştirilmeden kullanılır.

`gumroad_url` doluysa güvenli bir dış bağlantı olarak “Buy on Gumroad” butonu
gösterilir. Alan boş veya geçersizse bağlantı üretilmez; etkileşimsiz
“Available soon” durumu gösterilir.

### Ürün videoları

Migrasyon YouTube videolarını önce WooCommerce `meta_data` içindeki
`nm-featured-video-link` ve `_nm-featured-video-link` alanlarında, ardından ürün
sayfasındaki `#nm-featured-video-link` elementinde arar. Sonraki kaynaklar sırasıyla
`short_description`, `description` ve ürün sayfasındaki diğer YouTube bağlantılarıdır.

Bulunan videolar ürün frontmatter'ındaki `videos` alanına yazılır ve video kimliğine
göre tekilleştirilir. Ürün sayfasında ilk geçerli video, gömülü oynatıcı yerine yeni
sekmede açılan “Watch video” bağlantısı olarak gösterilir. Video kaynakları
`migration/reports/product-videos.json` dosyasında raporlanır.

### SEO site adresi

Canonical ve mutlak Open Graph URL’leri için isteğe bağlı olarak:

```env
PUBLIC_SITE_URL=https://example.com
```

değerini `.env` içinde tanımlayabilirsiniz. Değer yoksa build kırılmaz ve mutlak
canonical/OG URL etiketleri atlanır. Gerçek `.env` dosyasını Git’e eklemeyin.

### Statik sayfalar

Statik bilgi sayfaları `src/pages/` altında bulunur:

- `/about/`
- `/contact/`
- `/license/`
- `/privacy-policy/`
- `/404.html`

Bu statik sayfalar kod tabanlıdır; Pages CMS şu anda ürün ve Journal koleksiyonlarını
yönetir.

## WooCommerce migrasyonu

Gerçek `.env` dosyasında:

```env
WOOCOMMERCE_URL=https://your-site.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxx
WOOCOMMERCE_CURRENCY=USD
```

alanları bulunmalıdır. Anahtarlar yalnızca `.env` içinde tutulmalı; dosya commit
edilmemeli veya paylaşılmamalıdır.

Dosya yazmadan ilk üç ürünü kontrol edin:

```bash
npm run import:products -- --dry-run --limit 3
```

İlk üç ürünü aktarın:

```bash
npm run import:products -- --limit 3
```

Tam aktarım:

```bash
npm run import:products
```

Yalnızca çok satırlı açıklamaları ve YouTube video verilerini onarmak için:

```bash
npm run import:products -- --repair-content
```

Bu mod varsa önce `migration/raw/products.json` verisini kullanır; yalnızca ürün
frontmatter'ındaki `excerpt` ve `videos` alanlarını günceller. Fiyat, URL, görsel,
Gumroad ve diğer özel alanları korur. Yazmadan ilk üç ürünü denetlemek için
`npm run import:products -- --repair-content --dry-run --limit 3` kullanılabilir.

Mevcut görselleri de yeniden indirmeye izin vererek aktarım:

```bash
npm run import:products -- --force
```

Migrasyon çıktıları:

- Ürün Markdown dosyaları: `content/products/`
- Ürün görselleri: `public/media/products/`
- Ham API yedekleri: `migration/raw/`
- URL haritası: `migration/product-url-map.json`
- Raporlar: `migration/reports/`

İçerik onarım raporları:

- `migration/reports/content-repair-report.json`
- `migration/reports/youtube-videos-found.json`
- `migration/reports/youtube-page-scan-failures.json`
- `migration/reports/empty-descriptions.json`

Migrasyon tekrar çalıştırıldığında mevcut `gumroad_url` ve WooCommerce tarafından
yönetilmeyen özel frontmatter alanları korunur. API’den artık gelmeyen ürün
dosyaları otomatik silinmez.

## WordPress blog migrasyonu

Blog importer, ürün migrasyonundan bağımsız olarak WordPress REST API’deki yayınlanmış
yazıları Markdown ve yerel medya dosyalarına aktarır. `.env` içinde öncelikle
`WORDPRESS_URL`, bu alan yoksa aynı site için `WOOCOMMERCE_URL` kullanılır:

```env
WORDPRESS_URL=https://example.com
```

Public REST API açıksa kimlik doğrulaması gerekmez. Gereken kurulumlarda
`WORDPRESS_USERNAME` ve `WORDPRESS_APPLICATION_PASSWORD` birlikte tanımlanabilir;
bilgiler URL’ye, raporlara veya terminal çıktısına yazılmaz.

Komutlar:

```bash
npm run import:posts -- --dry-run --limit 3
npm run import:posts -- --limit 3

npm run import:posts -- --dry-run --slug digital-asset-management-methodology-for-2d-3d-artists-and-designers
npm run import:posts -- --slug digital-asset-management-methodology-for-2d-3d-artists-and-designers

npm run import:posts
npm run import:posts -- --force
```

Çıktılar:

- Yazı Markdown dosyaları: `content/posts/`
- Yazı görselleri: `public/media/posts/`
- Ham API yedeği: `migration/raw/posts.json`
- Import metadata: `migration/raw/post-import-metadata.json`
- URL haritası: `migration/post-url-map.json`
- Ayrıntılı raporlar: `migration/reports/post-*.json` ve ilgili blog raporları

Tekil yazı URL’leri API’nin gerçek `link` alanından alınır ve domain kökündeki mevcut
path korunur; importer `/blog/{slug}/` varsayımı yapmaz. Otomatik “See also”,
related/recommended ve paylaşım blokları gerçek yazı içeriğinden ayrıştırılarak
raporlanır. Bilinmeyen özel frontmatter alanları ve API’den artık gelmeyen yerel
yazı dosyaları korunur.

### Astro blog frontend’i

Aktarılan blog içerikleri `content/posts/` altında kalır ve Astro `posts` content
collection’ı tarafından okunur. Yalnızca `status: "published"` olan yazılar halka açık
sayfalarda gösterilir.

Blog listesi `/blog/` adresindedir. Tekil yazılar `/blog/{slug}/` altında yeniden
oluşturulmaz; eski WordPress kök URL’lerini korur. Her route, Markdown frontmatter’ındaki
`permalink` alanından üretilir. Örneğin:

```text
/digital-asset-management-methodology-for-2d-3d-artists-and-designers/
```

Markdown gövdesi tam yazı içeriğidir ve güvenli Astro Markdown işleme katmanından
geçirilerek render edilir. `excerpt` yalnızca liste kartı ve meta description için
kullanılır. Blog görselleri `public/media/posts/` altında kalır ve mevcut
`/media/posts/...` yolları değiştirilmez.

Build öncesinde permalinkler, duplicate URL’ler, rezerve/statik sayfa ve ürün route
çakışmaları, boş gövdeler ve eksik yerel medya dosyaları API isteği yapılmadan kontrol
edilir:

```bash
npm run validate:posts
```

Bu kontrol `npm run check` ve `npm run build` akışlarına da dahildir. Blog import
komutları kullanılmaya devam eder; frontend eklenmesi import sistemini değiştirmez.
Store ve Journal arayüzü ortak üretim temasını kullanır. Her iki içerik koleksiyonu
da Pages CMS yapılandırmasına bağlıdır.

## Henüz kapsamda olmayanlar

- RSS
- Gumroad API eşleştirmesi
- Sepet veya checkout
- Analytics ve cookie sistemi
- Deploy adapter’ları ve workflow’ları
