'use strict';

(() => {
  const { api, clp, num, cm, esc, fecha, PUNTOS_POR_METRO } = window.LPT;
  const $ = (s, r = document) => r.querySelector(s);

  let CONFIG = null;
  let paginasPdf = null; // medidas leídas del PDF en el navegador

  // ---------- Configuración y papeles ----------
  async function cargarConfig() {
    CONFIG = await api('/api/config');
    const r = CONFIG.reglas;
    document.querySelectorAll('.js-scc').forEach((el) => (el.textContent = r.scc));
    document.querySelectorAll('.js-maxmb').forEach((el) => (el.textContent = r.maxMb));

    $('#lista-papeles').innerHTML = CONFIG.papeles
      .map((p) => `<article class="tarjeta papel"><h3>${esc(p.nombre)}</h3><p class="tenue">${esc(p.descripcion || '')}</p><p class="precio">${clp(p.precio_m2)}<small> / m²</small></p></article>`)
      .join('');

    const opciones = CONFIG.papeles.map((p) => `<option value="${esc(p.codigo)}">${esc(p.nombre)} · ${clp(p.precio_m2)}/m²</option>`).join('');
    document.querySelectorAll('select[name="papel"]').forEach((s) => (s.innerHTML = opciones));
  }

  function papelSeleccionado(form) {
    return CONFIG.papeles.find((p) => p.codigo === form.papel.value);
  }

  // Misma regla que el servidor: el lado menor de cada página va contra el rollo de 1 m.
  function calcular(paginas, precio, copias) {
    let area = 0;
    let mayor = null;
    for (const [i, p] of paginas.entries()) {
      const ancho = Math.min(p.ancho_m, p.alto_m);
      const alto = Math.max(p.ancho_m, p.alto_m);
      if (ancho > CONFIG.reglas.anchoMaxCm / 100 + 0.001) {
        return { error: `La página ${i + 1} mide ${cm(ancho)} × ${cm(alto)} cm y supera el ancho máximo de ${CONFIG.reglas.anchoMaxCm} cm.` };
      }
      area += ancho * alto;
      if (!mayor || ancho * alto > mayor.ancho * mayor.alto) mayor = { ancho, alto };
    }
    area *= copias;
    return { area, total: Math.round(area * precio), mayor };
  }

  function copiasValidas(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= CONFIG.reglas.maxCopias ? n : null;
  }

  // ---------- Cotizador rápido ----------
  function actualizarCotizador() {
    const f = $('#form-cotizar');
    const out = $('#resultado-cotizar');
    const ancho = Number(f.ancho_cm.value);
    const alto = Number(f.alto_cm.value);
    const copias = copiasValidas(f.copias.value);
    if (!(ancho > 0) || !(alto > 0)) {
      out.innerHTML = '<span class="tenue">Completa las medidas para ver el precio.</span>';
      return;
    }
    if (!copias) {
      out.innerHTML = `<span class="error">Las copias deben estar entre 1 y ${CONFIG.reglas.maxCopias}.</span>`;
      return;
    }
    const papel = papelSeleccionado(f);
    const r = calcular([{ ancho_m: ancho / 100, alto_m: alto / 100 }], papel.precio_m2, copias);
    out.innerHTML = r.error
      ? `<span class="error">${esc(r.error)}</span>`
      : `<span class="monto">${clp(r.total)}</span><span class="tenue">${num(r.area)} m² en papel ${esc(papel.nombre)} · valor referencial</span>`;
  }

  // ---------- Lectura del PDF en el navegador ----------
  async function leerPdf(archivo) {
    const info = $('#info-archivo');
    paginasPdf = null;
    info.hidden = false;
    info.className = 'info-archivo';

    if (!/\.pdf$/i.test(archivo.name) && archivo.type !== 'application/pdf') {
      info.classList.add('error');
      info.textContent = 'El archivo debe ser PDF.';
      return;
    }
    if (archivo.size > CONFIG.reglas.maxMb * 1024 * 1024) {
      info.classList.add('error');
      info.textContent = `El archivo pesa ${num(archivo.size / 1024 / 1024)} MB y el máximo es ${CONFIG.reglas.maxMb} MB.`;
      return;
    }
    info.textContent = 'Leyendo medidas del PDF…';
    try {
      const doc = await window.PDFLib.PDFDocument.load(await archivo.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
      paginasPdf = doc.getPages().map((p) => {
        const c = p.getCropBox();
        return { ancho_m: Math.abs(c.width) / PUNTOS_POR_METRO, alto_m: Math.abs(c.height) / PUNTOS_POR_METRO };
      });
      const lista = paginasPdf
        .slice(0, 6)
        .map((p, i) => `<li>Página ${i + 1}: ${cm(Math.min(p.ancho_m, p.alto_m))} × ${cm(Math.max(p.ancho_m, p.alto_m))} cm</li>`)
        .join('');
      info.innerHTML = `<b>${esc(archivo.name)}</b> · ${num(archivo.size / 1024 / 1024)} MB · ${paginasPdf.length} página(s)<ul>${lista}${paginasPdf.length > 6 ? '<li>…</li>' : ''}</ul>`;
    } catch {
      info.classList.add('error');
      info.textContent = 'No pudimos leer el PDF. Verifica que no esté dañado o protegido.';
    }
    actualizarPedido();
  }

  function actualizarPedido() {
    const f = $('#form-pedido');
    const out = $('#resultado-pedido');
    if (!paginasPdf) {
      out.innerHTML = '<span class="tenue">Sube tu PDF para calcular el valor.</span>';
      return;
    }
    const copias = copiasValidas(f.copias.value);
    if (!copias) {
      out.innerHTML = `<span class="error">Las copias deben estar entre 1 y ${CONFIG.reglas.maxCopias}.</span>`;
      return;
    }
    const papel = papelSeleccionado(f);
    const r = calcular(paginasPdf, papel.precio_m2, copias);
    out.innerHTML = r.error
      ? `<span class="error">${esc(r.error)}</span>`
      : `<span class="monto">${clp(r.total)}</span><span class="tenue">${num(r.area)} m² · ${paginasPdf.length} página(s) × ${copias} copia(s) en ${esc(papel.nombre)}</span>`;
  }

  // ---------- Envío del pedido ----------
  function mostrarErrores(err) {
    const caja = $('#errores-pedido');
    const lista = err.errores ? Object.values(err.errores) : [err.message];
    caja.innerHTML = lista.length > 1 ? `<ul>${lista.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : esc(lista[0]);
    caja.hidden = false;
    if (err.errores) {
      for (const campo of Object.keys(err.errores)) {
        const el = $(`#form-pedido [name="${campo}"]`);
        if (el) el.setAttribute('aria-invalid', 'true');
      }
    }
    caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function enviarPedido(ev) {
    ev.preventDefault();
    const f = ev.currentTarget;
    const boton = f.querySelector('button[type="submit"]');
    $('#errores-pedido').hidden = true;
    f.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));

    if (!f.archivo.files[0]) return mostrarErrores(new Error('Adjunta el archivo PDF a imprimir.'));
    if (!f.reportValidity()) return;

    const datos = new FormData(f);
    datos.set('extranjero', f.extranjero.checked ? 'true' : 'false');
    datos.set('acepta', f.acepta.checked ? 'true' : 'false');

    boton.disabled = true;
    boton.textContent = 'Enviando…';
    try {
      const r = await api('/api/pedidos', { method: 'POST', body: datos });
      mostrarConfirmacion(r);
    } catch (err) {
      mostrarErrores(err);
    } finally {
      boton.disabled = false;
      boton.textContent = 'Enviar pedido';
    }
  }

  function mostrarConfirmacion(r) {
    $('#form-pedido').hidden = true;
    const c = $('#confirmacion');
    c.innerHTML = `
      <p class="sobretitulo">Pedido recibido</p>
      <h3 class="codigo">${esc(r.codigo)}</h3>
      <p>Te enviamos la confirmación a <b>${esc(r.email)}</b>. Guarda este código para consultar el estado.</p>
      <dl class="detalle">
        <dt>Papel</dt><dd>${esc(r.papel)}</dd>
        <dt>Medidas</dt><dd>${cm(r.ancho_m)} × ${cm(r.alto_m)} cm${r.paginas > 1 ? ` (página mayor de ${r.paginas})` : ''}</dd>
        <dt>Copias</dt><dd>${r.copias}</dd>
        <dt>Superficie</dt><dd>${num(r.area_m2)} m²</dd>
        <dt>Total</dt><dd><b>${clp(r.total_clp)}</b></dd>
        <dt>Entrega estimada</dt><dd>${esc(fecha(r.fecha_entrega_estimada))}</dd>
      </dl>
      <div class="alerta alerta-pago">
        <b>Instrucciones de pago · ${esc(r.metodo_pago_nombre)}</b>
        <p>${esc(r.instrucciones_pago)}</p>
        <p class="scc">SCC ${esc(CONFIG.reglas.scc)}</p>
      </div>
      <button class="boton boton-claro" type="button" id="nuevo-pedido">Enviar otro archivo</button>`;
    c.hidden = false;
    c.focus();
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#nuevo-pedido').addEventListener('click', () => {
      const f = $('#form-pedido');
      f.reset();
      paginasPdf = null;
      $('#info-archivo').hidden = true;
      actualizarPedido();
      c.hidden = true;
      f.hidden = false;
    });
  }

  // ---------- Seguimiento ----------
  async function consultar(ev) {
    ev.preventDefault();
    const f = ev.currentTarget;
    const out = $('#resultado-seguimiento');
    if (!f.reportValidity()) return;
    out.innerHTML = '<span class="tenue">Buscando…</span>';
    try {
      const r = await api('/api/seguimiento', { method: 'POST', body: { codigo: f.codigo.value, email: f.email.value } });
      out.innerHTML = `<span class="estado estado-${esc(r.estado_codigo)}">${esc(r.estado)}</span>
        <span class="tenue">${esc(r.papel)} · ${clp(r.total_clp)} · entrega estimada ${esc(fecha(r.fecha_entrega_estimada))}</span>`;
    } catch (err) {
      out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
    }
  }

  // ---------- Inicio ----------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await cargarConfig();
    } catch {
      $('#lista-papeles').innerHTML = '<p class="error">No se pudo cargar la información. Recarga la página.</p>';
      return;
    }
    $('#form-cotizar').addEventListener('input', actualizarCotizador);
    $('#form-cotizar').addEventListener('submit', (e) => e.preventDefault());

    const fp = $('#form-pedido');
    fp.archivo.addEventListener('change', () => fp.archivo.files[0] && leerPdf(fp.archivo.files[0]));
    fp.papel.addEventListener('change', actualizarPedido);
    fp.copias.addEventListener('input', actualizarPedido);
    fp.addEventListener('submit', enviarPedido);

    const zona = $('#zona-archivo');
    ['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('arrastrando'); }));
    ['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, () => zona.classList.remove('arrastrando')));
    zona.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files[0]) {
        fp.archivo.files = e.dataTransfer.files;
        leerPdf(e.dataTransfer.files[0]);
      }
    });

    $('#form-seguimiento').addEventListener('submit', consultar);
  });
})();
