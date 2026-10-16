// Pruebas de regresión de la ronda 1 de revisión (ceiba/app.html y ceiba/index.html).
// Cada prueba reproduce un hallazgo confirmado y se escribió ANTES de corregirlo (vista fallar, corregir, vista pasar).
// Ejecutar: node ceiba/tests/reg-ronda1.mjs      (FILTRO="texto" ejecuta solo las pruebas cuyo nombre coincida)
//
// Hallazgos cubiertos (ids de la revisión): SEG-01 y R1-01 (tope de 5.000 notas), SEG-02 (reloj anterior a 1970),
// SEG-03 y R1-05 (notas enormes), SEG-04, R1-H1 y R1-02 (dos pestañas), A11Y-1 y V1 (aviso de almacenamiento),
// A11Y-2 (cancelar el selector de archivos), A11Y-3 (foco en el botón pulsado), A11Y-4 (foco al cerrar un aviso),
// A11Y-5 (zoom al 400 %), A11Y-6 y A11Y-7 (contraste forzado), A11Y-8 y R1-M1 y R1-03 (Alt+Retroceso y Alt+N en campos
// de texto), V2 (texto ampliado en la landing), R1-M2 y R1-04 (nota activa visible), R1-M3 (atajos en la bienvenida),
// R1-M4 (barra lateral colapsable entre 600 y 899 px).
import { servir, lanzar, prueba as pruebaBase, resumen, igual, verdadero } from './helpers.mjs';

const FILTRO = process.env.FILTRO ? new RegExp(process.env.FILTRO, 'i') : null;
const prueba = (nombre, fn) => (FILTRO && !FILTRO.test(nombre)) ? undefined : pruebaBase(nombre, fn);

const srv = await servir();
const { navegador, cerrar } = await lanzar();
const APP = srv.url + '/app.html';
const LANDING = srv.url + '/index.html';
const CLAVE = 'ceiba:notas:v1';
const T0 = Date.parse('2026-10-16T10:32:00-05:00');
const MIN = 60000, HORA = 3600000;
const norm = s => String(s).replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ utilidades
const nota = (id, texto, editada, creada = editada) => ({ id, texto, creada, editada });
const datos = (notas, activa) => JSON.stringify({ version: 1, notas, activa: activa === undefined ? (notas[0] ? notas[0].id : null) : activa });

/** Siembra localStorage una sola vez por pestaña (la marca en sessionStorage evita volver a sembrar al recargar). */
function sembrar(claves) {
  try {
    if (!/app\.html$/.test(location.pathname)) return;
    if (sessionStorage.getItem('__sembrado')) return;
    sessionStorage.setItem('__sembrado', '1');
    for (const k of Object.keys(claves)) localStorage.setItem(k, claves[k]);
  } catch (e) { /* contexto sin almacenamiento */ }
}

/**
 * Abre la app en un contexto nuevo, ejecuta fn(page, registro, ctx) y siempre cierra.
 * Opciones: ancho, alto, esquema, sembrar {clave: texto}, init {fn, arg}, reloj (instante en ms; el tiempo corre desde él),
 * tactil, colores forzados (forzados: true), pagina (URL; por omisión la app).
 */
async function con(o, fn) {
  o = o || {};
  const ctx = await navegador.newContext({
    viewport: { width: o.ancho || 1440, height: o.alto || 900 },
    locale: 'es-ES', timezoneId: 'America/Bogota', colorScheme: o.esquema || 'light', reducedMotion: 'reduce',
    hasTouch: !!o.tactil, isMobile: false, forcedColors: o.forzados ? 'active' : 'none', acceptDownloads: true,
  });
  ctx.setDefaultTimeout(4000);
  if (o.sembrar) await ctx.addInitScript(sembrar, o.sembrar);
  if (o.init) await ctx.addInitScript(o.init.fn, o.init.arg);
  const page = await ctx.newPage();
  const reg = { consola: [], errores: [] };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') reg.consola.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => reg.errores.push(e.message));
  page.on('dialog', d => { d.dismiss().catch(() => {}); });
  try {
    // Con el reloj falso de Playwright performance.now() y requestAnimationFrame no miden tiempo real: las pruebas de rendimiento van sin él.
    if (o.sinReloj) { /* reloj real */ }
    else if (o.reloj !== undefined) await page.clock.install({ time: o.reloj });
    else await page.clock.install({ time: T0 });
    await page.goto(o.pagina || APP);
    return await fn(page, reg, ctx);
  } finally { await ctx.close(); }
}

async function esperar(fn, msg, ms = 4000) {
  const fin = Date.now() + ms; let ultimo;
  for (;;) {
    try { const r = await fn(); if (r) return r; ultimo = r; } catch (e) { ultimo = e; }
    if (Date.now() > fin) throw new Error(`${msg} (tras ${ms} ms; último: ${ultimo && ultimo.message ? ultimo.message : JSON.stringify(ultimo)})`);
    await new Promise(r => setTimeout(r, 25));
  }
}

const editor = page => page.getByRole('textbox', { name: 'Texto de la nota' });
const nueva = page => page.getByRole('button', { name: 'Nueva nota', exact: true });
const guardado = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), CLAVE);
const textoDe = async loc => norm(await loc.textContent());
const filas = page => page.locator('#lista [role="option"]').evaluateAll(l => l.map(li => ({
  id: li.dataset.id, titulo: li.querySelector('.nota__titulo').textContent, seleccionada: li.getAttribute('aria-selected') === 'true',
})));
const avisos = page => page.locator('#avisos .aviso');
const avisoDe = (page, texto) => page.locator('#avisos .aviso', { hasText: texto });
const enFoco = (page, sel) => page.evaluate(s => document.activeElement === document.querySelector(s), sel);
const clavesCorruptas = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':corrupto:')));
const limpio = reg => { igual(reg.consola, [], 'consola'); igual(reg.errores, [], 'errores de página'); };

