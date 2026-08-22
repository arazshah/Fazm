# استقرار فازم روی Coolify

## تنظیم Application

1. در Coolify یک Application از مخزن GitHub بسازید.
2. Build Pack را روی `Dockerfile` قرار دهید.
3. در **Ports Exposes** مقدار `3000` را وارد کنید.
4. دامنه را `https://fazm.ir` تنظیم کنید.
5. Health Check را فعال نگه دارید؛ Dockerfile مسیر `/api/health` روی پورت داخلی `3000` را بررسی می‌کند.
6. یک Volume پایدار بسازید و Destination Path را `/app/data` قرار دهید. بدون این volume، گفت‌وگوها و تصاویر در redeploy از بین می‌روند.

نیازی به publish کردن پورت با `3000:3000` یا اتصال اپ به پورت ۸۰ میزبان نیست. Coolify Proxy ترافیک دامنه را به پورت داخلی ۳۰۰۰ کانتینر می‌فرستد.

### اگر پورت ۸۰ میزبان مشغول است

- اگر خود `coolify-proxy` پورت ۸۰ را گرفته، وضعیت طبیعی است و اپ با آن تداخل ندارد.
- اگر Nginx، Apache یا سرویس دیگری خارج از Coolify پورت ۸۰ را گرفته، proxy کولفای نمی‌تواند معمولاً HTTP و صدور/تمدید TLS را مدیریت کند. آن سرویس باید آزاد یا به‌عنوان reverse proxy خارجی با تنظیم آگاهانه استفاده شود. تغییر پورت داخلی فازم این تعارض میزبان را حل نمی‌کند.

## متغیرهای محیطی

این مقادیر را در بخش Environment Variables وارد کنید:

```env
AVALAI_API_KEY=...
AVALAI_BASE_URL=https://api.avalai.ir/v1
AVALAI_CHAT_MODEL=gpt-4o-mini
AVALAI_IMAGE_MODEL=gpt-image-1-mini
PUBLIC_BASE_URL=https://fazm.ir
HOST=0.0.0.0
PORT=3000
TRUST_PROXY=1
MAX_CONCURRENT_AI=4
NODE_ENV=production
```

کلید AvalAI را فقط به‌عنوان Runtime Variable ذخیره کنید و آن را وارد repository یا Build Variable نکنید.

## محدودیت منابع پیشنهادی برای شروع

- Memory limit: `512 MB`
- Memory reservation: `256 MB`
- CPU limit: `1` تا `2` هسته
- یک replica؛ ذخیره‌سازی JSON فعلی برای چند replica مناسب نیست.

## DNS

یک رکورد `A` برای `fazm.ir` به IP سرور و در صورت نیاز `CNAME` برای `www` به `fazm.ir` بسازید. سپس HTTPS و Redirect to non-www را در Coolify فعال کنید.

## Backup

از volume مسیر `/app/data` به‌صورت روزانه backup بگیرید. این مسیر شامل `db.json` و تصاویر تولیدشده است و دادهٔ خصوصی کاربران محسوب می‌شود.

## لایه‌های ضد سوءاستفاده

- سقف عمومی: ۱۸۰ درخواست در دقیقه برای هر IP.
- API: ۶۰ درخواست در دقیقه برای هر IP.
- ساخت نشست: ۸ نشست در ساعت برای هر IP.
- چت: ۱۲ پیام در ۱۰ دقیقه برای IP و ۸ پیام در ۱۰ دقیقه برای نشست.
- تصویر: ۶ تصویر در ساعت برای IP و ۳ تصویر در ساعت برای نشست.
- حداکثر درخواست AI هم‌زمان: ۴، و فقط یک درخواست هم‌زمان برای هر نشست.
- اعتبارسنجی Origin، محدودیت اندازهٔ body، secret مجزای مالک و headerهای امنیتی مرورگر.

این محدودیت‌ها جلوی مصرف ساده و ربات تک-IP را می‌گیرند. برای حملهٔ توزیع‌شده، Cloudflare Proxy/WAF را جلوی دامنه فعال و روی `/api/sessions`، مسیرهای `/chat` و `/image` rule جداگانه تعریف کنید. در صورت مشاهدهٔ abuse واقعی، Turnstile را فقط در شروع نشست اضافه کنید تا تجربهٔ عادی چت سنگین نشود.
