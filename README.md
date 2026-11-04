# Servicio de Impresión Web

Sistema web para recibir, cotizar y gestionar pedidos de impresión y ploteo de gran formato.
Reemplaza el envío de archivos por correo: el cliente sube su PDF, ve el precio exacto,
recibe instrucciones de pago y un código para seguir su pedido. El equipo de impresión
gestiona todo desde un panel interno.

## Puesta en marcha

Requisitos: Docker y Docker Compose.

```bash
cp .env.example .env        # y edite las claves, el correo SMTP y el administrador
docker compose up -d --build
```

- Sitio público: http://localhost:3000
- Panel interno: http://localhost:3000/admin (usuario y clave de `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

La primera vez, MariaDB ejecuta `db/schema.sql` (tablas, papeles, precios y estados) y la
aplicación crea el administrador inicial.

### Producción con dominio propio

1. Apunte el DNS del dominio (p. ej. `impresion.ejemplo.cl`) al servidor y abra los puertos 80 y 443.
2. En `.env` defina `DOMINIO`, `PUBLIC_URL=https://<dominio>`, `COOKIE_SECURE=true` y
   `APP_PORT=127.0.0.1:3000` (así solo Caddy llega a la app; Docker abre los puertos publicados
   por encima del firewall). `SESSION_SECRET` debe ser aleatorio (`openssl rand -hex 32`):
   con el valor de ejemplo la app no arranca.
3. Levante con el proxy Caddy, que obtiene y renueva el certificado HTTPS solo:

```bash
docker compose --profile produccion up -d --build
```

4. Entre al panel y cambie la contraseña del administrador en **Mi cuenta** (clic en su nombre,
   arriba a la derecha). `ADMIN_PASSWORD` solo se usa para crear el primer usuario: cambiarla
   después en `.env` no cambia la clave de nadie.

Si su organización ya tiene un Nginx/Apache, omita el perfil y haga `proxy_pass` a
`http://<servidor>:3000` (con `client_max_body_size 20m`).

### Correo

Configure `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` con la cuenta que enviará los avisos:

