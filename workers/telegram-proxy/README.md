# Telegram Bot API proxy · Cloudflare Worker

[← Основной README](../../README.md)

[worker.mjs](worker.mjs) — предоставленная реализация прокси в формате ES module. Она перенаправляет запросы на фиксированный хост `api.telegram.org`, поддерживает Bot API и загрузку файлов. Токен передаётся в пути запроса по формату Telegram; в исходнике и Wrangler-конфигурации рабочего токена нет.

Worker — необязательный отдельный компонент. Он обслуживает исходящие обращения бота к Telegram. Mini App продолжает работать через Yandex API Gateway, а обновления доставляет Telegram-триггер Yandex Cloud.

## Развёртывание через Wrangler

Нужны аккаунт Cloudflare, Node.js 22 и npm. Команды ниже выполняются **из корня репозитория**. Wrangler 4.166.0 запускается через `npx`; отдельная установка глобального CLI не нужна.

1. Откройте [wrangler.jsonc](wrangler.jsonc) и при необходимости измените нейтральное имя `telegram-bot-api-proxy`. `main` указан относительно файла конфигурации.
2. Авторизуйтесь и проверьте выбранный аккаунт:

   ```bash
   npx wrangler@4.166.0 login
   npx wrangler@4.166.0 whoami
   ```

3. При нескольких аккаунтах задайте нужный `account_id` в конфигурации или `CLOUDFLARE_ACCOUNT_ID` в окружении команды.
4. При желании сначала проверьте локальную сборку без публикации:

   ```bash
   npx wrangler@4.166.0 deploy --dry-run --config workers/telegram-proxy/wrangler.jsonc
   ```

5. Опубликуйте Worker:

   ```bash
   npx wrangler@4.166.0 deploy --config workers/telegram-proxy/wrangler.jsonc
   ```

CLI выведет адрес вида `https://telegram-bot-api-proxy.<your-subdomain>.workers.dev`. Если у аккаунта ещё нет поддомена `workers.dev`, настройте его по приглашению CLI или в Cloudflare Dashboard. Вместо `workers.dev` можно отдельно подключить собственный домен.

Cloudflare-учётные данные не добавляйте в `.env` бота или Git. Для автоматизированной публикации Wrangler поддерживает `CLOUDFLARE_API_TOKEN`; его нужно хранить в секретах CI. Worker не входит в `npm run deploy` и не управляется Terraform этого проекта.

## Альтернатива: Cloudflare Dashboard

В разделе Workers & Pages создайте Worker, откройте редактор кода, вставьте содержимое [worker.mjs](worker.mjs) как ES module с `export default` и опубликуйте. Скопируйте выданный HTTPS-адрес. KV, D1, Durable Objects, переменные и секреты для текущего кода не требуются.

## Подключение бота

В корневом `.env` укажите **адрес Worker с `/bot` в конце, без токена и имени метода**:

```dotenv
TG_PROXY_BASE=https://telegram-bot-api-proxy.<your-subdomain>.workers.dev/bot
```

Функция самостоятельно формирует запрос:

```text
<TG_PROXY_BASE><BOT_TOKEN>/sendMessage
```

Для первого развёртывания продолжите [быстрый старт](../../README.md#быстрый-старт). Для существующего стенда опубликуйте новые версии с обновлённой ENV:

```bash
npm run build
npm run deploy:apps
npm run verify
```

После этого отправьте боту `ping` и `/start`: это проверит исходящие ответы через Worker. `npm run verify` проверяет TMA и облачный API, но сам по себе не отправляет сообщения Telegram. Фронтенд, Gateway и источник Telegram-триггера для смены прокси менять не нужно.

Чтобы вернуться к прямому доступу, задайте `TG_PROXY_BASE=https://api.telegram.org/bot` и снова выполните публикацию приложений.

## Локальный запуск и проверка

```bash
npx wrangler@4.166.0 dev --config workers/telegram-proxy/wrangler.jsonc
```

Откройте выданный локальный адрес. Главная страница показывает примеры, `/stats` — статистику текущего isolate. Кнопка проверки на странице обращается к `/stats`: она **не проверяет доступность Telegram**.

После публикации доступность самого Worker можно проверить без токена:

```bash
curl --fail https://telegram-bot-api-proxy.<your-subdomain>.workers.dev/stats
```

Замените адрес своим. Для проверки реального Bot API выполните серверный запрос к `/bot<TOKEN>/getMe` или отправьте сообщение своему боту. Не публикуйте URL с токеном и не помещайте его во фронтенд.

## Маршруты

| Маршрут | Назначение |
| --- | --- |
| `/` | Информационная страница с примерами |
| `/stats` | Статистика текущего isolate |
| `/bot<TOKEN>/<METHOD>` | Проксирование Telegram Bot API |
| `/file/bot<TOKEN>/<FILE_PATH>` | Получение файла из Telegram |

Для работы проекта используется `POST /bot<TOKEN>/sendMessage`. JSON и multipart-запросы пересылаются в Telegram. Заголовки cookie и авторизации клиента удаляются перед запросом к upstream.

## Особенности предоставленной реализации

- Весь код сохранён из предоставленного исходника; интеграция не меняет его алгоритмы.
- `validateBotToken` проверяет формат, а не подлинность токена. Окончательную проверку делает Telegram. Ограничения одним ботом или отдельного ключа доступа к прокси нет.
- Лимиты, circuit breaker и `/stats` хранятся в памяти isolate. Они могут сбрасываться и не являются общими для всех экземпляров Worker.
- Повторы предусмотрены для GET-запросов Bot API. Для изменяющих операций используйте POST, как делает функция бота, чтобы сетевой повтор GET не продублировал действие.
- Для некоторых GET-методов и файлов настроено edge-кеширование. Не используйте кешированный `getChatMember` как проверку прав TMA: авторизация проекта от него не зависит.
- Код допускает загрузки до заявленных 50 MiB по `Content-Length`, но не является строгим потоковым ограничителем размера. Фактические ограничения зависят также от Cloudflare и Telegram.
- В текущем списке методов нет HEAD, несмотря на ветку обработки HEAD в разборе файлов; для скачивания используйте GET.
- Перехваченные ошибки передаются в `console.error`, их текст частично возвращается клиенту. В конфигурации Wrangler observability выключена; перед добавлением внешнего логирования нужна редакция секретов и URL с токеном.

Настройки лимитов, повторов, кеширования, фильтра стран и User-Agent находятся в константах в начале [worker.mjs](worker.mjs). Они не задаются через `.env` проекта.

## Документация платформы

- [Wrangler: начало работы](https://developers.cloudflare.com/workers/get-started/guide/)
- [Команды Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Compatibility date](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