const muchas = (n, prefijo = 'Nota') => Array.from({ length: n }, (_, i) => nota('d' + i, `${prefijo} ${i}`, T0 - (i + 1) * 1000));
const lineas = (n, texto = 'a') => Array.from({ length: n }, () => texto).join('\n');

// =====================================================================================
console.log('\n[SEG-01 y R1-01: el tope de 5.000 notas]');

await prueba('SEG-01: con 4.999 notas se pueden crear hasta 5.000; la siguiente se rechaza con un aviso y al recargar las 5.000 siguen visibles (no "dañadas")', async () => {
  await con({ sembrar: { [CLAVE]: datos(muchas(4999), 'd0') } }, async (page, reg) => {
    await nueva(page).click();
    await nueva(page).click();
    igual((await guardado(page)).notas.length, 5000, 'el cuaderno no puede pasar de 5.000 notas');
    verdadero((await avisoDe(page, '5.000 notas').count()) >= 1, 'al llegar al tope debe avisar');
    await page.reload();
    igual((await filas(page)).length, 5000, 'tras recargar deben verse las 5.000 notas');
    igual(await avisos(page).count(), 0, 'no debe haber aviso de notas dañadas');
    igual(await clavesCorruptas(page), [], 'no debe haberse copiado nada a una clave :corrupto:');
    limpio(reg);
  });
});

await prueba('SEG-01: un cuaderno ya guardado con 5.001 notas válidas (de antes de este arreglo) se lee entero, sin copia :corrupto: ni cuaderno limpio', async () => {
  await con({ sembrar: { [CLAVE]: datos(muchas(5001), 'd0') } }, async (page, reg) => {
    igual((await filas(page)).length, 5001);
    igual(await avisos(page).count(), 0, 'sin avisos de notas dañadas');
    igual(await clavesCorruptas(page), []);
    igual((await guardado(page)).notas.length, 5001, 'no se sustituye el cuaderno por uno vacío');
    limpio(reg);
  });
});

await prueba('SEG-01: la copia que se conservó de datos dañados se puede descargar desde Copia de seguridad', async () => {
  const roto = '{"version":1,"notas":[{"id":"x","texto":"valioso"';
  await con({ sembrar: { [CLAVE]: roto } }, async (page, reg) => {
    verdadero((await avisoDe(page, 'dañadas').count()) === 1, 'aviso de datos dañados');
    await page.locator('#respaldo').click();
    const boton = page.getByRole('button', { name: 'Descargar copia dañada' });
    verdadero(await boton.isVisible(), 'falta el botón para descargar la copia conservada');
    const [descarga] = await Promise.all([page.waitForEvent('download'), boton.click()]);
    verdadero(/^ceiba-notas-danadas-.*\.json$/.test(descarga.suggestedFilename()), `nombre inesperado: ${descarga.suggestedFilename()}`);
    const fs = await import('node:fs');
    igual(fs.readFileSync(await descarga.path(), 'utf8'), roto, 'el archivo debe ser la copia sin cambios');
    limpio(reg);
  });
});

await prueba('SEG-01: sin datos dañados el diálogo de copia de seguridad no ofrece descargar ninguna copia', async () => {
  await con({ sembrar: { [CLAVE]: datos(muchas(3), 'd0') } }, async page => {
    await page.locator('#respaldo').click();
    verdadero(!(await page.getByRole('button', { name: 'Descargar copia dañada' }).isVisible()), 'no hay copia que descargar');
  });
});

// =====================================================================================
console.log('\n[SEG-02: reloj anterior a 1970]');

await prueba('SEG-02: con el reloj en 1969 las notas escritas se guardan y se leen al recargar (no se descartan como dañadas)', async () => {
  await con({ reloj: Date.parse('1969-06-01T12:00:00Z') }, async (page, reg) => {
    await page.keyboard.press('Alt+KeyN');
    await page.keyboard.type('escrito con el reloj en 1969');
    await page.clock.runFor(1000);
    igual((await guardado(page)).notas.length, 2);
    await page.reload();
    const f = await filas(page);
    igual(f.length, 2, 'las dos notas deben seguir ahí tras recargar');
    igual(f[0].titulo, 'escrito con el reloj en 1969');
    igual(await avisos(page).count(), 0, 'sin aviso de notas dañadas');
    igual(await clavesCorruptas(page), []);
    limpio(reg);
  });
});

// =====================================================================================
console.log('\n[SEG-03 y R1-05: notas enormes]');

await prueba('SEG-03: la vista previa de una nota de 300.000 líneas no congela la pestaña (< 2 s hasta pintar) y avisa de que está recortada', async () => {
  const texto = '# Registro\n\n' + lineas(300000, '- a');
  await con({ sinReloj: true, sembrar: { [CLAVE]: datos([nota('g', texto, T0)], 'g') } }, async page => {
    // Desde la ronda 2 una nota pesada que es la única no se abre sola (SEC2-02): se abre a mano antes de pedir la vista previa.
    await page.locator('#lista li[data-id="g"]').click({ timeout: 60000 });
    const r = await page.evaluate(async () => {
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', altKey: true, bubbles: true, cancelable: true }));
      await new Promise(f => requestAnimationFrame(() => requestAnimationFrame(f)));
      return { ms: performance.now() - t0, elementos: document.querySelectorAll('#vista *').length, texto: document.querySelector('#vista').textContent };
    });
    verdadero(r.ms < 2000, `la vista previa tardó ${r.ms.toFixed(0)} ms`);
    verdadero(/recortada/i.test(r.texto), 'debe decir que la vista previa está recortada');
    verdadero(r.elementos < 40000, `demasiados elementos en la vista: ${r.elementos}`);
  });
});

await prueba('SEG-03/R1-05: una nota densa de 200 KB (50.000 elementos de lista) se previsualiza en menos de 1 s hasta pintar', async () => {
  const texto = lineas(50000, '- a');
  await con({ sinReloj: true, sembrar: { [CLAVE]: datos([nota('g', texto, T0)], 'g') } }, async page => {
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', altKey: true, bubbles: true, cancelable: true }));
      await new Promise(f => requestAnimationFrame(() => requestAnimationFrame(f)));
      return performance.now() - t0;
    });
    verdadero(ms < 1000, `200 KB de elementos de lista tardaron ${ms.toFixed(0)} ms hasta pintar`);
  });
});

