'use strict';

(() => {
  const { api, clp, esc, fecha } = window.LPT;
  const $ = (s, r = document) => r.querySelector(s);

  let equipos = [];
  let reglas = null;
  let temporizador;

  const sumarDias = (f, n) => {
    const d = new Date(`${f}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const rango = (desde, hasta) => (desde === hasta ? fecha(desde) : `${fecha(desde)} al ${fecha(hasta)}`);
  const horaRetiro = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const tarifa = (e) => (e.tarifa_dia_clp ? `${clp(e.tarifa_dia_clp)} por día` : 'Sin costo');

  // ---------- Catálogo ----------
  async function cargarCatalogo() {
    const r = await api('/api/prestamos/catalogo');
    equipos = r.equipos;
    reglas = r.reglas;
    document.querySelectorAll('.js-dominios').forEach((el) => (el.textContent = reglas.dominios.map((d) => '@' + d).join(' o ')));

    const f = $('#form-prestamo');
    f.desde.min = f.hasta.min = reglas.hoy;
    f.desde.max = f.hasta.max = sumarDias(reglas.hoy, reglas.anticipacionMaxDias);
    f.equipo_id.innerHTML = '<option value="">Seleccione…</option>' +
      equipos.map((e) => `<option value="${e.id}">${esc(e.nombre)}${e.marca_modelo ? ` · ${esc(e.marca_modelo)}` : ''}</option>`).join('');

    if (!equipos.length) {
      $('#catalogo').innerHTML = '<p class="tenue">Por ahora no hay equipos disponibles para préstamo.</p>';
      return;
    }
    const categorias = [...new Set(equipos.map((e) => e.categoria_nombre))];
    $('#catalogo').innerHTML = categorias
      .map((c) => `<h3 class="categoria">${esc(c)}</h3>
        <div class="rejilla-3">${equipos
          .filter((e) => e.categoria_nombre === c)
          .map((e) => `<article class="tarjeta equipo">
            <h4>${esc(e.nombre)}</h4>
            ${e.marca_modelo ? `<p class="tenue">${esc(e.marca_modelo)}</p>` : ''}
            ${e.descripcion ? `<p>${esc(e.descripcion)}</p>` : ''}
            <dl class="detalle">
              <dt>Plazo máximo</dt><dd>${e.dias_max} día(s)</dd>
              <dt>Costo</dt><dd>${tarifa(e)}</dd>
              ${e.accesorios ? `<dt>Incluye</dt><dd>${esc(e.accesorios)}</dd>` : ''}
              ${e.garantia ? `<dt>Garantía</dt><dd>${esc(e.garantia)}</dd>` : ''}
              <dt>Unidades</dt><dd>${e.unidades}</dd>
            </dl>
            <button class="boton boton-claro boton-sm" type="button" data-equipo="${e.id}">Solicitar</button>
          </article>`)
          .join('')}</div>`)
      .join('');
  }

  // ---------- Formulario ----------
  function equipoElegido() {
    return equipos.find((e) => String(e.id) === $('#form-prestamo').equipo_id.value);
  }

  function mostrarEquipo() {
    const e = equipoElegido();
    const garantia = $('#condicion-garantia');
    $('#info-equipo').textContent = e
      ? `Plazo máximo ${e.dias_max} día(s) · ${tarifa(e)}${e.accesorios ? ` · incluye ${e.accesorios}` : ''}`
      : '';
    garantia.hidden = !e?.garantia;
    garantia.textContent = e?.garantia ? `Al retirar dejo como garantía: ${e.garantia}.` : '';
  }

  async function revisarDisponibilidad() {
    const f = $('#form-prestamo');
    const out = $('#resultado-prestamo');
    const e = equipoElegido();
    if (f.desde.value && !f.hasta.value) f.hasta.value = f.desde.value;
    if (!e || !f.desde.value || !f.hasta.value) {
      out.innerHTML = '<span class="tenue">Elige el equipo y las fechas para ver la disponibilidad.</span>';
      return;
    }
    try {
      const r = await api(`/api/prestamos/disponibilidad?${new URLSearchParams({ equipo: e.id, desde: f.desde.value, hasta: f.hasta.value })}`);
      if (r.error) {
        out.innerHTML = `<span class="error">${esc(r.error)}</span>`;
      } else if (!r.disponibles) {
        out.innerHTML = '<span class="error">No quedan unidades libres en esas fechas. Prueba con otras.</span>';
      } else {
        out.innerHTML = `<span class="monto">${r.total_clp ? clp(r.total_clp) : 'Sin costo'}</span>
          <span class="tenue">${r.dias} día(s) · ${r.disponibles} unidad(es) libre(s) · ${esc(rango(f.desde.value, f.hasta.value))}</span>`;
      }
    } catch (err) {
      out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
    }
  }

  function mostrarErrores(err) {
    const caja = $('#errores-prestamo');
    const lista = err.errores ? Object.values(err.errores) : [err.message];
    caja.innerHTML = lista.length > 1 ? `<ul>${lista.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : esc(lista[0]);
    caja.hidden = false;
    for (const campo of Object.keys(err.errores || {})) $(`#form-prestamo [name="${campo}"]`)?.setAttribute('aria-invalid', 'true');
    caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function enviar(ev) {
    ev.preventDefault();
    const f = ev.currentTarget;
    const boton = f.querySelector('button[type="submit"]');
    $('#errores-prestamo').hidden = true;
    f.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    if (!f.reportValidity()) return;

    const datos = Object.fromEntries(new FormData(f));
    datos.acepta = f.acepta.checked;
    boton.disabled = true;
    boton.textContent = 'Enviando…';
    try {
      const r = await api('/api/prestamos', { method: 'POST', body: datos });
      mostrarConfirmacion(r, equipoElegido());
    } catch (err) {
      mostrarErrores(err);
    } finally {
      boton.disabled = false;
      boton.textContent = 'Enviar solicitud';
    }
  }

  function mostrarConfirmacion(r, e) {
    const f = $('#form-prestamo');
    f.hidden = true;
    const c = $('#confirmacion');
    c.innerHTML = `
      <p class="sobretitulo">Solicitud recibida</p>
      <h3 class="codigo">${esc(r.codigo)}</h3>
      <p>Te enviamos la confirmación a <b>${esc(r.email)}</b>. El equipo del LPT revisará tu solicitud y te avisará por correo
      si fue aceptada, con el día, la hora y el lugar de retiro.</p>
      <dl class="detalle">
        <dt>Equipo</dt><dd>${esc(e?.nombre || '')}</dd>
        <dt>Fechas</dt><dd>${esc(rango(f.desde.value, f.hasta.value))}</dd>
      </dl>
      <button class="boton boton-claro" type="button" id="nueva-solicitud">Hacer otra solicitud</button>`;
    c.hidden = false;
    c.focus();
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#nueva-solicitud').addEventListener('click', () => {
      f.reset();
      mostrarEquipo();
      revisarDisponibilidad();
      c.hidden = true;
      f.hidden = false;
    });
  }

  // ---------- Mi préstamo ----------
  function mostrarPrestamo(p) {
    const out = $('#resultado-consulta');
    const retiro = p.retiro_en
      ? `<span><b>Retiro:</b> ${esc(horaRetiro.format(new Date(p.retiro_en)))} hrs · ${esc(p.retiro_lugar)}${p.garantia ? ` · lleva ${esc(p.garantia)}` : ''}</span>`
      : '';
    const motivo = ['rechazado', 'cancelado'].includes(p.estado) && p.comentario_lpt ? `<span><b>Motivo:</b> ${esc(p.comentario_lpt)}</span>` : '';
    out.innerHTML = `<span><span class="estado prestamo-${esc(p.estado)}">${esc(p.estado_nombre)}</span> <b>${esc(p.codigo)}</b></span>
      <span class="tenue">${esc(p.equipo)}${p.inventario ? ` (n° ${esc(p.inventario)})` : ''} · ${esc(rango(p.fecha_desde, p.fecha_hasta))} · ${p.total_clp ? clp(p.total_clp) : 'sin costo'}</span>
      ${retiro}${motivo}
      ${p.estado === 'solicitado' ? '<span class="tenue">El LPT aún está revisando tu solicitud.</span>' : ''}
      ${p.cancelable ? '<span><button class="boton boton-claro boton-sm" type="button" id="cancelar-prestamo">Ya no lo necesito: cancelar</button></span>' : ''}`;
    $('#cancelar-prestamo')?.addEventListener('click', cancelar);
  }

  function datosConsulta() {
    const f = $('#form-consulta');
    return { codigo: f.codigo.value, email: f.email.value };
  }

  async function consultar(ev) {
    ev?.preventDefault();
    const f = $('#form-consulta');
    if (!f.reportValidity()) return;
    const out = $('#resultado-consulta');
    out.innerHTML = '<span class="tenue">Buscando…</span>';
    try {
      mostrarPrestamo(await api('/api/prestamos/consulta', { method: 'POST', body: datosConsulta() }));
    } catch (err) {
      out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
    }
  }

  async function cancelar() {
    if (!confirm('¿Cancelar este préstamo? El equipo quedará libre para otra persona.')) return;
    try {
      mostrarPrestamo(await api('/api/prestamos/cancelar', { method: 'POST', body: datosConsulta() }));
    } catch (err) {
      $('#resultado-consulta').insertAdjacentHTML('beforeend', `<span class="error">${esc(err.message)}</span>`);
    }
  }

  /** El enlace del correo trae ?codigo=…&email=…: se completa y consulta solo. */
  function consultaDesdeEnlace() {
    const q = new URLSearchParams(location.search);
    if (!q.get('codigo') || !q.get('email')) return;
    const f = $('#form-consulta');
    f.codigo.value = q.get('codigo');
    f.email.value = q.get('email');
    consultar();
  }

  // ---------- Inicio ----------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await cargarCatalogo();
    } catch {
      $('#catalogo').innerHTML = '<p class="error">No se pudo cargar la información. Recarga la página.</p>';
      return;
    }
    const f = $('#form-prestamo');
    f.equipo_id.addEventListener('change', () => {
      mostrarEquipo();
      revisarDisponibilidad();
    });
    f.desde.addEventListener('change', () => {
      if (f.hasta.value && f.hasta.value < f.desde.value) f.hasta.value = f.desde.value;
      f.hasta.min = f.desde.value || reglas.hoy;
      revisarDisponibilidad();
    });
    f.hasta.addEventListener('change', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(revisarDisponibilidad, 150);
    });
    f.addEventListener('submit', enviar);

    $('#catalogo').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-equipo]');
      if (!b) return;
      f.equipo_id.value = b.dataset.equipo;
      mostrarEquipo();
      revisarDisponibilidad();
      $('#solicitar').scrollIntoView({ behavior: 'smooth' });
    });

    $('#form-consulta').addEventListener('submit', consultar);
    consultaDesdeEnlace();
  });
})();
