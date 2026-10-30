# خطای ۴۰۴ در نمایهٔ عمومی (`/@username`)

## نشانه‌ها

- صفحهٔ `/@username` و `/u/username` پاسخ `404` می‌دهند، در حالی که حساب وجود دارد و عمومی است.
- `GET /api/account/users/username` روی همان دامنه `200` و دادهٔ نمایه را برمی‌گرداند.
- ورود، `/profile` و بقیهٔ `/api/account/*` درست کار می‌کنند.
- در لاگ کانتینر `web` هیچ خطایی دیده نمی‌شود.

اگر API هم `404` داد، این مشکل نیست: حساب وجود ندارد یا نمایه‌اش خصوصی است.

## علت

`ACCOUNTS_API_URL` در برنامهٔ Next دو جا و در دو زمان متفاوت خوانده می‌شود:

| کجا | چه زمانی خوانده می‌شود | مقدار در ایمیج |
|---|---|---|
| rewrite مسیر `/api/account/*` در `next.config.js` | هنگام `next build` | `http://server:8787` از workflow در CI |
| صفحهٔ `/u/[username]` از طریق `src/utils/publicProfile.ts` | هنگام اجرا | از محیط کانتینر؛ در نبودش `http://127.0.0.1:8787` |

اگر این متغیر هنگام اجرا تنظیم نشده باشد، صفحه به `127.0.0.1:8787` درخواست می‌زند که خودِ کانتینر `web` است و سرویس حساب‌ها آنجا نیست. `getPublicProfile` در این حالت `null` برمی‌گرداند و صفحه `notFound()` را صدا می‌زند؛ پس قطع بودن ارتباط برای کاربر مثل «نمایه پیدا نشد» دیده می‌شود.

خطا در لاگ نمی‌آید، چون `logger` در `src/utils/logger.ts` در production چیزی چاپ نمی‌کند.

## تشخیص

روی سرور:

```bash
cd /opt/ganjoorak && docker compose exec web printenv ACCOUNTS_API_URL
```

باید `http://server:8787` چاپ شود. خروجی خالی یا مقدار دیگر یعنی همین مشکل.

## راه‌حل

### راه‌حل دائمی

`Dockerfile` حالا این مقدار را پیش‌فرض می‌گذارد:

```dockerfile
ENV ACCOUNTS_API_URL=http://server:8787
```

پس از push روی `v3` و تمام شدن workflow، ایمیج تازه را بگیرید:

```bash
cd /opt/ganjoorak && docker compose pull web && docker compose up -d web
```

مقدار `environment` در compose این پیش‌فرض را بازنویسی می‌کند؛ اگر آنجا مقدار اشتباهی ثبت شده، باید اصلاح یا حذف شود.

### راه‌حل فوری، بدون ساخت ایمیج تازه

در `/opt/ganjoorak/compose.yml` زیر `web.environment` اضافه کنید:

```yaml
ACCOUNTS_API_URL: http://server:8787
```

سپس:

```bash
cd /opt/ganjoorak && docker compose up -d web
```

## بررسی پس از رفع

هر دو باید `200` برگردانند (به‌جای `example.com` و `username` دامنه و یک حساب عمومی واقعی را بگذارید):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/api/account/users/username
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/@username
```

## بازتولید محلی

1. برنامه را با `ACCOUNTS_API_URL` برابر نشانی سرویس حساب‌ها بسازید (`npm run build`).
2. `.next/standalone/server.js` را یک بار بدون این متغیر و یک بار با آن اجرا کنید.

نتیجه روی یک حساب موجود:

| `ACCOUNTS_API_URL` هنگام اجرا | `/api/account/users/username` | `/u/username` و `/@username` |
|---|---|---|
| تنظیم نشده | `200` | `404` |
| تنظیم شده | `200` | `200` |

## محدودیت باقی‌مانده

هر قطعی سرویس حساب‌ها هنوز به‌صورت «نمایه پیدا نشد» نمایش داده می‌شود و در لاگ production ثبت نمی‌شود.