await prueba('SEG-03: una vista previa normal (documento corto) no se recorta ni muestra aviso', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('g', '# Título\n\n- uno\n- dos\n\nTexto con **negrita**.', T0)], 'g') } }, async page => {
    await page.keyboard.press('Alt+KeyP');
    verdadero(await page.locator('#vista').isVisible());
    verdadero(!/recortada/i.test(await page.locator('#vista').textContent()), 'un documento corto no se recorta');
  });
});

await prueba('SEG-03: al importar, una nota con más de 50.000 líneas se omite y el informe dice por qué; las demás entran', async () => {
  const copia = { version: 1, notas: [nota('normal', 'Nota normal\ncon dos líneas', T0), nota('enorme', lineas(60000), T0)] };
  await con({ sembrar: { [CLAVE]: datos([nota('a', 'Local', T0 - HORA)], 'a') } }, async page => {
    await page.locator('#respaldo').click();
    await page.setInputFiles('#archivo-importar', { name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copia)) });
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'debe aparecer el informe');
    const informe = await textoDe(avisoDe(page, 'Importación lista').first());
    verdadero(/1 añadida\b/.test(informe) && /1 omitida\b/.test(informe), `informe inesperado: ${informe}`);
    verdadero(/demasiad[ao]s? larg/i.test(informe), `el informe debe decir que era demasiado larga: ${informe}`);
    igual((await guardado(page)).notas.map(n => n.id).sort(), ['a', 'normal']);
  });
});

await prueba('SEG-03: si la nota activa guardada tiene más de 50.000 líneas no se abre sola: arranca otra nota y se avisa', async () => {
  const notas = [nota('chica', 'Nota chica\ncon texto', T0 - HORA), nota('pesada', 'Registro enorme\n' + lineas(60000), T0)];
  await con({ sembrar: { [CLAVE]: datos(notas, 'pesada') } }, async (page, reg) => {
    verdadero((await editor(page).inputValue()).startsWith('Nota chica'), 'debe abrirse la nota liviana');
    verdadero((await avisoDe(page, 'Registro enorme').count()) === 1, 'debe avisar de la nota que no se abrió');
    igual((await guardado(page)).notas.length, 2, 'no se pierde ninguna nota');
    limpio(reg);
  });
});

// =====================================================================================
console.log('\n[SEG-04, R1-H1 y R1-02: dos pestañas]');

/** Abre dos pestañas de la app sobre las mismas notas (sembradas desde la landing, que es del mismo origen). */
async function conDosPestanas(notas, activa, fn) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES', timezoneId: 'America/Bogota', reducedMotion: 'reduce' });
  ctx.setDefaultTimeout(4000);
  try {
    const a = await ctx.newPage();
    await a.goto(LANDING);
    await a.evaluate(([k, v]) => localStorage.setItem(k, v), [CLAVE, datos(notas, activa)]);
    await a.goto(APP);
    const b = await ctx.newPage();
    await b.goto(APP);
    return await fn(a, b);
  } finally { await ctx.close(); }
}
const textos = async page => (await guardado(page)).notas.map(n => n.texto.split('\n')[0]);
// Sin reloj falso: las fechas de lo sembrado van relativas al reloj real (las ediciones nuevas deben ser posteriores a ellas).
const base3 = () => { const r = Date.now(); return [nota('alfa', 'Alfa', r - 3 * MIN), nota('beta', 'Beta', r - 2 * MIN), nota('gamma', 'Gamma', r - 1 * MIN)]; };

await prueba('R1-H1/R1-02: en la pestaña desactualizada, moverse por la lista sin escribir no borra del almacenamiento la nota nueva de la otra', async () => {
  await conDosPestanas(base3(), 'alfa', async (a, b) => {
    await b.keyboard.press('Alt+KeyN');
    await b.keyboard.type('NOTA IMPORTANTE ESCRITA EN B');
    await esperar(async () => (await textos(b)).includes('NOTA IMPORTANTE ESCRITA EN B'), 'B debe guardar su nota');
    await esperar(async () => (await avisoDe(a, 'otra pestaña').count()) === 1, 'A debe mostrar el aviso de otra pestaña');
    await a.locator('#lista').focus();
    await a.keyboard.press('ArrowUp');                              // "Alfa" es la última de la lista: subir cambia de nota
    await a.keyboard.press('ArrowUp');
    await a.waitForTimeout(150);
    verdadero((await filas(a)).find(f => f.seleccionada).titulo === 'Gamma', 'la navegación debe haber cambiado la nota activa');
    verdadero((await textos(a)).includes('NOTA IMPORTANTE ESCRITA EN B'), `la nota de B desapareció al navegar en A: ${JSON.stringify(await textos(a))}`);
  });
});

await prueba('SEG-04: la pestaña desactualizada puede escribir sin borrar la nota de la otra, y la otra recibe lo escrito al recargar', async () => {
  await conDosPestanas(base3(), 'gamma', async (a, b) => {
    await b.keyboard.press('Alt+KeyN');
    await b.keyboard.type('NOTA DE B');
    await esperar(async () => (await textos(b)).includes('NOTA DE B'), 'B debe guardar su nota');
    await esperar(async () => (await avisoDe(a, 'otra pestaña').count()) === 1, 'aviso en A');
    await editor(a).focus();
    await a.keyboard.press('Control+End');
    await a.keyboard.type(' mas texto de A');
    await esperar(async () => (await textos(a)).includes('Gamma mas texto de A'), 'A debe guardar su edición');
    const t = await textos(a);
    verdadero(t.includes('NOTA DE B'), `la nota de B desapareció: ${JSON.stringify(t)}`);
    igual(t.length, 4, 'las tres de antes más la de B');
    await b.reload();
    verdadero((await filas(b)).some(f => f.titulo === 'Gamma mas texto de A'), 'B debe ver la edición de A tras recargar');
    verdadero((await filas(b)).some(f => f.titulo === 'NOTA DE B'), 'B conserva su nota');
  });
});

