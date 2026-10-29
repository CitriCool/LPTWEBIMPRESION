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
  const VISTAS = ['vista-login', 'vista-lista', 'vista-detalle', 'vista-papeles', 'vista-usuarios'];
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

  // ---------- Rutas ----------
  function enrutar() {
    if (!usuario) return mostrar('vista-login');
    const h = location.hash.slice(1);
    const m = /^pedido\/(\d+)$/.exec(h);
    const accion = m ? cargarDetalle(m[1]) : h === 'papeles' ? cargarPapeles() : h === 'usuarios' ? cargarUsuarios() : cargarLista();
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
