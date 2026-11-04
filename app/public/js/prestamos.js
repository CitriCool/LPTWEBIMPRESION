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

  // ---------- Disponibilidad por día ----------
  const DIAS_VISTA = 35; // 5 semanas
  const lunes = (f) => sumarDias(f, -((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7));
  const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5) + 1;
  const fechaCorta = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
  const corta = (d) => fechaCorta.format(new Date(`${d}T12:00:00`));
  let ocupacion = null; // { equipo, desde, dias: [...] }
  let semanaInicial = 0;
  // Modo «uno» (un solo día) o «varios»: en «varios» el 1.er toque marca el retiro
  // y el 2.º la devolución.
  let modo = 'uno';
  let esperandoFin = false;
  const permiteVarios = () => (equipoElegido()?.dias_max || 2) > 1;

  async function cargarOcupacion() {
    const caja = $('#ocupacion-equipo');
    const e = equipoElegido();
    if (!e) {
      ocupacion = null;
      caja.hidden = true;
      return;
    }
    const desde = sumarDias(lunes(reglas.hoy), semanaInicial * 7);
    try {
      const r = await api(`/api/prestamos/ocupacion?${new URLSearchParams({ equipo: e.id, desde, dias: DIAS_VISTA })}`);
      if (equipoElegido()?.id !== e.id) return; // cambió el equipo mientras tanto
      ocupacion = { equipo: e.id, ...r };
      pintarOcupacion();
    } catch {
      caja.hidden = true;
    }
  }

  /**
   * Último día que se puede elegir como devolución mientras se espera el 2.º toque:
   * respeta el plazo máximo del equipo, la anticipación máxima y se corta antes del
   * primer día sin cupo (el préstamo debe ser continuo).
   */
  function limiteDevolucion(desde) {
    const e = equipoElegido();
    let limite = sumarDias(reglas.hoy, reglas.anticipacionMaxDias);
    if (e?.dias_max) limite = [limite, sumarDias(desde, e.dias_max - 1)].sort()[0];
    for (const { fecha: d, libres } of ocupacion?.ocupacion || []) {
      if (d > desde && d <= limite && libres === 0) return sumarDias(d, -1);
    }
    return limite;
  }

  function pintarOcupacion() {
    const caja = $('#ocupacion-equipo');
    if (!ocupacion) return;
    const f = $('#form-prestamo');
    const e = equipoElegido();
    const max = sumarDias(reglas.hoy, reglas.anticipacionMaxDias);
    const ultimaSemana = Math.floor(reglas.anticipacionMaxDias / 7);
    const desde = f.desde.value;
    const hasta = f.hasta.value || desde;
    const limite = esperandoFin && desde ? limiteDevolucion(desde) : null;
    const dias = ocupacion.ocupacion
      .map(({ fecha: d, libres }) => {
        const fuera = d < reglas.hoy || d > max;
        const pasaLimite = limite && d > limite;
        const tono = libres === 0 ? 'tono-rojo' : libres < ocupacion.unidades ? 'tono-amarillo' : 'tono-verde';
        const texto = libres === 0 ? 'Sin cupo' : `${libres} libre${libres > 1 ? 's' : ''}`;
        // En el celular solo cabe el número
        const corto = libres === 0 ? '0<span class="sufijo"> · sin cupo</span>' : `${libres}<span class="sufijo"> libre${libres > 1 ? 's' : ''}</span>`;
        const clases = ['dia-ocupacion'];
        if (!fuera) clases.push(tono);
        if (desde && desde <= d && d <= hasta) clases.push('en-rango');
        if (d === desde) clases.push('rango-inicio');
        if (d === hasta && desde) clases.push('rango-fin');
        if (d === reglas.hoy) clases.push('es-hoy');
        if (pasaLimite) clases.push('fuera-limite');
        const motivo = fuera ? 'fuera de plazo' : pasaLimite && libres ? `supera el plazo máximo de ${e?.dias_max} día(s) o hay un día sin cupo antes` : texto;
        return `<button type="button" class="${clases.join(' ')}"
          data-fecha="${d}" ${fuera || libres === 0 || pasaLimite ? 'disabled' : ''} title="${esc(fecha(d))}: ${esc(motivo)}"
          aria-pressed="${desde && desde <= d && d <= hasta ? 'true' : 'false'}">
          <b>${Number(d.slice(8))}</b><small>${fuera ? '' : corto}</small></button>`;
      })
      .join('');
    caja.innerHTML = `<div class="titulo-acciones">
        <b>Disponibilidad de ${esc(e?.nombre || '')} · ${esc(fecha(ocupacion.desde))} al ${esc(fecha(ocupacion.hasta))}</b>
        <span class="filtros cal-nav">
          <button type="button" class="boton boton-claro boton-sm" data-semanas="-${DIAS_VISTA / 7}" ${semanaInicial <= 0 ? 'disabled' : ''}>← Anteriores</button>
          <button type="button" class="boton boton-claro boton-sm" data-semanas="${DIAS_VISTA / 7}" ${semanaInicial + DIAS_VISTA / 7 > ultimaSemana ? 'disabled' : ''}>Siguientes →</button>
        </span></div>
      ${selectorModo()}
      ${resumenSeleccion()}
      <div class="ocupacion-semana">${['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'].map((x) => `<span>${x}</span>`).join('')}${dias}</div>
      <p class="cal-leyenda">
        <span class="muestra tono-verde"></span> Libre
        <span class="muestra tono-amarillo"></span> Quedan pocas
        <span class="muestra tono-rojo"></span> Sin cupo
        <span class="muestra muestra-elegido"></span> Tus días
      </p>
      <p class="tenue cal-nota">El número de cada día indica las unidades libres. Pueden cambiar hasta que el LPT acepte tu solicitud.</p>`;
    caja.hidden = false;
  }

  /** Dos opciones: un día o varios días. */
  function selectorModo() {
    const e = equipoElegido();
    const varios = permiteVarios();
    const opcion = (valor, titulo, detalle, deshabilitada) => `<button type="button" class="modo-opcion${modo === valor ? ' activo' : ''}"
        data-modo="${valor}" role="radio" aria-checked="${modo === valor}" ${deshabilitada ? 'disabled' : ''}>
        <span class="modo-marca" aria-hidden="true"></span>
        <span><b>${titulo}</b><small>${detalle}</small></span></button>`;
    return `<div class="modo-dias" role="radiogroup" aria-label="¿Cuántos días necesitas el equipo?">
      ${opcion('uno', 'Un día', 'Lo retiras y devuelves el mismo día')}
      ${opcion('varios', 'Varios días', varios ? `Eliges retiro y devolución (máx. ${e?.dias_max} días)` : 'Este equipo se presta por un solo día', !varios)}
    </div>`;
  }

  /** Instrucción del paso actual + resumen de los días elegidos. */
  function resumenSeleccion() {
    const f = $('#form-prestamo');
    const e = equipoElegido();
    const desde = f.desde.value;
    const hasta = f.hasta.value || desde;
    const plazo = e?.dias_max ? ` (máximo ${e.dias_max} día${e.dias_max > 1 ? 's' : ''})` : '';
    const limpiar = '<button type="button" class="boton boton-claro boton-sm" data-limpiar>Limpiar</button>';
    if (modo === 'uno') {
      if (!desde) {
        return `<div class="seleccion-dias">
          <span class="paso">1</span>
          <div><b>Toca el día en que necesitas el equipo.</b>
          <span class="tenue">¿Lo necesitas más de un día? Elige «Varios días» arriba.</span></div>
        </div>`;
      }
      return `<div class="seleccion-dias lista">
        <span class="paso">✓</span>
        <div><b>${esc(corta(desde))} · 1 día</b>
        <span class="tenue">Toca otro día para cambiarlo.</span></div>
        ${limpiar}
      </div>`;
    }
    if (!desde) {
      return `<div class="seleccion-dias">
        <span class="paso">1</span>
        <div><b>Toca el día en que retiras el equipo.</b>
        <span class="tenue">Luego toca el día de devolución${plazo}.</span></div>
      </div>`;
    }
    if (esperandoFin) {
      return `<div class="seleccion-dias activa">
        <span class="paso">2</span>
        <div><b>Retiro: ${esc(corta(desde))}. Ahora toca el día de devolución${plazo}.</b>
        <span class="tenue">Puedes tocar días hasta el ${esc(corta(limiteDevolucion(desde)))}.</span></div>
        ${limpiar}
      </div>`;
    }
    const n = diasEntre(desde, hasta);
    const texto = desde === hasta ? `Solo el ${esc(corta(desde))}` : `Del ${esc(corta(desde))} al ${esc(corta(hasta))}`;
    return `<div class="seleccion-dias lista">
      <span class="paso">✓</span>
      <div><b>${texto} · ${n} día${n > 1 ? 's' : ''}</b>
      <span class="tenue">Toca otro día para empezar una nueva selección.</span></div>
      ${limpiar}
    </div>`;
  }

  /** Vista previa del rango al pasar el mouse mientras se espera la devolución. */
  function previsualizar(d) {
    const f = $('#form-prestamo');
    const desde = f.desde.value;
    $('#ocupacion-equipo').querySelectorAll('.dia-ocupacion').forEach((b) => {
      const x = b.dataset.fecha;
      b.classList.toggle('previa', Boolean(esperandoFin && d && desde && d > desde && x > desde && x <= d));
    });
  }

  function elegirDia(d) {
    const f = $('#form-prestamo');
    if (modo === 'uno') {
      f.desde.value = f.hasta.value = d;
      esperandoFin = false;
    } else if (!esperandoFin || !f.desde.value || d < f.desde.value) {
      f.desde.value = f.hasta.value = d;
      esperandoFin = true;
    } else {
      f.hasta.value = d;
      esperandoFin = false;
    }
    f.hasta.min = f.desde.value;
    revisarDisponibilidad();
  }

  function cambiarModo(nuevo) {
    const f = $('#form-prestamo');
    if (nuevo === 'varios' && !permiteVarios()) nuevo = 'uno';
    modo = nuevo;
    if (modo === 'uno') {
      if (f.desde.value) f.hasta.value = f.desde.value;
      esperandoFin = false;
    } else {
      // Con el retiro ya elegido, el próximo toque es la devolución
      esperandoFin = Boolean(f.desde.value);
    }
    revisarDisponibilidad();
  }

  function limpiarDias() {
    const f = $('#form-prestamo');
    f.desde.value = f.hasta.value = '';
    f.hasta.min = reglas.hoy;
    esperandoFin = false;
    revisarDisponibilidad();
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
    pintarOcupacion();
    if (!e || !f.desde.value || !f.hasta.value) {
      out.innerHTML = '<span class="tenue">Elige el equipo y las fechas para ver la disponibilidad.</span>';
      return;
    }
    if (esperandoFin) {
      out.innerHTML = '<span class="tenue">Falta el día de devolución: tócalo en el calendario (o toca de nuevo el día de retiro si es solo uno).</span>';
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
      esperandoFin = false;
      modo = 'uno';
      mostrarEquipo();
      cargarOcupacion();
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
      ${p.cancelable && p.con_enlace ? '<span><button class="boton boton-claro boton-sm" type="button" id="cancelar-prestamo">Ya no lo necesito: cancelar</button></span>' : ''}
      ${p.cancelable && !p.con_enlace ? '<span class="tenue">Para cancelar, abre el enlace «Ver mi préstamo» del correo que te enviamos.</span>' : ''}`;
    $('#cancelar-prestamo')?.addEventListener('click', cancelar);
  }

  // Token del enlace del correo: permite cancelar
  let tokenPrestamo = null;

  function datosConsulta() {
    const f = $('#form-consulta');
    return { codigo: f.codigo.value, email: f.email.value, token: tokenPrestamo };
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
    tokenPrestamo = q.get('t');
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
      if (!permiteVarios()) cambiarModo('uno');
      semanaInicial = 0;
      cargarOcupacion();
      revisarDisponibilidad();
    });
    $('#ocupacion-equipo').addEventListener('click', (ev) => {
      const nav = ev.target.closest('button[data-semanas]');
      if (nav) {
        semanaInicial = Math.max(0, semanaInicial + Number(nav.dataset.semanas));
        cargarOcupacion();
        return;
      }
      if (ev.target.closest('button[data-limpiar]')) return limpiarDias();
      const m = ev.target.closest('button[data-modo]');
      if (m) return cambiarModo(m.dataset.modo);
      const b = ev.target.closest('button[data-fecha]');
      if (b) elegirDia(b.dataset.fecha);
    });
    $('#ocupacion-equipo').addEventListener('mouseover', (ev) => {
      if (esperandoFin) previsualizar(ev.target.closest('button[data-fecha]:not(:disabled)')?.dataset.fecha);
    });
    $('#ocupacion-equipo').addEventListener('mouseleave', () => previsualizar(null));
    f.desde.addEventListener('change', () => {
      esperandoFin = false;
      if (f.hasta.value && f.hasta.value < f.desde.value) f.hasta.value = f.desde.value;
      f.hasta.min = f.desde.value || reglas.hoy;
      revisarDisponibilidad();
    });
    f.hasta.addEventListener('change', () => {
      esperandoFin = false;
      if (f.hasta.value && f.hasta.value !== f.desde.value && permiteVarios()) modo = 'varios';
      clearTimeout(temporizador);
      temporizador = setTimeout(revisarDisponibilidad, 150);
    });
    f.addEventListener('submit', enviar);

    $('#catalogo').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-equipo]');
      if (!b) return;
      f.equipo_id.value = b.dataset.equipo;
      mostrarEquipo();
      if (!permiteVarios()) cambiarModo('uno');
      semanaInicial = 0;
      cargarOcupacion();
      revisarDisponibilidad();
      $('#solicitar').scrollIntoView({ behavior: 'smooth' });
    });

    $('#form-consulta').addEventListener('submit', consultar);
    consultaDesdeEnlace();
  });
})();
