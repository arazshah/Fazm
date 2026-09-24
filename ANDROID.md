# انتشار فازم به‌صورت اپ اندروید (TWA)

فازم یک PWA است (`public/manifest.json` + `public/service-worker.js`). به‌جای نوشتن اپ جدا،
از **Trusted Web Activity (TWA)** استفاده می‌کنیم: یک پوستهٔ نازک اندرویدی که همان سایت را
داخل یک Chrome بدون نوار آدرس نشان می‌دهد و در Play Store قابل انتشار است.

## چیزهایی که همین‌جا آماده شده

- `android/twa-manifest.json`: تنظیمات کامل پروژهٔ TWA (package id، رنگ‌ها، آیکون‌ها، نسخه).
- `public/.well-known/assetlinks.json`: فایل تأیید مالکیت دامنه برای اندروید (Digital Asset Links)، از قبل با اثر انگشت کلید امضا پر شده.
- یک کلید امضای release (`fazm-release.keystore`) که **جدا از این مخزن** برایت ارسال شده؛ رمزش هم در فایل جدای دیگری است.

مقادیر ثابت‌شده:

- **Package ID**: `ir.fazm.twa`
- **کلید امضا (alias)**: `fazm`
- **اثر انگشت SHA-256**: `89:F4:0D:FD:97:39:B1:0E:B5:8D:DA:17:60:27:65:7B:97:A5:62:96:9A:3D:57:D6:F2:72:93:7A:36:0C:1C:F9`

## نگهداری کلید امضا (خیلی مهم)

فایل `fazm-release.keystore` و رمز آن را در یک جای امن (password manager یا حداقل دو بک‌آپ جدا)
نگه دار. اگر این کلید گم شود، دیگر هیچ‌وقت نمی‌توانی نسخهٔ جدید همین اپ را در Play Store
آپدیت کنی و باید با یک Package ID تازه از صفر شروع کنی. **این فایل را در گیت کامیت نکن**؛
`.gitignore` از قبل `android/*.keystore` را نادیده می‌گیرد.

## پیش‌نیاز build

این build نیاز به دانلود Android SDK از `dl.google.com` دارد که از داخل این نشست/کانتینر
در دسترس نبود، برای همین باید یکی از این دو مسیر را خودت کامل کنی:

### گزینهٔ ۱: Bubblewrap روی کامپیوتر خودت (کنترل کامل)

1. مطمئن شو آخرین نسخهٔ کد (همین `master`) روی `https://fazm.ir` دیپلوی شده — چون Bubblewrap
   آیکون‌ها و مانیفست را از روی دامنهٔ واقعی می‌خواند.
2. نصب:
   ```bash
   npm install -g @bubblewrap/cli
   ```
3. فایل `fazm-release.keystore` که برایت فرستادم را در پوشهٔ `android/` این مخزن قرار بده
   (کنار `twa-manifest.json`، دقیقاً با همین اسم).
4. داخل پوشهٔ `android/`:
   ```bash
   cd android
   bubblewrap build
   ```
   Bubblewrap اولین بار می‌پرسد JDK/Android SDK را نصب کند یا نه؛ بگذار خودش نصب کند
   (یا JDK 17 خودت را معرفی کن). سپس رمز `fazm-release.keystore` را که در فایل جدا
   برایت فرستادم وارد کن.
5. خروجی `app-release-bundle.aab` (برای Play Store) و/یا `app-release-signed.apk`
   (برای تست مستقیم روی گوشی) در همان پوشه ساخته می‌شود.

### گزینهٔ ۲: PWABuilder.com (بدون نصب چیزی، ساده‌تر)

1. برو به [pwabuilder.com](https://www.pwabuilder.com) و آدرس `https://fazm.ir` را بده.
2. تب Android را باز کن و گزینهٔ **Trusted Web Activity** را انتخاب کن.
3. Package ID را `ir.fazm.twa` بگذار تا با `assetlinks.json` از قبل آماده‌شده هم‌خوانی داشته باشد.
4. یک AAB دانلود می‌کنی که خودش امضا نشده؛ برای امضا کردنش با همان `fazm-release.keystore`:
   ```bash
   jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
     -keystore fazm-release.keystore app-release-unsigned.aab fazm
   ```

## تأیید مالکیت دامنه (Digital Asset Links)

بعد از دیپلوی، مطمئن شو این آدرس در دسترس و معتبر است (سرور از قبل مسیرش را سرو می‌کند):

```
https://fazm.ir/.well-known/assetlinks.json
```

با ابزار رسمی گوگل تست کن: https://developers.google.com/digital-asset-links/tools/generator

## انتشار در Play Console

1. یک حساب Google Play Console بساز (هزینهٔ یک‌بارهٔ ثبت‌نام دارد).
2. یک اپ جدید با همان Package ID (`ir.fazm.twa`) بساز.
3. فایل `.aab` امضا‌شده را در بخش Production یا Internal testing آپلود کن.
4. Store listing (توضیحات، اسکرین‌شات‌ها، آیکون ۵۱۲، سیاست حریم خصوصی) را تکمیل کن —
   فازم چون داده‌های حساس/احساسی جمع‌آوری می‌کند، سیاست حریم خصوصی الزامی است.

## آپدیت‌های بعدی

برای هر نسخهٔ جدید:

1. `appVersionCode` را در `android/twa-manifest.json` یک واحد زیاد کن و `appVersion` را آپدیت کن.
2. دوباره `bubblewrap build` را با همان `fazm-release.keystore` اجرا کن.
3. AAB جدید را در Play Console آپلود کن.
