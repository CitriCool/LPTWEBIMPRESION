'use strict';

(() => {
  const { api, clp, num, cm, esc, fecha, fechaHora } = window.LPT;
  const $ = (s, r = document) => r.querySelector(s);

  const PAGO = { cajas_uct: 'Cajas UCT', traspaso_presupuestario: 'Traspaso' };
  const ESTADO_PAGO = {
    sin_comprobante: 'Sin comprobante',
    por_revisar: 'Por revisar',
    verificado: 'Verificado',
    rechazado: 'Rechazado',
  };
  const ESTADOS_CON_PAGO = ['en_impresion', 'listo', 'entregado'];
  const VISTAS = ['vista-login', 'vista-lista', 'vista-detalle', 'vista-papeles', 'vista-usuarios', 'vista-equipos', 'vista-prestamos'];
  let usuario = null;
  let estados = [];
  let filtroEstado = '';
  let filtroPago = '';
  let temporizadorBusqueda;

  function mostrar(id) {
    VISTAS.forEach((v) => ($('#' + v).hidden = v !== id));
    $('#nav-admin').hidden = id === 'vista-login';
  }

  function aviso(texto) {
    const el = document.createElement('div');
    el.className = 'aviso';
    el.textContent = texto;
    document.body.append(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function llamar(url, opciones) {
    try {
      return await api(url, opciones);
    } catch (e) {
      if (e.status === 401) {
        usuario = null;
        mostrar('vista-login');
      }
      throw e;
    }
  }

  // ---------- Sesión ----------
  async function iniciarSesion(ev) {
    ev.preventDefault();
    const f = ev.currentTarget;
    $('#error-login').textContent = '';
    try {
      usuario = await api('/admin/api/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
      f.reset();
      await arrancar();
    } catch (e) {
      $('#error-login').textContent = e.message;
    }
  }

  async function arrancar() {
    $('#usuario-actual').textContent = usuario.nombre;
    $('#link-usuarios').hidden = usuario.rol !== 'admin';
    estados = await llamar('/admin/api/estados');
    enrutar();
  }

  // ---------- Lista ----------
  async function cargarLista() {
    mostrar('vista-lista');
    const filtros = new URLSearchParams({ limite: 100, estado: filtroEstado, pago: filtroPago, q: $('#buscar').value });
    const [{ estados: resumen, pagos_por_revisar: porRevisar }, datos] = await Promise.all([
      llamar('/admin/api/resumen'),
      llamar(`/admin/api/pedidos?${filtros}`),
    ]);

    $('#resumen').innerHTML =
      `<button type="button" data-pago="por_revisar" aria-pressed="${filtroPago === 'por_revisar'}">
          <span class="estado pago-por_revisar">Pagos por revisar</span><b>${porRevisar}</b><span class="tenue">comprobantes</span></button>` +
      resumen
        .map((e) => `<button type="button" data-estado="${esc(e.codigo)}" aria-pressed="${filtroEstado === e.codigo}">
          <span class="estado estado-${esc(e.codigo)}">${esc(e.nombre)}</span><b>${e.cantidad}</b><span class="tenue">${clp(e.monto)}</span></button>`)
        .join('');

    $('#filas').innerHTML = datos.pedidos.length
      ? datos.pedidos
          .map((p) => `<tr data-id="${p.id}">
            <td><b>${esc(p.codigo)}</b></td>
            <td>${esc(fechaHora(p.creado_en))}</td>
            <td>${esc(p.cliente_nombre)}<br><small class="tenue">${esc(p.cliente_email)}</small></td>
            <td>${esc(p.papel_nombre)}</td>
            <td>${cm(p.ancho_m)} × ${cm(p.alto_m)} cm${p.paginas > 1 ? ` <small class="tenue">(${p.paginas} pág.)</small>` : ''}${p.copias > 1 ? ` ×${p.copias}` : ''}</td>
            <td class="num">${clp(p.total_clp)}</td>
            <td>${PAGO[p.metodo_pago] || ''}<br><span class="estado pago-${esc(p.pago_estado)}">${ESTADO_PAGO[p.pago_estado]}</span></td>
            <td><span class="estado estado-${esc(p.estado_codigo)}">${esc(p.estado_nombre)}</span></td></tr>`)
          .join('')
      : '<tr><td colspan="8" class="tenue">No hay pedidos con este filtro.</td></tr>';
    $('#pie-lista').textContent = `${datos.pedidos.length} de ${datos.total} pedido(s)`;
  }

  // ---------- Detalle ----------
  async function cargarDetalle(id) {
    mostrar('vista-detalle');
    const v = $('#vista-detalle');
    v.innerHTML = '<p class="tenue">Cargando…</p>';
    const p = await llamar(`/admin/api/pedidos/${id}`);
    v.innerHTML = `
      <a href="#" class="volver">← Volver a pedidos</a>
      <h1>${esc(p.codigo)} <span class="estado estado-${esc(p.estado_codigo)}">${esc(p.estado_nombre)}</span></h1>
      <p class="tenue">Recibido el ${esc(fechaHora(p.creado_en))} · entrega estimada ${esc(fecha(p.fecha_entrega_estimada))}</p>
      <div class="detalle-grid">
        <div class="pila">
          <div class="tarjeta">
            <h3>Trabajo</h3>
            <dl class="detalle">
              <dt>Archivo</dt><dd><a class="boton boton-sm" href="/admin/api/pedidos/${p.id}/archivo">Descargar PDF</a> <small class="tenue">${esc(p.archivo_nombre)} · ${num(p.archivo_bytes / 1024 / 1024)} MB</small></dd>
              <dt>Papel</dt><dd>${esc(p.papel_nombre)} (${clp(p.precio_m2)}/m²)</dd>
              <dt>Medidas</dt><dd>${cm(p.ancho_m)} × ${cm(p.alto_m)} cm${p.paginas > 1 ? ` · página mayor de ${p.paginas}` : ''}</dd>
              <dt>Copias</dt><dd>${p.copias}</dd>
              <dt>Superficie</dt><dd>${num(p.area_m2)} m²</dd>
              <dt>Total cotizado</dt><dd><b>${clp(p.total_clp)}</b></dd>
              <dt>Forma de pago</dt><dd>${esc(PAGO[p.metodo_pago])} · SCC 251-1148</dd>
              ${p.observaciones ? `<dt>Observaciones</dt><dd>${esc(p.observaciones)}</dd>` : ''}
            </dl>
          </div>
          <div class="tarjeta">
            <h3>Cliente</h3>
            <dl class="detalle">
              <dt>Nombre</dt><dd>${esc(p.cliente_nombre)}</dd>
              <dt>RUT / ID</dt><dd>${esc(p.cliente_rut)}</dd>
              <dt>Correo</dt><dd><a href="mailto:${esc(p.cliente_email)}?subject=${encodeURIComponent('Pedido ' + p.codigo)}">${esc(p.cliente_email)}</a></dd>
              <dt>Teléfono</dt><dd>${esc(p.cliente_telefono)}</dd>
              ${p.cliente_unidad ? `<dt>Unidad</dt><dd>${esc(p.cliente_unidad)}</dd>` : ''}
            </dl>
          </div>
        </div>
        <div class="pila">
          ${tarjetaPago(p)}
          <form class="tarjeta pila" id="form-estado">
            <h3>Cambiar estado</h3>
            <label>Nuevo estado
              <select name="estado_id">${estados
                .map((e) => {
                  const bloqueado = p.pago_estado !== 'verificado' && ESTADOS_CON_PAGO.includes(e.codigo) && e.codigo !== p.estado_codigo;
                  return `<option value="${e.id}" ${e.codigo === p.estado_codigo ? 'selected' : ''} ${bloqueado ? 'disabled' : ''}>${esc(e.nombre)}${bloqueado ? ' (requiere pago verificado)' : ''}</option>`;
                })
                .join('')}</select>
            </label>
            <label>Comentario para el cliente <small class="tenue">(opcional)</small>
              <textarea name="comentario" rows="2" maxlength="500"></textarea>
            </label>
            <label class="check"><input type="checkbox" name="notificar_cliente" checked> Notificar al cliente por correo (LPT siempre recibe copia)</label>
            <button class="boton" type="submit">Guardar estado</button>
          </form>
          <form class="tarjeta pila" id="form-notas">
            <h3>Notas internas</h3>
            <textarea name="notas" rows="3" maxlength="5000" placeholder="Solo visibles para el equipo LPT">${esc(p.notas_internas || '')}</textarea>
            <button class="boton boton-claro" type="submit">Guardar notas</button>
          </form>
          <div class="tarjeta">
            <h3>Historial</h3>
            <ul class="historial">${p.historial
              .map((h) => `<li><b>${esc(h.estado)}</b> · ${esc(fechaHora(h.creado_en))}${h.usuario ? ` · ${esc(h.usuario)}` : ''}${h.comentario ? `<br><span class="tenue">${esc(h.comentario)}</span>` : ''}</li>`)
              .join('')}</ul>
          </div>
        </div>
      </div>`;

    $('#form-estado').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      try {
        const r = await llamar(`/admin/api/pedidos/${p.id}/estado`, {
          method: 'PATCH',
          body: { estado_id: Number(f.estado_id.value), comentario: f.comentario.value, notificar_cliente: f.notificar_cliente.checked },
        });
        aviso(`Estado actualizado: ${r.estado}`);
        cargarDetalle(p.id);
      } catch (e) {
        aviso(e.message);
      }
    });
    $('#form-pago')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      const accion = ev.submitter?.value;
      if (accion === 'rechazar' && !f.comentario.value.trim()) {
        aviso('Escriba el motivo del rechazo para el cliente.');
        return f.comentario.focus();
      }
      try {
        await llamar(`/admin/api/pedidos/${p.id}/pago`, { method: 'PATCH', body: { accion, comentario: f.comentario.value } });
        aviso(accion === 'verificar' ? 'Pago verificado' : 'Comprobante rechazado; se avisó al cliente');
        cargarDetalle(p.id);
      } catch (e) {
        aviso(e.message);
      }
    });
    $('#form-notas').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await llamar(`/admin/api/pedidos/${p.id}/notas`, { method: 'PATCH', body: { notas: ev.currentTarget.notas.value } });
        aviso('Notas guardadas');
      } catch (e) {
        aviso(e.message);
      }
    });
  }

  function tarjetaPago(p) {
    const url = `/admin/api/pedidos/${p.id}/comprobante`;
    const vista = !p.comprobante_nombre
      ? '<p class="tenue">El cliente aún no sube comprobante. Si el pago ya está confirmado por otra vía (p. ej. traspaso), puede verificarlo igual.</p>'
      : `<p><a class="boton boton-sm boton-claro" href="${url}" target="_blank" rel="noopener">Abrir comprobante</a>
           <small class="tenue">${esc(p.comprobante_nombre)} · subido el ${esc(fechaHora(p.comprobante_subido_en))}</small></p>
         ${p.comprobante_mime === 'application/pdf'
           ? `<iframe class="comprobante-vista" src="${url}" title="Comprobante de pago" height="420"></iframe>`
           : `<img class="comprobante-vista" src="${url}" alt="Comprobante de pago">`}`;
    const revisado = p.pago_revisado_en ? `<p class="tenue">Revisado el ${esc(fechaHora(p.pago_revisado_en))}${p.pago_comentario ? ` · ${esc(p.pago_comentario)}` : ''}</p>` : '';
    const acciones =
      p.pago_estado === 'verificado'
        ? ''
        : `<form class="pila" id="form-pago">
            <label>Comentario <small class="tenue">(obligatorio si rechaza; lo recibe el cliente)</small>
              <textarea name="comentario" rows="2" maxlength="500" placeholder="Ej.: el monto no coincide con el total del pedido"></textarea></label>
            <div class="acciones">
              <button class="boton" type="submit" value="verificar">Verificar pago</button>
              ${p.pago_estado === 'por_revisar' ? '<button class="boton boton-peligro" type="submit" value="rechazar">Rechazar comprobante</button>' : ''}
            </div>
          </form>`;
    return `<div class="tarjeta pila">
        <h3>Pago <span class="estado pago-${esc(p.pago_estado)}">${ESTADO_PAGO[p.pago_estado]}</span></h3>
        ${vista}${revisado}${acciones}
      </div>`;
  }

  // ---------- Papeles ----------
  async function cargarPapeles() {
    mostrar('vista-papeles');
    const papeles = await llamar('/admin/api/papeles');
    const esAdmin = usuario.rol === 'admin';
    const v = $('#vista-papeles');
    v.innerHTML = `<h1>Papeles y precios</h1>
      <p class="tenue">Los cambios de precio aplican solo a pedidos nuevos.${esAdmin ? '' : ' Solo un administrador puede modificarlos.'}</p>
      <div class="rejilla-3">${papeles
        .map((p) => `<form class="tarjeta pila" data-id="${p.id}">
          <h3>${esc(p.nombre)}</h3>
          <label>Descripción<input name="descripcion" value="${esc(p.descripcion || '')}" ${esAdmin ? '' : 'disabled'}></label>
          <label>Precio por m² (CLP)<input name="precio_m2" type="number" min="1" step="1" value="${p.precio_m2}" ${esAdmin ? '' : 'disabled'}></label>
          <label class="check"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''} ${esAdmin ? '' : 'disabled'}> Disponible para pedidos</label>
          ${esAdmin ? '<button class="boton boton-claro" type="submit">Guardar</button>' : ''}
        </form>`)
        .join('')}</div>`;
    v.querySelectorAll('form').forEach((f) =>
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await llamar(`/admin/api/papeles/${f.dataset.id}`, {
            method: 'PUT',
            body: { precio_m2: Number(f.precio_m2.value), descripcion: f.descripcion.value, activo: f.activo.checked },
          });
          aviso('Precio actualizado');
        } catch (e) {
          aviso(e.message);
        }
      })
    );
  }

  // ---------- Usuarios ----------
  function cargarUsuarios() {
    mostrar('vista-usuarios');
    const v = $('#vista-usuarios');
    v.innerHTML = `<h1>Nuevo usuario</h1>
      <form class="tarjeta pila login" id="form-usuario">
        <label>Nombre<input name="nombre" required></label>
        <label>Correo<input name="email" type="email" required></label>
        <label>Contraseña (mín. 10 caracteres)<input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
        <label>Rol<select name="rol"><option value="operador">Operador (gestiona pedidos)</option><option value="admin">Administrador (también precios y usuarios)</option></select></label>
        <button class="boton" type="submit">Crear usuario</button>
      </form>`;
    $('#form-usuario').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      if (!f.reportValidity()) return;
      try {
        await llamar('/admin/api/usuarios', {
          method: 'POST',
          body: { nombre: f.nombre.value, email: f.email.value, password: f.password.value, rol: f.rol.value },
        });
        aviso('Usuario creado');
        f.reset();
      } catch (e) {
        aviso(e.message);
      }
    });
  }

  // ---------- Equipos en préstamo ----------
  const ESTADO_UNIDAD = { disponible: 'Disponible', prestado: 'Prestado', mantencion: 'En mantención', baja: 'De baja' };
  const vistaEquipos = () => $('#vista-equipos');

  // Lee un formulario a un objeto; los checkbox quedan como true/false
  function datosForm(f) {
    const d = Object.fromEntries(new FormData(f));
    f.querySelectorAll('input[type=checkbox]').forEach((c) => (d[c.name] = c.checked));
    return d;
  }

  function enviar(f, fn) {
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!f.reportValidity()) return;
      try {
        await fn(datosForm(f), f);
      } catch (e) {
        aviso(e.message);
      }
    });
  }

  function camposEquipo(e, categorias, esAdmin) {
    const dis = esAdmin ? '' : 'disabled';
    return `
      <label>Categoría<select name="categoria_id" required ${dis}>${categorias
        .filter((c) => c.activo || c.id === e.categoria_id)
        .map((c) => `<option value="${c.id}" ${c.id === e.categoria_id ? 'selected' : ''}>${esc(c.nombre)}</option>`)
        .join('')}</select></label>
      <label>Nombre<input name="nombre" required maxlength="120" value="${esc(e.nombre || '')}" placeholder="Ej.: Notebook Lenovo ThinkPad" ${dis}></label>
      <label>Marca / modelo <small class="tenue">(opcional)</small><input name="marca_modelo" maxlength="120" value="${esc(e.marca_modelo || '')}" ${dis}></label>
      <label>Descripción <small class="tenue">(se mostrará en la web)</small><textarea name="descripcion" rows="2" maxlength="1000" ${dis}>${esc(e.descripcion || '')}</textarea></label>
      <label>Accesorios que se entregan<input name="accesorios" maxlength="500" value="${esc(e.accesorios || '')}" placeholder="Ej.: cargador, mouse, bolso" ${dis}></label>
      <label>Garantía que se deja<input name="garantia" maxlength="255" value="${esc(e.garantia || '')}" placeholder="Ej.: credencial UCT" ${dis}></label>
      <div class="form-grid">
        <label>Tarifa por día (CLP, 0 = sin costo)<input name="tarifa_dia_clp" type="number" min="0" step="1" required value="${e.tarifa_dia_clp ?? 0}" ${dis}></label>
        <label>Plazo máximo (días)<input name="dias_max" type="number" min="1" max="365" step="1" required value="${e.dias_max ?? 3}" ${dis}></label>
      </div>
      <label class="check"><input type="checkbox" name="activo" ${e.activo === 0 ? '' : 'checked'} ${dis}> Disponible para préstamo</label>`;
  }

  function camposUnidad(u, esAdmin) {
    const dis = esAdmin ? '' : 'disabled';
    return `
      <div class="form-grid">
        <label>N° de inventario<input name="inventario" required maxlength="40" value="${esc(u.inventario || '')}" ${dis}></label>
        <label>N° de serie <small class="tenue">(opcional)</small><input name="serie" maxlength="80" value="${esc(u.serie || '')}" ${dis}></label>
        <label>Ubicación <small class="tenue">(opcional)</small><input name="ubicacion" maxlength="120" value="${esc(u.ubicacion || '')}" placeholder="Ej.: estante 2" ${dis}></label>
        ${u.id ? `<label>Estado<select name="estado" ${dis || (u.estado === 'prestado' ? 'disabled' : '')}>${Object.entries(ESTADO_UNIDAD)
          .filter(([k]) => k !== 'prestado' || u.estado === 'prestado')
          .map(([k, v]) => `<option value="${k}" ${k === u.estado ? 'selected' : ''}>${v}</option>`)
          .join('')}</select></label>` : ''}
      </div>
      ${u.id ? `<label>Notas internas<textarea name="notas" rows="2" maxlength="1000" ${dis}>${esc(u.notas || '')}</textarea></label>` : ''}`;
  }

  async function cargarEquipos() {
    mostrar('vista-equipos');
    const esAdmin = usuario.rol === 'admin';
    const [lista, categorias] = await Promise.all([llamar('/admin/api/equipos'), llamar('/admin/api/equipos/categorias')]);
    const v = vistaEquipos();
    v.innerHTML = `<h1>Equipos en préstamo</h1>
      <form id="form-buscar-unidad" class="filtros"><input name="inventario" placeholder="Ir a una unidad por n° de inventario" required>
        <button class="boton boton-claro boton-sm" type="submit">Buscar</button></form>
      <div class="tabla-env">
        <table>
          <thead><tr><th>Equipo</th><th>Categoría</th><th>Unidades</th><th>Tarifa / día</th><th>Plazo</th><th>Estado</th></tr></thead>
          <tbody id="filas-equipos">${lista.length
            ? lista
                .map((e) => `<tr data-equipo="${e.id}">
                  <td><b>${esc(e.nombre)}</b>${e.marca_modelo ? `<br><small class="tenue">${esc(e.marca_modelo)}</small>` : ''}</td>
                  <td>${esc(e.categoria_nombre)}</td>
                  <td>${e.disponibles} disponible(s) de ${e.unidades}${e.prestadas ? ` · ${e.prestadas} prestada(s)` : ''}</td>
                  <td class="num">${e.tarifa_dia_clp ? clp(e.tarifa_dia_clp) : 'Sin costo'}</td>
                  <td>${e.dias_max} día(s)</td>
                  <td>${e.activo ? '<span class="estado unidad-disponible">Activo</span>' : '<span class="estado unidad-baja">Oculto</span>'}</td></tr>`)
                .join('')
            : '<tr><td colspan="6" class="tenue">Aún no hay equipos registrados.</td></tr>'}</tbody>
        </table>
      </div>
      ${esAdmin ? `<div class="detalle-grid inventario-alta">
        <form class="tarjeta pila" id="form-equipo-nuevo"><h3>Nuevo equipo</h3>${camposEquipo({}, categorias, true)}
          <button class="boton" type="submit">Crear equipo</button></form>
        <div class="tarjeta pila"><h3>Categorías</h3>
          <ul class="historial">${categorias
            .map((c) => `<li><form class="fila-categoria" data-id="${c.id}">
              <input name="nombre" value="${esc(c.nombre)}" maxlength="80" required aria-label="Nombre de la categoría">
              <label class="check"><input type="checkbox" name="activo" ${c.activo ? 'checked' : ''}> Activa</label>
              <button class="boton boton-claro boton-sm" type="submit">Guardar</button></form></li>`)
            .join('')}</ul>
          <form class="fila-categoria" id="form-categoria-nueva"><input name="nombre" maxlength="80" required placeholder="Nueva categoría, ej.: Cámaras">
            <button class="boton boton-sm" type="submit">Agregar</button></form>
        </div>
      </div>` : '<p class="tenue">Solo un administrador puede agregar o modificar equipos.</p>'}`;

    $('#filas-equipos').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-equipo]');
      if (tr) location.hash = `equipo/${tr.dataset.equipo}`;
    });
    enviar($('#form-buscar-unidad'), async (d) => {
      const u = await llamar(`/admin/api/unidades/buscar?${new URLSearchParams({ inventario: d.inventario })}`);
      location.hash = `unidad/${u.id}`;
    });
    if (!esAdmin) return;
    enviar($('#form-equipo-nuevo'), async (d) => {
      const r = await llamar('/admin/api/equipos', { method: 'POST', body: d });
      aviso('Equipo creado; ahora agregue sus unidades');
      location.hash = `equipo/${r.id}`;
    });
    v.querySelectorAll('form.fila-categoria[data-id]').forEach((f) =>
      enviar(f, async (d) => {
        await llamar(`/admin/api/equipos/categorias/${f.dataset.id}`, { method: 'PUT', body: d });
        aviso('Categoría guardada');
        cargarEquipos();
      })
    );
    enviar($('#form-categoria-nueva'), async (d) => {
      await llamar('/admin/api/equipos/categorias', { method: 'POST', body: { nombre: d.nombre, orden: categorias.length + 1 } });
      aviso('Categoría agregada');
      cargarEquipos();
    });
  }

  async function cargarEquipo(id) {
    mostrar('vista-equipos');
    const esAdmin = usuario.rol === 'admin';
    const [e, categorias] = await Promise.all([llamar(`/admin/api/equipos/${id}`), llamar('/admin/api/equipos/categorias')]);
    const v = vistaEquipos();
    v.innerHTML = `<a href="#equipos" class="volver">← Volver a equipos</a>
      <h1>${esc(e.nombre)}</h1>
      <div class="detalle-grid">
        <div class="pila">
          <div class="tarjeta pila">
            <h3>Unidades</h3>
            <div class="tabla-env"><table>
              <thead><tr><th>N° inventario</th><th>Serie</th><th>Ubicación</th><th>Estado</th></tr></thead>
              <tbody id="filas-unidades">${e.unidades.length
                ? e.unidades
                    .map((u) => `<tr data-unidad="${u.id}"><td><b>${esc(u.inventario)}</b></td><td>${esc(u.serie || '')}</td>
                      <td>${esc(u.ubicacion || '')}</td><td><span class="estado unidad-${esc(u.estado)}">${ESTADO_UNIDAD[u.estado]}</span></td></tr>`)
                    .join('')
                : '<tr><td colspan="4" class="tenue">Sin unidades. Agregue cada aparato con su n° de inventario.</td></tr>'}</tbody>
            </table></div>
            ${e.unidades.length ? `<p><a class="boton boton-claro" href="#etiquetas/equipo/${e.id}">Imprimir etiquetas QR</a></p>` : ''}
          </div>
          ${esAdmin ? `<form class="tarjeta pila" id="form-unidad-nueva"><h3>Agregar unidad</h3>${camposUnidad({}, true)}
            <button class="boton" type="submit">Agregar unidad</button></form>` : ''}
        </div>
        <form class="tarjeta pila" id="form-equipo"><h3>Datos del equipo</h3>${camposEquipo(e, categorias, esAdmin)}
          ${esAdmin ? '<button class="boton boton-claro" type="submit">Guardar cambios</button>' : ''}</form>
      </div>`;

    $('#filas-unidades').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-unidad]');
      if (tr) location.hash = `unidad/${tr.dataset.unidad}`;
    });
    if (!esAdmin) return;
    enviar($('#form-equipo'), async (d) => {
      await llamar(`/admin/api/equipos/${e.id}`, { method: 'PUT', body: d });
      aviso('Equipo guardado');
      cargarEquipo(e.id);
    });
    enviar($('#form-unidad-nueva'), async (d) => {
      await llamar(`/admin/api/equipos/${e.id}/unidades`, { method: 'POST', body: d });
      aviso(`Unidad ${d.inventario} agregada`);
      cargarEquipo(e.id);
    });
  }

  async function cargarUnidad(id) {
    mostrar('vista-equipos');
    const esAdmin = usuario.rol === 'admin';
    const u = await llamar(`/admin/api/unidades/${id}`);
    const v = vistaEquipos();
    v.innerHTML = `<a href="#equipo/${u.equipo_id}" class="volver">← Volver a ${esc(u.equipo_nombre)}</a>
      <h1>${esc(u.inventario)} <span class="estado unidad-${esc(u.estado)}">${ESTADO_UNIDAD[u.estado]}</span></h1>
      <p class="tenue">${esc(u.equipo_nombre)}${u.marca_modelo ? ` · ${esc(u.marca_modelo)}` : ''} · ${esc(u.categoria_nombre)}</p>
      <div class="detalle-grid">
        <form class="tarjeta pila" id="form-unidad"><h3>Ficha de la unidad</h3>${camposUnidad(u, esAdmin)}
          ${esAdmin ? '<button class="boton boton-claro" type="submit">Guardar cambios</button>' : ''}</form>
        <div class="tarjeta pila">
          <h3>Etiqueta QR</h3>
          <div class="qr-vista">${u.qr_svg}</div>
          <p class="tenue"><small>${esc(u.qr_url)}</small></p>
          <div class="acciones">
            <a class="boton" href="#etiquetas/unidad/${u.id}">Imprimir etiqueta</a>
            ${esAdmin ? '<button class="boton boton-claro" type="button" id="renovar-qr">Etiqueta perdida: generar QR nuevo</button>' : ''}
          </div>
        </div>
      </div>`;
    if (!esAdmin) return;
    enviar($('#form-unidad'), async (d) => {
      await llamar(`/admin/api/unidades/${u.id}`, { method: 'PUT', body: d });
      aviso('Unidad guardada');
      cargarUnidad(u.id);
    });
    $('#renovar-qr').addEventListener('click', async () => {
      if (!confirm('La etiqueta actual dejará de funcionar y habrá que imprimir y pegar una nueva. ¿Continuar?')) return;
      try {
        await llamar(`/admin/api/unidades/${u.id}/renovar-qr`, { method: 'POST', body: {} });
        aviso('QR nuevo generado; imprima la etiqueta');
        cargarUnidad(u.id);
      } catch (e) {
        aviso(e.message);
      }
    });
  }

  async function cargarEtiquetas(tipo, id) {
    mostrar('vista-equipos');
    const url = tipo === 'equipo' ? `/admin/api/equipos/${id}/etiquetas` : `/admin/api/unidades/${id}/etiqueta`;
    const lista = await llamar(url);
    const volver = tipo === 'equipo' ? `#equipo/${id}` : `#unidad/${id}`;
    vistaEquipos().innerHTML = `<div class="no-imprimir">
        <a href="${volver}" class="volver">← Volver</a>
        <h1>Etiquetas QR</h1>
        <p class="tenue">${lista.length} etiqueta(s). Se imprimen en hoja carta o A4; recorte y pegue cada una en su equipo.</p>
        <p><button class="boton" type="button" id="imprimir">Imprimir</button></p>
      </div>
      <div class="etiquetas">${lista
        .map((x) => `<div class="etiqueta">
          <div class="etiqueta-qr">${x.svg}</div>
          <div class="etiqueta-texto">
            <small>LPT · UCT</small>
            <b>${esc(x.inventario)}</b>
            <span>${esc(x.equipo_nombre)}</span>
          </div></div>`)
        .join('')}</div>`;
    $('#imprimir').addEventListener('click', () => window.print());
  }

  // Desde la página pública del QR ("Soy del LPT"): el token lleva a la ficha
  async function abrirQr(token) {
    const u = await llamar(`/admin/api/unidades/buscar?${new URLSearchParams({ qr: token })}`);
    location.replace(`#unidad/${u.id}`);
  }

  // ---------- Solicitudes de préstamo ----------
  const ESTADO_PRESTAMO = { solicitado: 'Solicitado', aprobado: 'Aceptado', rechazado: 'Rechazado', cancelado: 'Cancelado', entregado: 'Entregado', devuelto: 'Devuelto' };
  const TIPO_SOLICITANTE = { estudiante: 'Estudiante', academico: 'Académico/a' };
  let filtroPrestamo = 'solicitado';

  const rangoFechas = (p) => (p.fecha_desde === p.fecha_hasta ? fecha(p.fecha_desde) : `${fecha(p.fecha_desde)} al ${fecha(p.fecha_hasta)}`);

  async function cargarPrestamos() {
    mostrar('vista-prestamos');
    const v = $('#vista-prestamos');
    const q = $('#buscar-prestamo')?.value || '';
    const [resumen, lista] = await Promise.all([
      llamar('/admin/api/prestamos/resumen'),
      llamar(`/admin/api/prestamos?${new URLSearchParams({ estado: filtroPrestamo, q })}`),
    ]);
    v.innerHTML = `<h1>Préstamos de equipos</h1>
      <div class="resumen resumen-6">${resumen
        .map((e) => `<button type="button" data-estado="${esc(e.codigo)}" aria-pressed="${filtroPrestamo === e.codigo}">
          <span class="estado prestamo-${esc(e.codigo)}">${esc(e.nombre)}</span><b>${e.cantidad}</b></button>`)
        .join('')}</div>
      <div class="filtros">
        <input type="search" id="buscar-prestamo" placeholder="Buscar por código, nombre, RUT, correo o n° de inventario" value="${esc(q)}">
      </div>
      <div class="tabla-env"><table>
        <thead><tr><th>Código</th><th>Solicitante</th><th>Equipo</th><th>Fechas</th><th>Retiro</th><th>Estado</th></tr></thead>
        <tbody id="filas-prestamos">${lista.length
          ? lista
              .map((p) => `<tr data-prestamo="${p.id}">
                <td><b>${esc(p.codigo)}</b><br><small class="tenue">${esc(fechaHora(p.creado_en))}</small></td>
                <td>${esc(p.solicitante_nombre)}<br><small class="tenue">${esc(TIPO_SOLICITANTE[p.solicitante_tipo])} · ${esc(p.solicitante_unidad)}</small></td>
                <td>${esc(p.equipo_nombre)}${p.unidad_inventario ? `<br><small class="tenue">n° ${esc(p.unidad_inventario)}</small>` : ''}</td>
                <td>${esc(rangoFechas(p))}</td>
                <td>${p.retiro_en ? esc(fechaHora(p.retiro_en)) : ''}</td>
                <td><span class="estado prestamo-${esc(p.estado)}">${ESTADO_PRESTAMO[p.estado]}</span></td></tr>`)
              .join('')
          : '<tr><td colspan="6" class="tenue">No hay préstamos con este filtro.</td></tr>'}</tbody>
      </table></div>`;

    v.querySelector('.resumen').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-estado]');
      if (!b) return;
      filtroPrestamo = filtroPrestamo === b.dataset.estado ? '' : b.dataset.estado;
      cargarPrestamos();
    });
    const buscar = $('#buscar-prestamo');
    buscar.addEventListener('input', () => {
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(() => cargarPrestamos().then(() => {
        const b = $('#buscar-prestamo');
        b.focus();
        b.setSelectionRange(b.value.length, b.value.length);
      }), 300);
    });
    $('#filas-prestamos').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-prestamo]');
      if (tr) location.hash = `prestamo/${tr.dataset.prestamo}`;
    });
  }

  async function cargarPrestamo(id) {
    mostrar('vista-prestamos');
    const v = $('#vista-prestamos');
    v.innerHTML = '<p class="tenue">Cargando…</p>';
    const p = await llamar(`/admin/api/prestamos/${id}`);
    // Propuesta de retiro: el día pedido a las 10:00
    const retiroSugerido = `${p.fecha_desde}T10:00`;
    const acciones =
      p.estado === 'solicitado'
        ? `<form class="tarjeta pila" id="form-aprobar">
            <h3>Aceptar solicitud</h3>
            ${p.unidades_libres.length
              ? `<label>Unidad a entregar<select name="unidad_id" required>${p.unidades_libres
                  .map((u) => `<option value="${u.id}">${esc(u.inventario)}${u.ubicacion ? ` · ${esc(u.ubicacion)}` : ''}</option>`)
                  .join('')}</select></label>`
              : '<p class="error">No hay unidades libres en esas fechas: rechace la solicitud o libere una unidad.</p>'}
            <div class="form-grid">
              <label>Retiro (día y hora)<input name="retiro_en" type="datetime-local" required value="${esc(retiroSugerido)}" max="${esc(p.fecha_desde)}T23:59"></label>
              <label>Lugar<input name="retiro_lugar" maxlength="160" value="${esc(p.lugar_retiro)}"></label>
            </div>
            <label>Comentario para el solicitante <small class="tenue">(opcional)</small><textarea name="comentario" rows="2" maxlength="500"></textarea></label>
            <button class="boton" type="submit" ${p.unidades_libres.length ? '' : 'disabled'}>Aceptar y avisar por correo</button>
          </form>`
        : '';
    const rechazo = ['solicitado', 'aprobado'].includes(p.estado)
      ? `<form class="tarjeta pila" id="form-rechazar">
          <h3>${p.estado === 'solicitado' ? 'Rechazar solicitud' : 'Anular préstamo aceptado'}</h3>
          <label>Motivo <small class="tenue">(lo recibe el solicitante)</small><textarea name="comentario" rows="2" maxlength="500" required></textarea></label>
          <button class="boton boton-peligro" type="submit">${p.estado === 'solicitado' ? 'Rechazar' : 'Anular'} y avisar por correo</button>
        </form>`
      : '';
    v.innerHTML = `<a href="#prestamos" class="volver">← Volver a préstamos</a>
      <h1>${esc(p.codigo)} <span class="estado prestamo-${esc(p.estado)}">${ESTADO_PRESTAMO[p.estado]}</span></h1>
      <p class="tenue">Solicitado el ${esc(fechaHora(p.creado_en))}</p>
      <div class="detalle-grid">
        <div class="pila">
          <div class="tarjeta">
            <h3>Préstamo</h3>
            <dl class="detalle">
              <dt>Equipo</dt><dd><a href="#equipo/${p.equipo_id}">${esc(p.equipo_nombre)}</a>${p.marca_modelo ? ` · ${esc(p.marca_modelo)}` : ''}</dd>
              ${p.unidad_inventario ? `<dt>Unidad</dt><dd><a href="#unidad/${p.unidad_id}">${esc(p.unidad_inventario)}</a></dd>` : ''}
              <dt>Fechas</dt><dd>${esc(rangoFechas(p))} (${p.dias} día${p.dias > 1 ? 's' : ''})</dd>
              <dt>Costo</dt><dd>${p.total_clp ? `${clp(p.total_clp)} (${clp(p.tarifa_dia_clp)}/día)` : 'Sin costo'}</dd>
              ${p.garantia ? `<dt>Garantía</dt><dd>${esc(p.garantia)}</dd>` : ''}
              ${p.retiro_en ? `<dt>Retiro</dt><dd>${esc(fechaHora(p.retiro_en))} · ${esc(p.retiro_lugar)}</dd>` : ''}
              ${p.comentario_lpt ? `<dt>Comentario LPT</dt><dd>${esc(p.comentario_lpt)}</dd>` : ''}
              <dt>Motivo</dt><dd>${esc(p.motivo)}</dd>
            </dl>
          </div>
          <div class="tarjeta">
            <h3>Solicitante</h3>
            <dl class="detalle">
              <dt>Nombre</dt><dd>${esc(p.solicitante_nombre)}</dd>
              <dt>RUT</dt><dd>${esc(p.solicitante_rut)}</dd>
              <dt>Tipo</dt><dd>${esc(TIPO_SOLICITANTE[p.solicitante_tipo])} · ${esc(p.solicitante_unidad)}</dd>
              <dt>Correo</dt><dd><a href="mailto:${esc(p.solicitante_email)}?subject=${encodeURIComponent('Préstamo ' + p.codigo)}">${esc(p.solicitante_email)}</a></dd>
              <dt>Teléfono</dt><dd>${esc(p.solicitante_telefono)}</dd>
            </dl>
          </div>
        </div>
        <div class="pila">
          ${acciones}${rechazo}
          <div class="tarjeta">
            <h3>Historial</h3>
            <ul class="historial">${p.movimientos
              .map((m) => `<li><b>${esc(ESTADO_PRESTAMO[m.tipo] || m.tipo)}</b> · ${esc(fechaHora(m.creado_en))}${m.usuario ? ` · ${esc(m.usuario)}` : ''}${m.comentario ? `<br><span class="tenue">${esc(m.comentario)}</span>` : ''}</li>`)
              .join('')}</ul>
          </div>
        </div>
      </div>`;

    const fa = $('#form-aprobar');
    if (fa) {
      enviar(fa, async (d) => {
        await llamar(`/admin/api/prestamos/${p.id}/aprobar`, { method: 'POST', body: d });
        aviso('Solicitud aceptada; se avisó al solicitante');
        cargarPrestamo(p.id);
      });
    }
    const fr = $('#form-rechazar');
    if (fr) {
      enviar(fr, async (d) => {
        await llamar(`/admin/api/prestamos/${p.id}/rechazar`, { method: 'POST', body: d });
        aviso(p.estado === 'solicitado' ? 'Solicitud rechazada; se avisó al solicitante' : 'Préstamo anulado; se avisó al solicitante');
        cargarPrestamo(p.id);
      });
    }
  }

  // ---------- Rutas ----------
  function enrutar() {
    if (!usuario) return mostrar('vista-login');
    const h = location.hash.slice(1);
    let m;
    let accion;
    if ((m = /^pedido\/(\d+)$/.exec(h))) accion = cargarDetalle(m[1]);
    else if (h === 'papeles') accion = cargarPapeles();
    else if (h === 'usuarios') accion = cargarUsuarios();
    else if (h === 'prestamos') accion = cargarPrestamos();
    else if ((m = /^prestamo\/(\d+)$/.exec(h))) accion = cargarPrestamo(m[1]);
    else if (h === 'equipos') accion = cargarEquipos();
    else if ((m = /^equipo\/(\d+)$/.exec(h))) accion = cargarEquipo(m[1]);
    else if ((m = /^unidad\/(\d+)$/.exec(h))) accion = cargarUnidad(m[1]);
    else if ((m = /^etiquetas\/(equipo|unidad)\/(\d+)$/.exec(h))) accion = cargarEtiquetas(m[1], m[2]);
    else if ((m = /^qr\/([\w-]{12})$/.exec(h))) accion = abrirQr(m[1]);
    else accion = cargarLista();
    Promise.resolve(accion).catch((e) => e.status !== 401 && aviso(e.message));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('#vista-login').addEventListener('submit', iniciarSesion);
    $('#salir').addEventListener('click', async () => {
      await api('/admin/api/logout', { method: 'POST', body: {} }).catch(() => {});
      usuario = null;
      mostrar('vista-login');
    });
    $('#refrescar').addEventListener('click', () => cargarLista());
    $('#buscar').addEventListener('input', () => {
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(cargarLista, 300);
    });
    $('#resumen').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-estado], button[data-pago]');
      if (!b) return;
      if (b.dataset.pago) filtroPago = filtroPago === b.dataset.pago ? '' : b.dataset.pago;
      else filtroEstado = filtroEstado === b.dataset.estado ? '' : b.dataset.estado;
      cargarLista();
    });
    $('#filas').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (tr) location.hash = `pedido/${tr.dataset.id}`;
    });
    window.addEventListener('hashchange', enrutar);

    try {
      usuario = await api('/admin/api/me');
      await arrancar();
    } catch {
      mostrar('vista-login');
    }
  });
})();