await prueba('SEG-04: lo que se elimina en una pestaña no resucita al guardar con notas nuevas de otra pestaña', async () => {
  await conDosPestanas(base3(), 'alfa', async (a, b) => {
    await b.keyboard.press('Alt+KeyN');
    await b.keyboard.type('NOTA DE B');
    await esperar(async () => (await textos(b)).includes('NOTA DE B'), 'B guarda');
    await esperar(async () => (await avisoDe(a, 'otra pestaña').count()) === 1, 'aviso en A');
    await a.locator('#lista').focus();
    await a.keyboard.press('Alt+Backspace');                         // A elimina "Alfa"
    await esperar(async () => !(await textos(a)).includes('Alfa'), 'Alfa debe quedar eliminada del almacenamiento');
    const t = await textos(a);
    verdadero(t.includes('NOTA DE B'), `la nota de B debe conservarse: ${JSON.stringify(t)}`);
    igual(t.length, 3, 'Beta, Gamma y la de B');
  });
});

await prueba('SEG-04: si las dos pestañas editan la misma nota, queda la edición más reciente (no la de la pestaña que guarda último por inercia)', async () => {
  await conDosPestanas(base3(), 'alfa', async (a, b) => {
    await editor(a).focus();
    await a.keyboard.press('Control+End');
    await a.keyboard.type(' versionA');
    await esperar(async () => (await textos(a)).includes('Alfa versionA'), 'A guarda');
    await a.waitForTimeout(60);
    await editor(b).focus();
    await b.keyboard.press('Control+End');
    await b.keyboard.type(' versionB');
    await esperar(async () => (await textos(b)).includes('Alfa versionB'), 'B guarda después y gana por ser más reciente');
    // La pestaña A, desactualizada, solo navega: no debe devolver su versión vieja.
    await a.locator('#lista').focus();
    await a.keyboard.press('ArrowDown');                            // tras editarla, "Alfa" es la primera de la lista: bajar cambia de nota
    await a.waitForTimeout(150);
    verdadero((await filas(a)).find(f => f.seleccionada).titulo !== 'Alfa versionA', 'la navegación debe haber cambiado la nota activa');
    verdadero((await textos(a)).includes('Alfa versionB'), `la edición más reciente debe prevalecer: ${JSON.stringify(await textos(a))}`);
  });
});

// =====================================================================================
console.log('\n[A11Y-1 y V1: el aviso de almacenamiento no tapa la interfaz]');

const BLOQUEADO = { fn: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); }, arg: null };
const rect = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const cruzan = (p, q) => !!p && !!q && p.x < q.r - 1 && q.x < p.r - 1 && p.y < q.b - 1 && q.y < p.b - 1;

for (const [ancho, alto] of [[320, 568], [360, 740], [390, 844], [600, 800], [700, 800], [1280, 800]]) {
  await prueba(`A11Y-1: con el almacenamiento bloqueado a ${ancho}x${alto} el aviso cabe en pantalla, su botón Cerrar se ve y no tapa la lista, el botón Nueva nota ni el editor`, async () => {
    await con({ ancho, alto, init: BLOQUEADO }, async (page, reg) => {
      const aviso = await rect(page, '#avisos .aviso--error');
      verdadero(aviso, 'debe haber un aviso de error');
      verdadero(aviso.y >= 0 && aviso.b <= alto && aviso.x >= 0 && aviso.r <= ancho, `el aviso se sale de la pantalla: ${JSON.stringify(aviso)}`);
      verdadero(aviso.h <= alto * 0.45, `el aviso ocupa demasiado alto (${aviso.h.toFixed(0)} px de ${alto})`);
      const texto = await rect(page, '#avisos .aviso--error .aviso__texto');
      verdadero(texto.w >= 150, `la columna de texto del aviso mide solo ${texto.w.toFixed(0)} px`);
      const cerrarBtn = await rect(page, '#avisos .aviso--error [aria-label="Cerrar aviso"]');
      verdadero(cerrarBtn && cerrarBtn.y >= 0 && cerrarBtn.b <= alto && cerrarBtn.r <= ancho, `el botón Cerrar queda fuera de pantalla: ${JSON.stringify(cerrarBtn)}`);
      for (const sel of ['#nueva', '#lista li', '#lienzo', '#editor']) {
        const otro = await rect(page, sel);
        if (otro) verdadero(!cruzan(aviso, otro), `el aviso tapa ${sel}: aviso ${JSON.stringify(aviso)} contra ${JSON.stringify(otro)}`);
      }
      limpio(reg);
    });
  });
}

await prueba('A11Y-1: con 60 líneas escritas en 1280x800 el aviso no tapa la línea donde está el cursor', async () => {
  await con({ ancho: 1280, alto: 800, init: BLOQUEADO }, async page => {
    await editor(page).focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(Array.from({ length: 60 }, (_, i) => `Línea ${i}`).join('\n'));
    await page.keyboard.type(' fin');
    const y = await page.evaluate(() => {
      const ed = document.querySelector('#editor'), r = ed.getBoundingClientRect();
      return r.bottom - 32 - 15;                         // la línea del cursor queda sobre el relleno inferior (32 px) del área visible
    });
    const tapado = await page.evaluate(yy => { const e = document.elementFromPoint(640, yy); return !!(e && e.closest('.aviso')); }, y);
    verdadero(!tapado, 'el aviso cubre la línea que se está escribiendo');
  });
});

await prueba('A11Y-1: el aviso persistente no se queda en la región flotante: la lista se puede pulsar a 360x740 con el almacenamiento bloqueado', async () => {
  await con({ ancho: 360, alto: 740, init: BLOQUEADO }, async page => {
    await page.locator('#lista li').first().click({ timeout: 1500 });
    verdadero(await page.locator('#app[data-vista="editor"]').count() === 1, 'al pulsar la nota debe abrirse el editor');
  });
});

