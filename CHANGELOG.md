# تغییرات

## 0.2.0

- تبدیل فازم به PWA نصب‌شونده: افزودن `manifest.json`، `service-worker.js` و آیکون‌های اپ (192/512، معمولی و maskable).
- سرویس‌ورکر فقط پوستهٔ استاتیک (HTML/CSS/JS/آیکون) را کش می‌کند؛ مسیرهای `/api/*` و `/f/*` همیشه از شبکه خوانده می‌شوند تا گفت‌وگو و تصویرها خصوصی/تازه بمانند.
- بارگذاری فونت وزیرمتن از CDN (jsdelivr) و گسترش CSP سرور برای اجازهٔ `style-src`/`font-src` از `cdn.jsdelivr.net`.
- افزودن متادیتای پکیج (description، license، repository)، CI پایه (`node --test` روی هر push/PR) و قالب Pull Request.

## 0.1.0

- راه‌اندازی اولیهٔ MVP فازم: سرور Node بدون وابستگی خارجی، چت فاز با AvalAI، ذخیرهٔ نشست در `data/db.json`، تولید تصویر SVG/AI و صفحهٔ اشتراک عمومی `f/:slug`.
