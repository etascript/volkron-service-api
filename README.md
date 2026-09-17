# Volkron Servicios API

Servicio dockerizable para:

- Recibir solicitudes del formulario de cotizacion.
- Guardar cada solicitud en Google Sheets.
- Entregar disponibilidad mensual para el calendario del sitio.
- Bloquear horarios ya tomados segun registros existentes en la hoja.

## Endpoints

```http
GET /health
GET /api/availability?month=2026-09
GET /api/holidays?year=2026
POST /api/quote
```

## Google Sheets

1. Crea una hoja con una pestaña llamada `Cotizaciones`.
2. Crea una Service Account en Google Cloud.
3. Comparte la hoja con el email de la Service Account como editor.
4. Copia `.env.example` a `.env` y completa:

```env
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

El servicio crea encabezados si la hoja esta vacia.

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

## Nginx recomendado

Publica la API detras de HTTPS, por ejemplo:

```nginx
location /volkron-api/ {
  proxy_pass http://127.0.0.1:8080/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Luego en el frontend:

```js
const API_BASE_URL = "https://www.volkronenergy.cl/volkron-api";
```