// =====================================================================================
console.log('\n[A11Y-2, A11Y-3, A11Y-4: foco y diálogos]');

await prueba('A11Y-2: cancelar el selector de archivos de Importar no cierra el diálogo de copia de seguridad', async () => {
  await con({}, async page => {
    await page.locator('#respaldo').click();
    verdadero(await page.locator('#respaldo-dialogo').evaluate(d => d.open), 'el diálogo debe estar abierto');
    await page.evaluate(() => document.querySelector('#archivo-importar').dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(100);
    verdadero(await page.locator('#respaldo-dialogo').evaluate(d => d.open), 'el diálogo se cerró por sorpresa');
    // La petición de cierre del propio diálogo (Esc) sigue funcionando.
    await page.keyboard.press('Escape');
    verdadero(!(await page.locator('#respaldo-dialogo').evaluate(d => d.open)), 'Esc debe cerrar el diálogo');
  });
});

for (const esquema of ['light', 'dark']) {
  await prueba(`A11Y-3: el botón Vista previa pulsado conserva el anillo de foco (${esquema})`, async () => {
    await con({ esquema }, async page => {
      for (let i = 0; i < 25 && !(await enFoco(page, '#modo')); i++) await page.keyboard.press('Tab');
      verdadero(await enFoco(page, '#modo'), 'Tab debe llegar a Vista previa');
      await page.keyboard.press('Enter');
      igual(await page.locator('#modo').getAttribute('aria-pressed'), 'true');
      const r = await page.evaluate(() => ({ visible: document.activeElement.matches(':focus-visible'), sombra: getComputedStyle(document.activeElement).boxShadow }));
      verdadero(r.visible, 'el botón debe tener :focus-visible');
      const anillo = esquema === 'light' ? 'rgb(31, 95, 191)' : 'rgb(141, 184, 255)';
      verdadero(r.sombra.includes(anillo), `falta el anillo de foco (${anillo}) en: ${r.sombra}`);
    });
  });
}

await prueba('A11Y-4: cerrar un aviso con el teclado no deja el foco en body (la siguiente tabulación no vuelve al inicio de la página)', async () => {
  await con({}, async page => {
    await page.locator('#exportar-nota').focus();
    await page.keyboard.press('Enter');
    await esperar(async () => (await avisoDe(page, 'Se descargó').count()) === 1, 'aviso de descarga');
    await page.getByRole('button', { name: 'Cerrar aviso' }).focus();
    await page.keyboard.press('Enter');
    igual(await avisos(page).count(), 0, 'el aviso debe cerrarse');
    const tag = await page.evaluate(() => document.activeElement.tagName);
    verdadero(tag !== 'BODY', 'el foco se perdió en body');
    await page.keyboard.press('Tab');
    verdadero(!(await page.evaluate(() => document.activeElement.classList.contains('salto'))), 'Tab no debe volver a "Saltar al contenido"');
  });
});

await prueba('A11Y-4: si el aviso se cierra solo mientras el foco está en su botón Cerrar, el foco no cae en body', async () => {
  await con({}, async page => {
    await page.locator('#exportar-nota').focus();
    await page.keyboard.press('Enter');
    await esperar(async () => (await avisoDe(page, 'Se descargó').count()) === 1, 'aviso de descarga');
    await page.getByRole('button', { name: 'Cerrar aviso' }).focus();
    await page.clock.runFor(7000);
    igual(await avisos(page).count(), 0, 'el aviso se cierra solo');
    verdadero((await page.evaluate(() => document.activeElement.tagName)) !== 'BODY', 'el foco se perdió en body');
  });
});

// =====================================================================================
console.log('\n[A11Y-5: reflujo con zoom al 400 %]');

const TRES = [nota('a', 'Alfa\nprimera', T0 - 3 * MIN), nota('b', 'Beta\nsegunda', T0 - 2 * MIN), nota('c', 'Gamma\ntercera', T0 - 1 * MIN)];

await prueba('A11Y-5: a 320x256 la lista de notas es utilizable (>= 120 px) y la página se desplaza hasta el pie con Atajos', async () => {
  await con({ ancho: 320, alto: 256, sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    const lista = await rect(page, '.lista-nav');
    verdadero(lista.h >= 120, `la lista mide solo ${lista.h.toFixed(0)} px de alto`);
    await page.mouse.move(160, 120);
    await page.mouse.wheel(0, 2000);
    await esperar(async () => (await page.evaluate(() => document.scrollingElement.scrollTop)) > 0, 'la página debe poder desplazarse');
    const atajos = await rect(page, '#atajos');
    verdadero(atajos.y >= 0 && atajos.b <= 256 + 1, `el botón Atajos no se alcanza al desplazar: ${JSON.stringify(atajos)}`);
  });
});

await prueba('A11Y-5: a 320x256 en la vista del editor el área de escritura mide al menos 120 px y la barra de estado se alcanza desplazando', async () => {
  await con({ ancho: 320, alto: 256, sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    await page.locator('#lista li').first().click();
    const ed = await rect(page, '#editor');
    verdadero(ed.h >= 120, `el editor mide solo ${ed.h.toFixed(0)} px de alto`);
    await page.mouse.move(160, 120);
    await page.mouse.wheel(0, 2000);
    await esperar(async () => (await page.evaluate(() => document.scrollingElement.scrollTop)) > 0, 'la página debe poder desplazarse');
    const estado = await rect(page, '#estado');
    verdadero(estado.b <= 256 + 1, `la barra de estado queda cortada: ${JSON.stringify(estado)}`);
  });
});

await prueba('A11Y-5: en pantallas de tamaño normal (360x740) el diseño no cambia: la página no se desplaza y el editor ocupa el resto', async () => {
  await con({ ancho: 360, alto: 740, sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    igual(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight), true, 'la página no debe desplazarse');
    await page.locator('#lista li').first().click();
    const ed = await rect(page, '#editor');
    verdadero(ed.h > 400, `el editor debe aprovechar la altura: ${ed.h}`);
  });
});

