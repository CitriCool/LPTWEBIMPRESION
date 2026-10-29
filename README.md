# Servicio de Impresión LPT · UCT

Sistema web para recibir, cotizar y gestionar los pedidos de impresión y ploteo del
**Laboratorio de Planificación Territorial (LPT) de la Universidad Católica de Temuco**.
Reemplaza el envío de archivos por correo: el cliente sube su PDF, ve el precio exacto,
recibe instrucciones de pago (SCC 251-1148) y un código para seguir su pedido. El
equipo LPT gestiona todo desde un panel interno.

## Puesta en marcha

Requisitos: Docker y Docker Compose.

```bash
cp .env.example .env        # y edite las claves, el correo SMTP y el administrador
docker compose up -d --build
```

- Sitio público: http://localhost:3000
- Panel LPT: http://localhost:3000/admin (usuario y clave de `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

La primera vez, MariaDB ejecuta `db/schema.sql` (tablas, papeles, precios y estados) y la
aplicación crea el administrador inicial.

### Producción con dominio propio

1. Apunte el DNS del dominio (p. ej. `impresion.lpt.uct.cl`) al servidor y abra los puertos 80 y 443.
2. En `.env` defina `DOMINIO`, `PUBLIC_URL=https://<dominio>` y `COOKIE_SECURE=true`.
3. Levante con el proxy Caddy, que obtiene y renueva el certificado HTTPS solo:

```bash
docker compose --profile produccion up -d --build
```

Si la universidad ya tiene un Nginx/Apache, omita el perfil y haga `proxy_pass` a
`http://<servidor>:3000` (con `client_max_body_size 20m`).

### Correo

Configure `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` con la cuenta institucional (Office 365:
`smtp.office365.com`, puerto 587). Mientras `SMTP_HOST` esté vacío, los correos no salen y
quedan registrados en `docker compose logs app`, lo que sirve para probar.

Se envían correos a `MAIL_LPT` (rcallejas@uct.cl y lpt@uct.cl) y al cliente:
al recibir un pedido (con instrucciones de pago) y en cada cambio de estado.

## Cómo funciona

| Paso | Qué ocurre |
|---|---|
| Cotizador rápido | El cliente ingresa ancho × alto en cm, papel y copias; ve el precio referencial. |
| Envío del PDF | El navegador lee las medidas reales del PDF y muestra el precio antes de enviar. |
| Recepción | El servidor **vuelve a leer el PDF** y calcula el precio definitivo; las medidas del cliente no se usan para cobrar. |
| Confirmación | Código `LPT-AAAA-NNNNN`, total, fecha estimada (2 días hábiles) e instrucciones de pago con el SCC 251-1148. |
| Panel | Lista con filtros por estado y búsqueda, detalle, descarga del PDF, cambio de estado con comentario, notas internas e historial. |

### Reglas de negocio (`app/src/config.js`)

- Solo PDF, máximo 15 MB y 50 páginas.
- Precio = superficie (m²) × tarifa del papel × copias, redondeado al peso. Con varias páginas se suman todas.
- Ancho máximo 1,00 m: el plóter usa rollo de 1 m, así que se valida el **lado menor** de cada página
  (un afiche de 150 × 90 cm se acepta girándolo; uno de 120 × 110 cm se rechaza). Tolerancia de 1 mm por redondeo.
- Las tarifas se editan desde el panel (*Papeles y precios*, solo administradores) y quedan
  guardadas en cada pedido, así que un cambio de precio no altera pedidos anteriores.
- El escaneo de mapas/planos aparece como servicio a consultar por correo, porque no tiene tarifa publicada.

## Estructura

```
docker-compose.yml       MariaDB + app (+ Caddy en perfil "produccion")
.env.example             variables de configuración
db/schema.sql            usuarios, servicios_papel, estados_pedido, cotizaciones_pedidos, historial_estados
caddy/Caddyfile          proxy HTTPS para el dominio
app/
  Dockerfile
  src/server.js          Express, seguridad (helmet, sesión con cookie firmada), rutas
  src/config.js          configuración y reglas del servicio
  src/lib/cotizador.js   cálculo de m², precio, ancho máximo y días hábiles (sin dependencias)
  src/lib/pdf.js         validación del PDF y lectura de medidas por página
  src/lib/pedidos.js     acceso a datos de pedidos, papeles y estados
  src/lib/mailer.js      plantillas y envío de correos
  src/lib/validacion.js  datos del cliente y RUT chileno
  src/routes/publico.js  /api/config, /api/cotizar, /api/pedidos, /api/seguimiento
  src/routes/admin.js    /admin/api/* (login, pedidos, estados, archivo, papeles, usuarios)
  public/                sitio público y panel (HTML + CSS + JS sin framework)
  test/                  pruebas del cálculo, lectura de PDF y RUT (npm test)
```

## Tareas habituales

```bash
docker compose logs -f app                          # ver actividad y correos
docker compose exec app npm run crear-usuario -- "Nombre" correo@uct.cl "clave-de-10+" operador
docker compose exec db mariadb-dump -uroot -p lpt_impresion > respaldo.sql   # respaldo de la base
```

Los PDF se guardan en el volumen `uploads`; respáldelo junto con la base.

## Desarrollo sin Docker

```bash
cd app && npm install
DB_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run dev
npm test
```
