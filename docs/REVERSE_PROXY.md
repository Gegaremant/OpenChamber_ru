# Reverse Proxy (за прокси)

> Этот документ — переведённый на русский и дополненный гайд для региональной сборки **OpenChamber_ru**. Все конфигурации ниже проверены для порта `3000` по умолчанию. Чем отличается от оригинала: перевод на русский, унифицированные имена артефактов и явный упор на SSE/WebSocket маршруты.

Используйте этот гайд, когда запускаете OpenChamber за Nginx, Nginx Proxy Manager, Caddy, Cloudflare или другим reverse proxy.

## Перед тем, как ставить прокси

1. Сначала убедитесь, что OpenChamber работает напрямую.
2. Откройте `http://<ip-сервера>:3000` (или ваш порт) из той же сети.
3. Только после того как прямое подключение заработало, добавляйте reverse proxy.

## Что прокси должно уметь

- WebSockets для живой передачи сообщений:
  - `/api/event/ws`
  - `/api/global/event/ws`
  - `/api/terminal/ws`
- SSE без буферизации:
  - `/api/event`
  - `/api/global/event`
  - `/api/notifications/stream`
  - `/api/openchamber/events`
- Большой размер тела запроса (вложения и файловые операции)
- Длинные таймауты чтения для живых потоков и терминальных сессий

## Правила, которые важны

- Включите проксирование WebSocket.
- Отключите буферизацию на SSE-маршрутах.
- Отключите gzip на прокси, если OpenChamber уже сжимает ответы.
- Держите сжатие только в одном слое.
- Передавайте стандартные заголовки прокси: `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`.
- Увеличьте лимит размера тела, если пользователи загружают файлы.

## Быстрая проверка

- OpenChamber доступен напрямую по локальной сети
- WebSockets включены в прокси
- На SSE-маршрутах буферизация выключена
- `gzip off` на хосте прокси (или сжатие отключено другим способом)
- `client_max_body_size` достаточно для вложений
- `proxy_read_timeout` достаточно для потоков

## Пример: Nginx

<details>
<summary>Показать конфиг</summary>

```nginx
client_max_body_size 50M;
client_body_buffer_size 50M;
proxy_request_buffering off;

proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;

gzip off;

location = /api/terminal/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location = /api/global/event/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location = /api/event/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location ~ ^/api/(event|global/event|notifications/stream|openchamber/events)$ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Accept "text/event-stream";
    proxy_set_header Cache-Control "no-cache";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    add_header X-Accel-Buffering "no" always;
    add_header Cache-Control "no-cache, no-transform" always;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location /api {
    proxy_pass http://127.0.0.1:3000;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location / {
    proxy_pass http://127.0.0.1:3000;
}
```

</details>

## Пример: Nginx Proxy Manager

<details>
<summary>Показать конфиг для вкладки Advanced</summary>

```nginx
client_max_body_size 50M;
client_body_buffer_size 50M;
proxy_request_buffering off;

proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;

gzip off;

location = /api/terminal/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location = /api/global/event/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location = /api/event/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location = /api/event {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Accept "text/event-stream";
    proxy_set_header Cache-Control "no-cache";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    add_header X-Accel-Buffering "no" always;
    add_header Cache-Control "no-cache, no-transform" always;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location = /api/global/event {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Accept "text/event-stream";
    proxy_set_header Cache-Control "no-cache";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    add_header X-Accel-Buffering "no" always;
    add_header Cache-Control "no-cache, no-transform" always;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location = /api/notifications/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Accept "text/event-stream";
    proxy_set_header Cache-Control "no-cache";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    add_header X-Accel-Buffering "no" always;
    add_header Cache-Control "no-cache, no-transform" always;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location = /api/openchamber/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Accept "text/event-stream";
    proxy_set_header Cache-Control "no-cache";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    add_header X-Accel-Buffering "no" always;
    add_header Cache-Control "no-cache, no-transform" always;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location /api {
    proxy_pass http://127.0.0.1:3000;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 30s;
}

location / {
    proxy_pass http://127.0.0.1:3000;
}
```

</details>

Также для этого хоста включите **Websockets Support** в Nginx Proxy Manager.

## Признаки типовых проблем

### Страница открывается, но сообщения не отправляются

- WebSockets не включены в прокси
- `/api/event/ws` или `/api/global/event/ws` не пробрасываются корректно

### Уведомления или живой статус не обновляются

- один из SSE-маршрутов буферизуется или кэшируется
- отсутствует `X-Accel-Buffering "no"`

### Не загружаются файлы

- `client_max_body_size` слишком маленький

### Всё работает локально, но ломается только за прокси

- прокси сжимает и буферизует живой трафик
- в прокси нет поддержки WebSocket

## Пример: Caddy

<details>
<summary>Показать конфиг</summary>

```caddy
reverse_proxy 127.0.0.1:3000 {
    # WebSocket support is automatic in Caddy

    # Flush SSE responses immediately
    flush_interval -1

    # Pass through Host and proxy headers
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}

    # Increase timeouts for long-lived streams
    transport http {
        read_timeout 3600s
        write_timeout 3600s
    }
}
```

</details>

Caddy обновляет WebSocket автоматически — дополнительной настройки не нужно. Директива `flush_interval -1` гарантирует немедленную передачу SSE-чанков без буферизации.

## CDN и двойное сжатие

Если перед reverse proxy стоит CDN (например, Cloudflare), следите за двойным сжатием:

- OpenChamber сжимает HTTP-ответы gzip (порог 1 КБ).
- Cloudflare и другие CDN тоже сжимают ответы по умолчанию.
- Это может дать двойное сжатие или неверные заголовки `Content-Encoding`.

Чтобы избежать проблем, отключите сжатие **в одном** слое:

- **Cloudflare:** Rules → Compression → отключить (или режим "Passthrough").
- **Nginx:** `gzip off` (уже показано в примерах выше).
- **Caddy:** Caddy не сжимает повторно, если upstream уже отдаёт сжатый контент.

SSE-потоки OpenChamber исключает из сжатия, но CDN может буферизовать их. Проверьте документацию вашего CDN, как отключить буферизацию для SSE-путей.