// =====================================================================================
console.log('\n[A11Y-6 y A11Y-7: contraste forzado]');

await prueba('A11Y-6: en contraste forzado se distingue qué ciclo (Mensual o Anual) está seleccionado en la landing', async () => {
  await con({ ancho: 1100, alto: 900, forzados: true, pagina: LANDING }, async page => {
    await page.waitForTimeout(700);
    await page.locator('.ciclo').first().scrollIntoViewIfNeeded();
    const grupo = page.locator('.ciclo').first();
    await page.getByRole('radio', { name: 'Anual' }).check({ force: true });
    const anual = await grupo.screenshot();
    await page.getByRole('radio', { name: 'Mensual' }).check({ force: true });
    const mensual = await grupo.screenshot();
    verdadero(Buffer.compare(anual, mensual) !== 0, 'el selector se ve idéntico con Anual y con Mensual seleccionados');
    // Cada segmento, por separado, cambia de aspecto entre estar marcado y no estarlo.
    const segmento = page.locator('.ciclo__texto', { hasText: 'Anual' });
    const marcado = await segmento.screenshot();
    await page.getByRole('radio', { name: 'Anual' }).check({ force: true });
    const sinMarcar = await segmento.screenshot();
    verdadero(Buffer.compare(marcado, sinMarcar) !== 0, 'el segmento Anual no cambia al marcarlo');
  });
});

await prueba('A11Y-7: en contraste forzado la nota seleccionada se distingue de las demás y los botones pulsados (Vista previa, Modo enfoque) de los no pulsados', async () => {
  await con({ ancho: 1100, alto: 700, forzados: true, sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    await page.mouse.move(1000, 600);
    const li = page.locator('#lista li[data-id="a"]');
    const seleccionada = await li.screenshot();
    await page.locator('#lista').focus();
    await page.keyboard.press('ArrowDown');
    const sinSeleccion = await li.screenshot();
    verdadero(Buffer.compare(seleccionada, sinSeleccion) !== 0, 'la nota seleccionada se ve igual que una no seleccionada');
    for (const [sel, atajo] of [['#modo', 'Alt+KeyP'], ['#enfoque', 'Alt+Backslash']]) {
      const antes = await page.locator(sel).screenshot();
      await page.keyboard.press(atajo);
      igual(await page.locator(sel).getAttribute('aria-pressed'), 'true', `${sel} debe quedar pulsado`);
      await page.mouse.move(1000, 600);
      const despues = await page.locator(sel).screenshot();
      verdadero(Buffer.compare(antes, despues) !== 0, `${sel} pulsado se ve igual que sin pulsar`);
    }
  });
});

// =====================================================================================
console.log('\n[A11Y-8, R1-M1 y R1-03: atajos que chocan con la edición de texto]');

await prueba('A11Y-8: Alt+Retroceso con el foco en el editor no elimina la nota (en Mac Opción+Retroceso borra una palabra)', async () => {
  await con({ sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' receta secreta');
    await page.keyboard.press('Alt+Backspace');
    igual((await filas(page)).length, 3, 'la nota no se debe eliminar desde el editor');
    igual(await avisoDe(page, 'Se eliminó').count(), 0, 'sin aviso de eliminación');
  });
});

await prueba('A11Y-8: Alt+Retroceso con el foco en el campo de búsqueda no elimina la nota activa', async () => {
  await con({ sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    await page.getByRole('searchbox', { name: 'Buscar notas' }).focus();
    await page.keyboard.type('flan receta');
    await page.keyboard.press('Alt+Backspace');
    igual((await guardado(page)).notas.length, 3, 'la búsqueda no debe eliminar notas');
  });
});

await prueba('A11Y-8: Alt+Retroceso sigue eliminando la nota con el foco en la lista (y se puede deshacer)', async () => {
  await con({ sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    await page.locator('#lista').focus();
    await page.keyboard.press('Alt+Backspace');
    igual((await filas(page)).length, 2);
    await page.keyboard.press('Alt+KeyZ');
    igual((await filas(page)).length, 3);
  });
});

await prueba('R1-M1: la tecla muerta de Opción+N en Mac (key "Dead") no crea una nota ni se cancela, para poder escribir la ñ', async () => {
  await con({ sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    await editor(page).focus();
    const cancelado = await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'Dead', code: 'KeyN', altKey: true, bubbles: true, cancelable: true });
      document.querySelector('#editor').dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    verdadero(!cancelado, 'la tecla muerta no debe cancelarse');
    igual((await filas(page)).length, 3, 'no debe crearse una nota');
    await page.keyboard.press('Alt+KeyN');
    igual((await filas(page)).length, 4, 'Alt+N sigue creando notas');
  });
});

// =====================================================================================
console.log('\n[V2: landing con texto ampliado]');

await prueba('V2: la landing no tiene desplazamiento horizontal con el tamaño de texto al 150 %, 175 % y 200 % en 320, 360, 390 y 412 px', async () => {
  const fallos = [];
  for (const ancho of [320, 360, 390, 412]) {
    await con({ ancho, alto: 800, pagina: LANDING }, async page => {
      await page.waitForTimeout(600);
      for (const pct of [150, 175, 200]) {
        await page.evaluate(p => document.documentElement.style.setProperty('font-size', p + '%', 'important'), pct);
        await page.waitForTimeout(60);
        const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (d > 0) fallos.push(`${ancho} px a ${pct} %: ${d} px de desborde`);
        // El héroe recorta lo que se sale (overflow-x: clip): scrollWidth no lo ve, así que se mide también que su texto cabe.
        const texto = await page.evaluate(() => Math.round(document.querySelector('.heroe__texto').getBoundingClientRect().right - document.documentElement.clientWidth));
        if (texto > 0) fallos.push(`${ancho} px a ${pct} %: el texto del héroe se sale ${texto} px y queda recortado`);
      }
    });
  }
  igual(fallos, [], 'desborde horizontal');
});

// =====================================================================================
console.log('\n[R1-M2 y R1-04: la nota activa sigue a la vista]');

