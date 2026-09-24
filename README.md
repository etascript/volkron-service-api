# Volkron Servicios API

Servicio dockerizable para:

- Recibir solicitudes del formulario de cotizacion.
- Guardar cada solicitud en almacenamiento local JSONL cifrado.
- Exponer un panel operativo en `/admin`.
- Entregar disponibilidad mensual para el calendario del sitio.
- Bloquear horarios ya tomados segun registros locales y estados del panel.

## Endpoints

```http
GET /health
GET /api/availability?month=2026-09
GET /api/holidays?year=2026
POST /api/quote
GET /admin
GET /admin/api/quotes
POST /admin/api/quotes/:id/status
```

## Almacenamiento local

Cada `POST /api/quote` valido escribe una linea cifrada en formato JSONL.
Por defecto se guarda en:

```txt
./data/quotes/YYYY-MM.jsonl
```

Los cambios de estado del panel se guardan en:

```txt
./data/status-events.jsonl
```

En Docker Compose, `./data` queda montado como volumen local:

```yaml
volumes:
  - ./data:/app/data
```

Genera una clave de cifrado para `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Configura:

```env
BACKUP_ENCRYPTION_KEY=pega-aqui-la-clave-base64
```

Sin esa clave el servicio no inicia. Si se pierde la clave, no se podran leer las cotizaciones cifradas.
Los archivos locales no deben subirse a Git. `data/` queda ignorado por `.gitignore`.

Si ya existen archivos JSONL antiguos en texto plano, cifra los historicos en la VM:

```bash
docker compose exec volkron-servicios-api npm run encrypt:data
```

El script deja una copia `.bak-TIMESTAMP` antes de reescribir cada archivo cifrado.

## Panel admin

El panel interno queda disponible en:

```http
GET /admin
```

Permite listar, buscar y filtrar las cotizaciones guardadas en `data/quotes/*.jsonl`.
Tambien permite cambiar el estado operativo de una cotizacion.
La vista principal usa tabla responsive, permite ordenar por fecha y exportar a CSV compatible con Excel la vista filtrada actual.

Los cambios de estado no reescriben la cotizacion original; se agregan como eventos cifrados append-only.
El detalle de cada solicitud muestra la cronologia completa de estados.

Estados disponibles:

```txt
received, pending, contacted, quoted, scheduled, won, lost, cancelled
```

Importante: `/admin` contiene datos personales.

El proyecto incluye Basic Auth para todo `/admin*`. Configura credenciales en `.env`:

```env
ADMIN_USER=volkron
ADMIN_PASSWORD=usa-una-clave-larga
```

Si esas variables no existen, `/admin*` responde `503 Admin no configurado`.
Las rutas publicas de la tienda (`/api/quote`, `/api/availability`, `/api/holidays`) no usan esta autenticacion.

## Google Sheets opcional

Google Sheets queda como salida legacy opcional. Para activarla:

```env
GOOGLE_SHEETS_ENABLED=true
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Si Google Sheets falla, la solicitud se mantiene guardada localmente y la API responde correctamente.

## Feriados Chile

El backend carga feriados desde `HOLIDAYS_API_URL` y los cachea por `HOLIDAYS_CACHE_TTL_MS`.
Los feriados de `HOLIDAYS` se mezclan como respaldo/manuales.

```env
HOLIDAYS_API_URL=https://api.roison.cl/feriados.json
HOLIDAYS_CACHE_TTL_MS=43200000
HOLIDAYS=2026-09-18,2026-09-19
```

Para forzar recarga:

```http
GET /api/holidays?refresh=true
```

## Ejecutar

```bash
docker compose up -d --build
```

## Caddy

Ejemplo:

```caddy
api.volkron.kappascript.cl {
  encode gzip zstd
  reverse_proxy volkron-servicios-api:9001
}
```

Luego en el frontend:

```js
const API_BASE_URL = "https://api.volkron.kappascript.cl";
```