| Cuenta | `SMTP_HOST` | `SMTP_PORT` | Clave |
|---|---|---|---|
| Office 365 / Microsoft 365 | `smtp.office365.com` | 587 | la de la cuenta (el administrador debe tener SMTP AUTH habilitado) |
| Gmail | `smtp.gmail.com` | 587 | una [contraseña de aplicación](https://myaccount.google.com/apppasswords) |

`MAIL_FROM` debe usar la misma dirección que `SMTP_USER`, o el servidor puede rechazar el envío.
Mientras `SMTP_HOST` esté vacío, los correos no salen y quedan registrados en
`docker compose logs app`, lo que sirve para probar. Al arrancar, la app indica en el log si el
SMTP responde. Para comprobarlo a mano:

```bash
docker compose exec app npm run probar-correo -- su-correo@ejemplo.cl
```

Qué correos se envían:

- **Pedido nuevo:** aviso a los correos internos del equipo (definidos en `.env`) con los datos del cliente,
  el total, el enlace al panel y el PDF adjunto (`MAIL_ADJUNTAR_PDF`, hasta `MAIL_ADJUNTAR_MAX_MB`).
  Responder ese correo le escribe directo al cliente.
- **Confirmación al cliente:** código de pedido, total e instrucciones de pago.
- **Comprobante recibido:** aviso al equipo con la boleta adjunta, para revisarla en el panel.
- **Pago verificado o rechazado:** al cliente (con copia oculta al equipo); si se rechaza, lleva el motivo y el enlace para subir otro.
- **Cambio de estado:** al cliente (si se marca en el panel) y al equipo.

### Comprobante de pago

1. El cliente hace el pedido y recibe el total con las instrucciones de pago.
2. Después de pagar, sube la boleta o el comprobante de traspaso (PDF, JPG o PNG, máx. 5 MB) en
   "Mi pedido" o desde el botón del correo de confirmación, que trae el código y el correo ya completados.
3. En el panel, el filtro "Pagos por revisar" muestra los comprobantes nuevos. El operador lo abre
   y lo verifica, o lo rechaza con un motivo que recibe el cliente.
4. Un pedido solo puede pasar a "En impresión", "Listo" o "Entregado" con el pago verificado. Si el
   pago se confirmó por otra vía (p. ej. un traspaso), se puede verificar sin comprobante.

Las bases creadas con una versión anterior se actualizan solas al arrancar la app (`src/lib/migraciones.js`).

### Equipos en préstamo (inventario y etiquetas QR)

En el panel, la pestaña *Equipos* registra lo que se presta (notebooks, drones, etc.):

- **Equipo:** categoría, nombre, accesorios, garantía que se deja, tarifa por día (0 = sin costo) y plazo máximo.
- **Unidad:** cada aparato físico, con su n° de inventario, n° de serie, ubicación y estado
  (disponible, prestado, en mantención, de baja).
- **Etiquetas QR:** se imprimen por equipo o por unidad. El QR apunta a `PUBLIC_URL/q/<código>`: un
  operador con sesión iniciada llega directo a la ficha de la unidad; cualquier otra persona solo ve
  qué equipo es y a quién devolverlo. Si una etiqueta se pierde, "generar QR nuevo" anula la anterior.
  Defina `PUBLIC_URL` con el dominio real antes de imprimir etiquetas.

Cualquier operador consulta el inventario; solo un administrador lo modifica.

### Solicitudes de préstamo

1. En `/prestamos` (enlazado desde el sitio) se ve el catálogo y se pide un equipo con fechas de retiro
   y devolución. Solo pueden pedir correos de los dominios de `PRESTAMO_DOMINIOS` (por defecto
   `@uct.cl` y `@alu.uct.cl`), dentro del plazo máximo del equipo y con hasta 60 días de anticipación.
   Se muestra cuántas unidades quedan libres en esas fechas y el costo (tarifa × días).
2. Llega un correo de confirmación al solicitante y un aviso al equipo interno.
3. En el panel, *Préstamos* lista las solicitudes. Al aceptar, se elige una unidad libre en esas
   fechas y el día, la hora y el lugar de retiro; el solicitante recibe todo por correo. También se
   puede rechazar, o anular un préstamo ya aceptado, con un motivo.
4. En "Mi préstamo" (código + correo, o el enlace del correo) el solicitante ve el estado y puede
   cancelar mientras no haya retirado el equipo.

Una unidad queda ocupada en las fechas de un préstamo aceptado o entregado. Al elegir un equipo,
el formulario muestra un calendario de 4 semanas con cuántas unidades quedan libres cada día
(sin datos de quién las tiene); un clic en un día lo deja como fecha de retiro.

### Calendario de ocupación (panel)

En *Préstamos → Calendario* se ven todas las unidades, agrupadas por equipo, en un rango de 4 semanas
que se mueve de a una semana. Cada préstamo es una barra con su código y solicitante, del color de su
estado (aceptado, entregado o atrasado); un atrasado se alarga hasta hoy porque la unidad sigue afuera.
Las solicitudes aún sin unidad asignada aparecen en una fila "Por asignar" bajo cada equipo, y las
unidades en mantención quedan sombreadas. Un clic en la barra abre el préstamo.

### Recordatorios de devolución

La app revisa cada 15 minutos (desde `PRESTAMO_RECORDATORIO_HORA`, por defecto 9:00) los equipos
entregados y envía al solicitante:

- **El día antes** del vencimiento: «recuerda devolverlo mañana».
- **El día del vencimiento**: «la devolución es hoy».
- **Si no se devolvió**, una vez al día siguiente: aviso de atraso, con copia a `MAIL_LPT`.

Cada recordatorio sale una sola vez y queda en el historial del préstamo. Necesitan SMTP: sin
`SMTP_HOST` no se envían ni se marcan, y si el correo falla se reintenta en el siguiente ciclo. Si el equipo se entrega el
mismo día en que vence (o el día antes), no se envía el recordatorio de ese día: el comprobante de
entrega ya trae la fecha. Se desactivan con `PRESTAMO_RECORDATORIOS=false`, y
`npm run recordatorios` los envía en el momento.

### Entrega y devolución con el QR

- En el panel, *Escanear* abre la cámara del celular (requiere https) y lee la etiqueta; también se
  puede escribir el n° de inventario. Lleva a la ficha de la unidad, que muestra qué hacer:
- **Entrega:** desde el día de retiro, se confirma que se recibió la garantía y se anota cualquier
  observación. La unidad pasa a "prestado" y el solicitante recibe un comprobante con la fecha de devolución.
- **Devolución:** se indica si vuelve sin observaciones, con observaciones o dañada. Si vuelve dañada
  (o se marca), la unidad queda en mantención y no se presta hasta que un administrador la libere.
  El solicitante recibe el cierre por correo.
- Los préstamos entregados cuya fecha de devolución ya pasó aparecen como **Atrasado** en el panel.
- La entrega y la devolución también se pueden registrar desde el detalle del préstamo.

## Cómo funciona

| Paso | Qué ocurre |
|---|---|
| Cotizador rápido | El cliente ingresa ancho × alto en cm, papel y copias; ve el precio referencial. |
| Envío del PDF | El navegador lee las medidas reales de **cada página** del PDF y las muestra en una tabla (medida en cm, tamaño de hoja reconocido, m²), con el aviso de que se imprime a escala 1:1 y la página que supera el ancho máximo marcada en rojo. Si todas las páginas son de oficina (A4, carta, oficio…) se pide confirmar que ese es el tamaño real. |
| Recepción | El servidor **vuelve a leer el PDF** y calcula el precio definitivo; las medidas del cliente no se usan para cobrar. |
| Confirmación | Código de pedido (`XXX-AAAA-NNNNN`), total, fecha estimada (2 días hábiles) e instrucciones de pago. |
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
db/schema.sql            usuarios, servicios_papel, estados_pedido, cotizaciones_pedidos, historial_estados,
                         equipos_categorias, equipos, equipos_unidades, prestamos, prestamos_movimientos
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
  src/lib/equipos.js     inventario de equipos en préstamo y QR de cada unidad
  src/lib/prestamos.js   solicitudes, disponibilidad por fechas, aprobación y calendario
  src/lib/recordatorios.js  recordatorios de devolución por correo (cada 15 min)
  src/routes/publico.js  /api/config, /api/cotizar, /api/pedidos, /api/seguimiento
  src/routes/admin.js    /admin/api/* (login, pedidos, estados, archivo, papeles, usuarios)
  src/routes/equipos.js  /admin/api/equipos y /admin/api/unidades (inventario y etiquetas)
  src/routes/qr.js       /q/<código>, destino del QR pegado en cada equipo
  src/routes/prestamos-publico.js  /api/prestamos (catálogo, disponibilidad, ocupación, solicitud, Mi préstamo)
  src/routes/prestamos-admin.js    /admin/api/prestamos (lista, calendario, aceptar, rechazar, entregar, recibir)
  public/                sitio público y panel (HTML + CSS + JS sin framework)
  test/                  pruebas del cálculo, lectura de PDF y RUT (npm test)
```

## Tareas habituales

```bash
docker compose logs -f app                          # ver actividad y correos
docker compose exec app npm run crear-usuario -- "Nombre" correo@ejemplo.cl "clave-de-10+" operador
docker compose exec app npm run cambiar-clave -- correo@ejemplo.cl "clave-nueva-de-10+"   # también si se olvidó; cierra sus sesiones
docker compose exec app npm run recordatorios       # enviar ya los recordatorios de devolución de hoy
docker compose exec db sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' > respaldo.sql   # respaldo de la base
```

Los PDF y comprobantes se guardan en el volumen `uploads`; respáldelo junto con la base:

```bash
docker compose exec app tar czf - -C /data uploads > uploads.tar.gz
```

En el panel, **Usuarios** (solo administradores) lista las cuentas y permite desactivar a quien
deja el equipo: sus sesiones se cierran al instante.

## Desarrollo sin Docker

```bash
cd app && npm install
DB_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run dev
npm test
```