const visibleEnLista = page => page.evaluate(() => {
  const li = document.querySelector('#lista [aria-selected="true"]');
  if (!li) return null;
  const c = document.querySelector('.lista-nav').getBoundingClientRect(), r = li.getBoundingClientRect();
  return r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
});

await prueba('R1-M2: al editar una nota con la lista desplazada, la nota sube al inicio pero sigue visible y seleccionada', async () => {
  const notas = muchas(40);
  await con({ sembrar: { [CLAVE]: datos(notas, 'd0') } }, async page => {
    await page.locator('.lista-nav').evaluate(c => { c.scrollTop = c.scrollHeight; });
    await page.locator('#lista li[data-id="d37"]').click();
    verdadero(await page.locator('.lista-nav').evaluate(c => c.scrollTop) > 500, 'la lista debe seguir desplazada hacia el final');
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' editado');
    await esperar(async () => (await filas(page))[0].id === 'd37', 'la nota editada debe subir al inicio');
    igual(await visibleEnLista(page), true, 'la nota activa quedó fuera de la zona visible de la lista');
  });
});

await prueba('R1-04: al vaciar la búsqueda la nota activa vuelve a quedar a la vista', async () => {
  const notas = muchas(300);
  await con({ sembrar: { [CLAVE]: datos(notas, 'd0') } }, async page => {
    await page.locator('#lista').focus();
    await page.keyboard.press('End');
    await esperar(async () => (await filas(page)).find(f => f.seleccionada)?.id === 'd299', 'la última nota debe estar activa');
    await page.getByRole('searchbox', { name: 'Buscar notas' }).fill('Nota 1');
    await page.locator('.lista-nav').evaluate(c => { c.scrollTop = 11337; });
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
    igual(await visibleEnLista(page), true, 'tras limpiar la búsqueda la nota activa debe seguir a la vista');
  });
});

// =====================================================================================
console.log('\n[R1-M3: la nota de bienvenida enseña los atajos]');

await prueba('R1-M3: la nota de bienvenida explica cómo ver la vista previa y los atajos principales', async () => {
  await con({}, async page => {
    const v = await editor(page).inputValue();
    for (const t of ['Alt+P', 'Alt+N', 'Ctrl+K', 'Alt+Z']) verdadero(v.includes(t), `la bienvenida no menciona ${t}`);
    verdadero(/vista previa/i.test(v), 'debe decir que Alt+P muestra la vista previa');
    verdadero(/Opción/.test(v), 'debe aclarar la equivalencia de Alt y Ctrl en Mac');
    await page.keyboard.press('Alt+KeyP');
    verdadero(await page.locator('#vista').isVisible(), 'la bienvenida se previsualiza');
    verdadero(!/recortada/i.test(await page.locator('#vista').textContent()), 'la bienvenida no se recorta');
  });
});

// =====================================================================================
console.log('\n[R1-M4: barra lateral colapsable entre 600 y 899 px]');

await prueba('R1-M4: a 768 px (táctil) un botón oculta y muestra solo la barra lateral; la barra superior y Vista previa siguen a mano', async () => {
  await con({ ancho: 768, alto: 1024, tactil: true, sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    const boton = page.getByRole('button', { name: 'Ocultar lista' });
    verdadero(await boton.isVisible(), 'falta el botón Ocultar lista');
    igual(await boton.getAttribute('aria-expanded'), 'true');
    igual(await boton.getAttribute('aria-controls'), 'lateral');
    const antes = (await rect(page, '#editor')).w;
    await boton.tap();
    verdadero(!(await page.locator('#lateral').isVisible()), 'la barra lateral debe ocultarse');
    verdadero(await page.getByRole('button', { name: 'Vista previa', exact: true }).isVisible(), 'la barra superior sigue visible');
    const despues = (await rect(page, '#editor')).w;
    verdadero(despues > antes + 200, `el editor debe ganar el ancho de la lista (${antes} -> ${despues})`);
    const mostrar = page.getByRole('button', { name: 'Mostrar lista' });
    igual(await mostrar.getAttribute('aria-expanded'), 'false');
    await mostrar.tap();
    verdadero(await page.locator('#lateral').isVisible(), 'la barra lateral debe volver');
    igual(await page.getByRole('button', { name: 'Ocultar lista' }).getAttribute('aria-expanded'), 'true');
  });
});

await prueba('R1-M4: con la lista oculta, Ctrl+K y Esc desde el editor la vuelven a mostrar y enfocan lo pedido (el foco no se pierde)', async () => {
  await con({ ancho: 768, alto: 1024, sembrar: { [CLAVE]: datos(TRES, 'a') } }, async page => {
    await page.getByRole('button', { name: 'Ocultar lista' }).click();
    await editor(page).focus();
    await page.keyboard.press('Control+KeyK');
    verdadero(await page.locator('#lateral').isVisible(), 'Ctrl+K debe mostrar la lista');
    verdadero(await enFoco(page, '#busqueda'), 'el foco debe estar en la búsqueda');
    await page.getByRole('button', { name: 'Ocultar lista' }).click();
    await editor(page).focus();
    await page.keyboard.press('Escape');
    verdadero(await page.locator('#lateral').isVisible(), 'Esc debe mostrar la lista');
    verdadero(await enFoco(page, '#lista'), 'el foco debe estar en la lista');
  });
});

await prueba('R1-M4: el botón no existe a 360 px ni a 1440 px, y una lista oculta a 768 px reaparece al ensanchar la ventana', async () => {
  for (const ancho of [360, 1440]) {
    await con({ ancho, alto: 900 }, async page => {
      verdadero(!(await page.getByRole('button', { name: /(Ocultar|Mostrar) lista/ }).isVisible()), `el botón no debe verse a ${ancho} px`);
    });
  }
  await con({ ancho: 768, alto: 900 }, async page => {
    await page.getByRole('button', { name: 'Ocultar lista' }).click();
    verdadero(!(await page.locator('#lateral').isVisible()));
    await page.setViewportSize({ width: 1200, height: 900 });
    verdadero(await page.locator('#lateral').isVisible(), 'a 1200 px la barra lateral vuelve a verse');
    await page.setViewportSize({ width: 360, height: 900 });
    verdadero(await page.locator('#lateral').isVisible(), 'a 360 px la lista es la vista inicial');
  });
});

