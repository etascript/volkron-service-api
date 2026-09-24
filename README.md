# Kellu

Kellu es una aplicacion web para recibir, ordenar y gestionar solicitudes comerciales desde formularios publicos. Esta pensada para negocios que necesitan capturar cotizaciones, pedidos o contactos desde su sitio web y administrarlos en un panel interno simple, seguro y responsive.

El sistema permite registrar solicitudes desde formularios externos o ingresarlas manualmente desde el panel administrativo. Cada registro puede filtrarse, revisarse en detalle, cambiar de estado y mantener una cronologia de seguimiento. Tambien incluye estadisticas operativas, exportacion de datos y recuperacion de contrasena para usuarios administrativos.

Fue desarrollado como una solucion liviana y dockerizable, usando una API propia, almacenamiento local en SQLite y una interfaz mobile first. Esto permite instalarlo en una VM o servidor privado sin depender de plataformas externas ni bases de datos complejas.

## Descripcion tecnica

Servicio dockerizable para:

- Recibir solicitudes del formulario de cotizacion.
- Guardar cada solicitud en almacenamiento local JSONL cifrado.
- Guardar la operacion principal en SQLite.
- Exponer un panel operativo en `/admin`.
- Entregar disponibilidad mensual para el calendario del sitio.
- Bloquear horarios ya tomados segun registros locales y estados del panel.

## Endpoints

```http
GET /health
GET /api/availability?month=2026-09
GET /api/forms/:slug/availability?month=2026-09
GET /api/holidays?year=2026
POST /api/quote
POST /api/forms/:slug/submissions
GET /admin
GET /admin/stats
GET /admin/schedule
GET /admin/settings
GET /admin/api/quotes
POST /admin/api/quotes/:id/status
GET /admin/api/settings
POST /admin/api/settings
GET /admin/api/forms/:slug/schedule
PUT /admin/api/forms/:slug/schedule
```

## Almacenamiento local

SQLite es la base operativa principal:

```txt
./data/app.db
```

Configura:

```env
DATABASE_PATH=./data/app.db
FORMS_BUILDER_ENABLED=false
```

`FORMS_BUILDER_ENABLED` controla la capacidad futura de crear formularios desde UI/API.
Para Volkron debe quedar en `false`.

Ademas, cada `POST /api/quote` valido escribe una linea cifrada de auditoria en formato JSONL.
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

Para migrar respaldos JSONL existentes a SQLite:

```bash
docker compose exec volkron-servicios-api npm run migrate:sqlite
```

## Panel admin

El panel interno queda disponible en:

```http
GET /admin
GET /admin/stats
GET /admin/settings
```

Permite listar, buscar y filtrar las cotizaciones guardadas en SQLite.
Tambien permite cambiar el estado operativo de una cotizacion.
La vista principal usa tabla responsive, permite ordenar por fecha y exportar a CSV compatible con Excel la vista filtrada actual.
En `/admin/settings` se configuran los estados del formulario y el estado por defecto.
En `/admin/schedule` se configura la agenda del formulario: horarios base, feriados, fines de semana, bloqueos y excepciones por fecha.
Para Volkron, el default inicial es `Pendiente`.

Los cambios de estado no reescriben la cotizacion original; se agregan como eventos historicos.
El detalle de cada solicitud muestra la cronologia completa de estados.

Estados disponibles:

```txt
received, pending, contacted, quoted, scheduled, won, lost, cancelled
```

Importante: `/admin` contiene datos personales.

El panel usa usuarios guardados en SQLite y sesiones firmadas por cookie. Configura en `.env`:

```env
ADMIN_SESSION_SECRET=otra-clave-larga
PUBLIC_BASE_URL=https://api.volkron.kappascript.cl
```

Genera un secreto de sesion:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Las rutas publicas de la tienda (`/api/quote`, `/api/availability`, `/api/holidays`) no usan esta autenticacion.

### Crear usuario admin

En una instalacion limpia, crea el primer usuario por terminal. Dentro de Docker:

```bash
docker compose exec volkron-servicios-api npm run admin:create-user -- \
  --username=volkron \
  --email=admin@volkronenergy.cl \
  --password='UnaClaveSegura123' \
  --name='Admin Volkron'
```

Tambien se puede ejecutar dentro del contenedor por nombre:

```bash
docker exec -it volkron-servicios-api npm run admin:create-user -- \
  --username=volkron \
  --email=admin@volkronenergy.cl \
  --password='UnaClaveSegura123' \
  --name='Admin Volkron'
```

La clave debe tener al menos 10 caracteres. El email es obligatorio porque se usa para recuperar la clave.

Para usar variables de entorno en vez de flags:

```bash
ADMIN_CREATE_USERNAME=volkron \
ADMIN_CREATE_EMAIL=admin@volkronenergy.cl \
ADMIN_CREATE_PASSWORD='UnaClaveSegura123' \
ADMIN_CREATE_NAME='Admin Volkron' \
npm run admin:create-user
```

### Recuperacion de clave

Configura SMTP para que el usuario reciba un enlace con token de recuperacion:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

El enlace apunta a `/admin/reset-password?token=...`, expira en 1 hora y solo puede usarse una vez.
Si SMTP no esta configurado, el servicio registra el enlace en logs como fallback de desarrollo.

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

## Agenda configurable

La disponibilidad ya no depende directamente de `AVAILABLE_SLOTS` en `.env`. Esa variable solo se usa como semilla inicial cuando se crea la configuracion del formulario `cotizacion`.

La agenda se guarda en SQLite e incluye:

- agenda activa o inactiva,
- zona horaria,
- meses de anticipacion,
- modo de feriados nacionales,
- horarios por dia especifico,
- horarios para fines de semana,
- horarios especiales para feriados,
- bloqueos manuales por fecha,
- excepciones con horarios especiales o extras.

Modos de feriados:

```txt
none            # No considerar feriados
national_block  # Bloquear feriados nacionales automaticamente
manual_only      # Solo bloquear fechas definidas manualmente
custom           # Usar horarios especiales de feriado
```

La vista administrativa esta en:

```http
GET /admin/schedule
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
