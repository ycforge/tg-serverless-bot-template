# Авторизация и API

[← README](../README.md)

## Как подтверждается пользователь

1. Пользователь открывает Mini App из Telegram.
2. Telegram передаёт приложению строку `Telegram.WebApp.initData`.
3. Фронтенд автоматически отправляет `POST /api/auth/telegram` с `Authorization: tma <initData>`.
4. `TelegramAuthGuard` проверяет HMAC-SHA256 с серверным токеном бота, `auth_date`, отсутствие дублей параметров и типы подписанных объектов.
5. Каждый следующий запрос счётчика проходит ту же проверку. Сервер выбирает пользователя из проверенного контекста, а не из тела запроса.

Отдельный Telegram Login Widget, кнопка входа, JWT и серверная сессия здесь не используются. Это авторизация пользователя Telegram; доступ Gateway к функции отдельно регулируется Yandex Cloud IAM.

В строку проверки входят все поля, кроме `hash`, в том числе `signature`, если он присутствует. Сравнение HMAC выполняется за постоянное время. По умолчанию допускается возраст данных до `3600` секунд и отклонение часов в будущее до `30` секунд. Настройки описаны в [конфигурации](configuration.md).

`initData` — временный bearer credential. Не логируйте его, не передавайте в query string и не сохраняйте в localStorage. После истечения срока заново откройте Mini App. Подпись не делает каждый HTTP-запрос уникальным: повторы изменений отдельно контролируются через `operationId`.

## NestJS-модуль

Реализация находится в [apps/api/src/telegram](../apps/api/src/telegram). Подключите модуль в NestJS-модуле, содержащем защищаемые контроллеры:

```ts
import { Module } from '@nestjs/common';
import { TelegramAuthModule } from './telegram';
import { ProfileController } from './profile.controller';

@Module({
  imports: [TelegramAuthModule.forRoot()],
  controllers: [ProfileController],
})
export class ProfileModule {}
```

`forRoot()` читает серверный `BOT_TOKEN` и параметры срока из ENV. Для тестов можно передать явные настройки: `TelegramAuthModule.forRoot({ botToken: 'test-token', maxAgeSeconds: 60, futureSkewSeconds: 5 })`.

Пример дополнительного контроллера, который можно добавить в проект:

```ts
import { Controller, Get, Header } from '@nestjs/common';
import { TgAuth, TgUser, TgChat, toPublicTelegramUser } from './telegram';
import type { TelegramUser, TelegramChat } from './telegram';

@Controller('api/profile')
@TgAuth()
export class ProfileController {
  @Get()
  @Header('Cache-Control', 'no-store')
  profile(@TgUser() user: TelegramUser) {
    return toPublicTelegramUser(user);
  }

  @Get('chat')
  @Header('Cache-Control', 'no-store')
  chat(@TgChat({ required: true }) chat: TelegramChat) {
    return { id: chat.id, type: chat.type };
  }
}
```

`@TgAuth()` применим и к отдельному методу. Реальные примеры: [AuthController](../apps/api/src/auth.controller.ts) и [CounterController](../apps/api/src/counter.controller.ts).

| Декоратор | Значение |
| --- | --- |
| `@TgAuth()` | Включает `TelegramAuthGuard` |
| `@TgUser()` / `@TgAuthor()` | Подписанный автор из `user`; это псевдонимы |
| `@TgReceiver()` | Необязательный собеседник из подписанного `receiver` |
| `@TgChat()` | Подписанный `chat` или `undefined` |
| `@TgChat({ required: true })` | Подписанный `chat`; при отсутствии возвращает `400` |
| `@TgContext()` | Весь проверенный контекст, включая метаданные запуска |

Без проверенного guard-контекста параметр-декораторы возвращают `401`. Контекст хранится через `Symbol`, а не в обычном JSON-поле request. Он и вложенные объекты заморожены; типы доступны только для чтения. При повторной проверке прежний контекст очищается. Неоднозначные заголовки авторизации отклоняются.

`user`, `receiver` и `chat` обозначают разные сущности. В обычном запуске по inline-кнопке в личном чате подписанный `chat` может отсутствовать. Модуль не создаёт чат из `user.id`; `chat_instance` также не заменяет Bot API chat ID. Клиентский `initDataUnsafe` не является доверенным источником.

## HTTP API

Все пути относительны к адресу API Gateway. За исключением health, нужен заголовок `Authorization: tma <initData>`. Защищённые ответы имеют `Cache-Control: no-store`.

| Метод | Путь | Тело запроса | Ответ |
| --- | --- | --- | --- |
| GET | `/api/health` | — | Проверка доступности API без обращения к YDB |
| POST | `/api/auth/telegram` | `{}` | `{ "user": { "id": "123", "firstName": "Example", "username": "example" } }` |
| GET | `/api/counter` | — | `{ "value": "0" }` |
| POST | `/api/counter/change` | `{ "delta": 1, "operationId": "<UUID-v4>" }` | `{ "value": "1" }` |

`delta` допускает только `1` или `-1`; `operationId` должен быть UUID v4. Значение счётчика передаётся строкой для сохранения точности. Повтор операции с другим `delta` и выход за допустимый диапазон дают `409`; неверное тело — `400`; отсутствующая или невалидная авторизация — `401`.

Источник протокола: [Telegram Mini Apps — validating data](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