// =====================================================================================
console.log('\n[funciones puras: tope, fechas y presupuesto del render]');

await prueba('SEG-01: validarImportacion acepta más de 5.000 notas con { limite: Infinity } (lectura de lo guardado) y por omisión sigue rechazándolas (importación)', async () => {
  await con({}, async page => {
    const r = await page.evaluate(() => {
      const json = { version: 1, notas: Array.from({ length: 5001 }, (_, i) => ({ id: 'n' + i, texto: 't', creada: 1, editada: 1 })) };
      return { sinTope: window.Ceiba.validarImportacion(json, { limite: Infinity }), conTope: window.Ceiba.validarImportacion(json), conTope2: window.Ceiba.validarImportacion(json, {}) };
    });
    igual([r.sinTope.notas.length, r.sinTope.omitidas], [5001, 0]);
    igual(Object.keys(r.conTope), ['error']);
    igual(Object.keys(r.conTope2), ['error']);
    verdadero(r.conTope.error.includes('5.000'));
  });
});

await prueba('SEG-02: validarImportacion acepta fechas negativas dentro del rango de Date (reloj anterior a 1970) y rechaza las que se salen de ±8,64e15', async () => {
  await con({}, async page => {
    const r = await page.evaluate(() => {
      const n = (id, creada, editada) => ({ id, texto: 't', creada, editada });
      const out = window.Ceiba.validarImportacion({ version: 1, notas: [n('a', -18446399846, -18446399762), n('b', -8.64e15, 0), n('c', -8.64e15 - 1, 0), n('d', 0, 8.64e15 + 1), n('e', -Infinity, 0), n('f', NaN, 0)] });
      return { ids: out.notas.map(x => x.id), omitidas: out.omitidas };
    });
    igual(r.ids, ['a', 'b']);
    igual(r.omitidas, 4);
  });
});

await prueba('SEG-03: renderMarkdown acota los elementos que crea y lo dice; un texto normal no lleva aviso; el texto en línea no se pierde', async () => {
  await con({}, async page => {
    const r = await page.evaluate(() => {
      const contar = el => el.getElementsByTagName('*').length;
      const grande = window.Ceiba.renderMarkdown(Array.from({ length: 100000 }, () => '- a').join('\n'));
      const tabla = window.Ceiba.renderMarkdown('|a|b|\n|-|-|\n' + Array.from({ length: 50000 }, () => '|1|2|').join('\n'));
      const parrafo = window.Ceiba.renderMarkdown('`a` '.repeat(100000));
      const corto = window.Ceiba.renderMarkdown('# Título\n\n- uno\n- dos\n\ntexto');
      const citas = window.Ceiba.renderMarkdown(Array.from({ length: 30000 }, (_, i) => '> cita ' + i).join('\n\n'));
      const tareas = window.Ceiba.renderMarkdown(Array.from({ length: 40000 }, () => '- [ ] t').join('\n'));
      const vacios = el => Array.from(el.querySelectorAll('li, blockquote')).filter(e => !e.firstChild || (e.tagName === 'LI' && !e.textContent.trim() && !e.querySelector('input'))).length;
      return {
        vaciosLista: vacios(grande), vaciosCitas: vacios(citas), vaciosTareas: vacios(tareas), tareasAviso: /recortada/i.test(tareas.textContent),
        grande: contar(grande), grandeAviso: /recortada/i.test(grande.textContent),
        tabla: contar(tabla), tablaAviso: /recortada/i.test(tabla.textContent),
        parrafo: contar(parrafo), parrafoLetras: (parrafo.textContent.match(/a/g) || []).length, parrafoAviso: /recortada/i.test(parrafo.textContent),
        corto: contar(corto), cortoAviso: /recortada/i.test(corto.textContent),
      };
    });
    verdadero(r.grande > 1000 && r.grande <= 21000, `lista enorme: ${r.grande} elementos`);
    verdadero(r.grandeAviso, 'la lista enorme debe llevar el aviso de recorte');
    verdadero(r.tabla <= 21000 && r.tablaAviso, `tabla enorme: ${r.tabla} elementos, aviso ${r.tablaAviso}`);
    verdadero(r.parrafo <= 21000, `párrafo con 100.000 códigos en línea: ${r.parrafo} elementos`);
    verdadero(r.parrafoLetras >= 100000, 'el texto de un párrafo no se debe perder al degradar el formato');
    verdadero(!r.parrafoAviso, 'si no se pierde texto no hay aviso de recorte');
    igual([r.corto, r.cortoAviso], [5, false]);
    igual([r.vaciosLista, r.vaciosCitas, r.vaciosTareas], [0, 0, 0], 'al cortar no debe quedar ningún elemento de lista, cita ni tarea vacío');
    verdadero(r.tareasAviso, 'las tareas enormes también se recortan con aviso');
  });
});

await prueba('SEG-01: con el cuaderno lleno (5.000 notas) Deshacer no restaura una nota que lo pasaría del tope y lo explica', async () => {
  await con({ sembrar: { [CLAVE]: datos(muchas(5000), 'd0') } }, async page => {
    await page.locator('#lista').focus();
    await page.keyboard.press('Alt+Backspace');
    igual((await filas(page)).length, 4999);
    await page.keyboard.press('Alt+KeyN');
    igual((await filas(page)).length, 5000);
    await page.keyboard.press('Alt+KeyZ');
    igual((await guardado(page)).notas.length, 5000, 'el cuaderno no puede pasar de 5.000 notas');
    verdadero((await avisoDe(page, 'No se puede deshacer').count()) >= 1, 'debe explicar por qué no se restauró');
  });
});

// =====================================================================================
await cerrar();
await srv.cerrar();
process.exitCode = resumen('reg-ronda1');
