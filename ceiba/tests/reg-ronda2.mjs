// Pruebas de regresión de la ronda 2 de revisión (ceiba/app.html y ceiba/index.html).
// Cada prueba reproduce un hallazgo confirmado y se escribió ANTES de corregirlo (ver fallar, corregir, ver pasar).
// Ejecutar: node ceiba/tests/reg-ronda2.mjs      (FILTRO="texto" ejecuta solo las pruebas cuyo nombre coincida)
//
// Hallazgos cubiertos: SEC2-01 (nota con emojis alternados que congela la pestaña y vuelve a congelarla al recargar),
// SEC2-02 (saltos de línea \r y única nota pesada), SEC2-03 (vista previa hostil de 200 KB en menos de 2 s),
// A11Y2-01 (Esc sobre Limpiar/Borrar búsqueda), A11Y2-02 (cruzar 600 px mientras se escribe), V2-01 (tareas anidadas),
// V2-02 (móvil apaisado), H2-01 (landing sin JavaScript), R2-ROB-01 (eliminaciones hechas en otra pestaña).
import { servir, lanzar, prueba as pruebaBase, resumen, igual, verdadero } from './helpers.mjs';

const FILTRO = process.env.FILTRO ? new RegExp(process.env.FILTRO, 'i') : null;
const prueba = (nombre, fn) => (FILTRO && !FILTRO.test(nombre)) ? undefined : pruebaBase(nombre, fn);

const srv = await servir();
const { navegador, cerrar } = await lanzar();
const APP = srv.url + '/app.html';
const LANDING = srv.url + '/index.html';
const CLAVE = 'ceiba:notas:v1';
const MARCA = 'ceiba:abriendo:v1';
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
 * Abre la app en un contexto nuevo, ejecuta fn(page, registro, ctx, msCarga) y siempre cierra.
 * Opciones: ancho, alto, esquema, sembrar {clave: texto}, init {fn, arg}, reloj, sinReloj, tactil, pagina,
 * tiempo (tiempo máximo por operación, ms; por omisión 4000), sinJs (JavaScript desactivado).
 */
async function con(o, fn) {
  o = o || {};
  const ctx = await navegador.newContext({
    viewport: { width: o.ancho || 1440, height: o.alto || 900 },
    locale: 'es-ES', timezoneId: 'America/Bogota', colorScheme: o.esquema || 'light', reducedMotion: 'reduce',
    hasTouch: !!o.tactil, isMobile: false, acceptDownloads: true, javaScriptEnabled: !o.sinJs,
  });
  ctx.setDefaultTimeout(o.tiempo || 4000);
  if (o.sembrar) await ctx.addInitScript(sembrar, o.sembrar);
  if (o.init) await ctx.addInitScript(o.init.fn, o.init.arg);
  const page = await ctx.newPage();
  const reg = { consola: [], errores: [] };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') reg.consola.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => reg.errores.push(e.message));
  page.on('dialog', d => { d.dismiss().catch(() => {}); });
  try {
    // Con el reloj falso de Playwright performance.now() y requestAnimationFrame no miden tiempo real: las pruebas de rendimiento van sin él.
    if (o.sinReloj || o.sinJs) { /* reloj real */ }
    else if (o.reloj !== undefined) await page.clock.install({ time: o.reloj });
    else await page.clock.install({ time: T0 });
    const t0 = Date.now();
    await page.goto(o.pagina || APP);
    return await fn(page, reg, ctx, Date.now() - t0);
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
const guardado = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), CLAVE);
const textoDe = async loc => norm(await loc.textContent());
const filas = page => page.locator('#lista [role="option"]').evaluateAll(l => l.map(li => ({
  id: li.dataset.id, titulo: li.querySelector('.nota__titulo').textContent, seleccionada: li.getAttribute('aria-selected') === 'true',
})));
const avisos = page => page.locator('#avisos .aviso');
const avisoDe = (page, texto) => page.locator('#avisos .aviso', { hasText: texto });
const enFoco = (page, sel) => page.evaluate(s => document.activeElement === document.querySelector(s), sel);
const limpio = reg => { igual(reg.consola, [], 'consola'); igual(reg.errores, [], 'errores de página'); };
const lineas = (n, texto = 'a') => Array.from({ length: n }, () => texto).join('\n');
const lectura = (page, clave) => page.evaluate(k => localStorage.getItem(k), clave);

// =====================================================================================
console.log('\n[SEC2-01: una nota con maquetación patológica no puede bloquear la pestaña ni al recargar]');

await prueba('SEC2-01: si la vez anterior una nota no terminó de abrirse (marca "abriendo" en el almacenamiento), no se abre sola, se avisa y la marca se limpia', async () => {
  const notas = [nota('chica', 'Nota chica\ncon texto', T0 - HORA), nota('objetivo', 'Objetivo colgado\ntexto', T0)];
  await con({ sembrar: { [CLAVE]: datos(notas, 'objetivo'), [MARCA]: 'objetivo' } }, async (page, reg) => {
    verdadero((await editor(page).inputValue()).startsWith('Nota chica'), 'debe abrirse la otra nota, no la que dejó la marca');
    const aviso = avisoDe(page, 'no terminó de cargarse');
    igual(await aviso.count(), 1, 'debe avisar de qué nota no se abrió y por qué');
    verdadero((await textoDe(aviso)).includes('Objetivo colgado'), 'el aviso debe nombrar la nota');
    igual(await lectura(page, MARCA), null, 'la marca se limpia al arrancar para poder abrir la nota a mano');
    const g = await guardado(page);
    igual(g.activa, 'chica', 'la nota activa guardada debe cambiar: si no, la siguiente recarga volvería a abrir la nota colgada');
    igual(g.notas.length, 2, 'no se pierde ninguna nota');
    // la nota sigue en la lista y se puede abrir a mano
    await page.locator('#lista li[data-id="objetivo"]').click();
    verdadero((await editor(page).inputValue()).startsWith('Objetivo colgado'), 'abrirla a mano debe funcionar');
    limpio(reg);
  });
});

await prueba('SEC2-01: una marca que nombra una nota que ya no existe se ignora sin avisos', async () => {
  const notas = [nota('a', 'Primera\ntexto', T0), nota('b', 'Segunda', T0 - HORA)];
  await con({ sembrar: { [CLAVE]: datos(notas, 'a'), [MARCA]: 'fantasma' } }, async (page, reg) => {
    verdadero((await editor(page).inputValue()).startsWith('Primera'));
    igual(await avisos(page).count(), 0);
    igual(await lectura(page, MARCA), null);
    limpio(reg);
  });
});

await prueba('SEC2-01: al abrir una nota grande se escribe la marca ANTES de ponerle el texto al editor y se borra después; con una nota chica no se toca el almacenamiento', async () => {
  const espiar = () => {
    const reg = (window.__ops = window.__ops || []);
    const poner = Storage.prototype.setItem, quitar = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'ceiba:abriendo:v1') reg.push('marca:' + v); return poner.apply(this, arguments); };
    Storage.prototype.removeItem = function (k) { if (k === 'ceiba:abriendo:v1') reg.push('borra'); return quitar.apply(this, arguments); };
    const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(HTMLTextAreaElement.prototype, 'value', { get: d.get, set: function (v) { if (String(v).length > 20000) reg.push('texto'); return d.set.call(this, v); }, configurable: true });
  };
  const notas = [nota('chica', 'Nota chica\ncon texto', T0 - HORA), nota('grande', 'Nota grande\n' + 'palabra '.repeat(4000), T0 - 2 * HORA)];
  await con({ init: { fn: espiar }, sembrar: { [CLAVE]: datos(notas, 'chica') } }, async (page, reg) => {
    igual(await page.evaluate(() => window.__ops), [], 'abrir una nota chica no debe tocar la marca');
    await page.locator('#lista li[data-id="grande"]').click();
    verdadero((await editor(page).inputValue()).startsWith('Nota grande'));
    igual(await page.evaluate(() => window.__ops), ['marca:grande', 'texto', 'borra'], 'orden: marca, texto del editor, borrar la marca');
    igual(await lectura(page, MARCA), null, 'la marca no debe quedar una vez abierta la nota');
    limpio(reg);
  });
});

await prueba('SEC2-01: importar un archivo con una nota de 30.000 repeticiones de "emoji + espacio" la omite como demasiado pesada (no se guarda ni se puede abrir)', async () => {
  const pesada = 'Reacciones\n' + '\u{1F600} '.repeat(30000);
  const copia = { version: 1, notas: [nota('normal', 'Nota normal\ncon dos líneas', T0), nota('reacciones', pesada, T0 + 1000)] };
  await con({ sembrar: { [CLAVE]: datos([nota('a', 'Local', T0 - HORA)], 'a') } }, async (page, reg) => {
    await page.locator('#respaldo').click();
    await page.setInputFiles('#archivo-importar', { name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copia)) });
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'debe aparecer el informe');
    const informe = await textoDe(avisoDe(page, 'Importación lista').first());
    verdadero(/1 añadida\b/.test(informe) && /1 omitida\b/.test(informe), `informe inesperado: ${informe}`);
    verdadero(/demasiad[ao]s? larg|pesad/i.test(informe), `el informe debe decir por qué se omitió: ${informe}`);
    igual((await guardado(page)).notas.map(n => n.id).sort(), ['a', 'normal']);
    limpio(reg);
  });
});

await prueba('SEC2-01: si lo guardado ya trae una nota de emojis alternados como activa, la app arranca en menos de 3 s con otra nota y avisa', async () => {
  const pesada = 'Reacciones\n' + '\u{1F600} '.repeat(30000);
  const notas = [nota('chica', 'Nota chica\ncon texto', T0 - HORA), nota('reacciones', pesada, T0)];
  await con({ sinReloj: true, tiempo: 120000, sembrar: { [CLAVE]: datos(notas, 'reacciones') } }, async (page, reg, ctx, ms) => {
    verdadero(ms < 3000, `la carga tardó ${ms} ms: la nota de emojis se abrió sola`);
    verdadero((await editor(page).inputValue()).startsWith('Nota chica'), 'debe abrirse la nota liviana');
    verdadero((await avisoDe(page, 'Reacciones').count()) === 1, 'debe avisar de la nota que no se abrió');
    igual((await guardado(page)).notas.length, 2, 'no se pierde ninguna nota');
    limpio(reg);
  });
});

await prueba('SEC2-01: una nota con 500 emojis alternados con texto en una sola línea (uso normal, muy por debajo del tope) se abre sola y no se omite al importar', async () => {
  const texto = 'Reacciones\n' + '\u{1F600} gracias '.repeat(500);
  const copia = { version: 1, notas: [nota('r2', texto, T0)] };
  await con({ sembrar: { [CLAVE]: datos([nota('r', texto, T0)], 'r') } }, async page => {
    verdadero((await editor(page).inputValue()).startsWith('Reacciones'), 'debe abrirse sola');
    igual(await avisos(page).count(), 0, 'sin avisos');
    await page.locator('#respaldo').click();
    await page.setInputFiles('#archivo-importar', { name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copia)) });
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'debe aparecer el informe');
    verdadero(/1 añadida\b/.test(await textoDe(avisoDe(page, 'Importación lista').first())), 'la nota normal con emojis debe importarse');
  });
});

// =====================================================================================
console.log('\n[SEC2-02: \\r como salto de línea y única nota pesada]');

await prueba('SEC2-02: una nota activa con 400.000 saltos "\\r" cuenta como pesada: no se abre sola, arranca otra y se avisa', async () => {
  const notas = [nota('cr', 'Registro con retornos\n' + '\r'.repeat(400000), T0), nota('b', '# Normal\ntexto', T0 - HORA)];
  await con({ sinReloj: true, tiempo: 120000, sembrar: { [CLAVE]: datos(notas, 'cr') } }, async (page, reg, ctx, ms) => {
    verdadero((await editor(page).inputValue()).startsWith('# Normal'), 'debe abrirse la nota liviana, no la de retornos');
    verdadero((await avisoDe(page, 'Registro con retornos').count()) === 1, 'debe avisar de la nota que no se abrió');
    verdadero(ms < 3000, `la carga tardó ${ms} ms`);
    igual((await guardado(page)).notas.length, 2, 'no se pierde ninguna nota');
    limpio(reg);
  });
});

await prueba('SEC2-02: al importar, una nota con 400.000 saltos "\\r" se omite igual que una de más de 50.000 líneas', async () => {
  const copia = { version: 1, notas: [nota('normal', 'Nota normal', T0), nota('cr', 'Retornos\n' + '\r'.repeat(400000), T0)] };
  await con({ tiempo: 20000, sembrar: { [CLAVE]: datos([nota('a', 'Local', T0 - HORA)], 'a') } }, async page => {
    await page.locator('#respaldo').click();
    await page.setInputFiles('#archivo-importar', { name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copia)) });
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'debe aparecer el informe', 15000);
    const informe = await textoDe(avisoDe(page, 'Importación lista').first());
    verdadero(/1 añadida\b/.test(informe) && /1 omitida\b/.test(informe), `informe inesperado: ${informe}`);
    igual((await guardado(page)).notas.map(n => n.id).sort(), ['a', 'normal']);
  });
});

await prueba('SEC2-02: si la única nota es pesada no se abre sola: la lista la muestra, no hay editor y el aviso dice que ninguna se abrió', async () => {
  await con({ sinReloj: true, tiempo: 120000, sembrar: { [CLAVE]: datos([nota('sola', 'Registro enorme\n' + lineas(300000, 'a'), T0)], 'sola') } }, async (page, reg, ctx, ms) => {
    verdadero((await avisoDe(page, 'Ninguna nota se abrió sola').count()) === 1, 'debe avisar de que ninguna nota se abrió sola');
    igual(await page.locator('#lienzo').isVisible(), false, 'no debe haber editor abierto');
    igual((await filas(page)).map(f => f.titulo), ['Registro enorme'], 'la nota sigue en la lista');
    const titulo = await textoDe(page.locator('#vacio .vacio__titulo'));
    verdadero(!/vac[ií]o/i.test(titulo), `el panel no debe decir que el cuaderno está vacío si hay notas: "${titulo}"`);
    verdadero(ms < 3000, `la carga tardó ${ms} ms`);
    igual((await guardado(page)).notas.length, 1, 'la nota no se elimina');
    limpio(reg);
  });
});

// =====================================================================================
console.log('\n[SEC2-03: vista previa hostil de 200 KB]');

/** Tiempo síncrono de Alt+P hasta maquetar la vista previa (el editor ya está maquetado antes de empezar a medir). */
function medirVista(page, texto) {
  return page.evaluate(t => {
    const ed = document.getElementById('editor');
    ed.value = t; ed.dispatchEvent(new Event('input', { bubbles: true }));
    void ed.scrollHeight;
    const a = performance.now();
    document.getElementById('modo').click();
    const v = document.getElementById('vista');
    void v.getBoundingClientRect();
    const dt = performance.now() - a;
    return { ms: Math.round(dt), elementos: v.querySelectorAll('*').length, caracteres: v.textContent.length, recorte: /recortada/i.test(v.textContent) };
  }, texto);
}

const hostiles = [
  ['"`` `" repetido hasta 200 KB (códigos en línea con un solo espacio)', '`` `'.repeat(50000)],
  ['"` `" repetido hasta 200 KB', '` `'.repeat(100000)],
  ['"a\\0" repetido 100.000 veces (200 KB)', 'a\0'.repeat(100000)],
  ['"\\0" repetido 200.000 veces', '\0'.repeat(200000)],
  ['U+FFFD repetido 200.000 veces', '\uFFFD'.repeat(200000)],
  ['"emoji + espacio" repetido 30.000 veces', '\u{1F600} '.repeat(30000)],
  ['"kanji + espacio" repetido hasta 200 KB', '日本語 '.repeat(50000)],
];
for (const [nombre, texto] of hostiles) {
  await prueba(`SEC2-03: ${nombre} se previsualiza en menos de 2 s`, async () => {
    await con({ sinReloj: true, tiempo: 120000 }, async (page, reg) => {
      const r = await medirVista(page, texto);
      verdadero(r.ms < 2000, `la vista previa tardó ${r.ms} ms (${r.elementos} elementos)`);
      verdadero(r.caracteres > 0, 'la vista previa no debe quedar vacía');
      limpio(reg);
    });
  });
}

await prueba('SEC2-03: lo que se deja fuera de la vista previa por exceso de caracteres especiales se dice en el aviso de recorte', async () => {
  await con({ sinReloj: true, tiempo: 120000 }, async page => {
    const r = await medirVista(page, 'a\0'.repeat(100000));
    verdadero(r.recorte, 'debe decir que la vista previa está recortada');
  });
});

await prueba('SEC2-03: un código en línea que solo tiene espacios queda como texto; los códigos en línea con contenido no cambian', async () => {
  await con({}, async page => {
    const r = await page.evaluate(() => {
      const html = t => window.Ceiba.renderMarkdown(t).innerHTML;
      return { vacio: html('` `'), vacioDoble: html('`` `'), normal: html('`a` y ``b`c``'), conEspacios: html('`  x  `') };
    });
    igual(r.vacio, '<p>` `</p>');
    igual(r.vacioDoble, '<p>`` `</p>');
    igual(r.normal, '<p><code>a</code> y <code>b`c</code></p>');
    igual(r.conEspacios, '<p><code> x </code></p>');
  });
});

await prueba('SEC2-03: un documento denso realista de 200 KB (código en línea, negritas, enlaces, tablas y tareas) no se recorta y se previsualiza en menos de 1 s', async () => {
  const parrafo = 'Texto de **ejemplo** con `codigo` y un [enlace](https://ejemplo.org/a) más *énfasis* y ~~tachado~~ para dar densidad realista a la nota que se escribe cada día. ';
  const bloque = '## Sección\n\n' + parrafo.repeat(2) + '\n\n- [x] hecho `uno`\n- [ ] pendiente **dos**\n\n| a | b |\n|---|---|\n| `x` | **y** |\n\n';
  const texto = bloque.repeat(Math.ceil(200000 / bloque.length));
  await con({ sinReloj: true, tiempo: 60000 }, async (page, reg) => {
    const r = await medirVista(page, texto);
    verdadero(r.ms < 1000, `el documento denso tardó ${r.ms} ms`);
    verdadero(!r.recorte, 'un documento denso pero normal no debe recortarse');
    limpio(reg);
  });
});

await prueba('SEC2-03: una nota con emojis repartidos de forma normal (cientos, uno por frase) no se recorta', async () => {
  const texto = Array.from({ length: 400 }, (_, i) => `Frase ${i} con un emoji \u{1F600} y otro \u{1F680} en medio.`).join('\n');
  await con({ sinReloj: true }, async page => {
    const r = await medirVista(page, texto);
    verdadero(!r.recorte, 'no debe recortarse');
    verdadero(r.caracteres > texto.length * 0.8, 'el texto debe verse casi completo');
  });
});

// =====================================================================================
console.log('\n[A11Y2-01: Esc sobre Limpiar búsqueda y Borrar búsqueda]');

const tres = () => [nota('a', 'Uno\ntexto uno', T0 - 3 * MIN), nota('b', 'Dos\ntexto dos', T0 - 2 * MIN), nota('c', 'Tres\ntexto tres', T0 - MIN)];

await prueba('A11Y2-01: Esc con el foco en "Limpiar búsqueda" (con resultados) borra el filtro y el foco pasa a la lista, no a BODY', async () => {
  await con({ sembrar: { [CLAVE]: datos(tres(), 'c') } }, async page => {
    await page.keyboard.press('Control+KeyK');
    await page.keyboard.type('dos');
    await page.keyboard.press('Tab');
    verdadero(await enFoco(page, '#limpiar'), 'condición previa: el foco debe estar en Limpiar búsqueda');
    await page.keyboard.press('Escape');
    igual(await page.locator('#busqueda').inputValue(), '');
    igual((await filas(page)).length, 3, 'vuelven todas las notas');
    const donde = await page.evaluate(() => { const a = document.activeElement; return a.id || a.tagName; });
    igual(donde, 'lista', `el foco debe volver a la lista (está en ${donde})`);
  });
});

await prueba('A11Y2-01: Esc con el foco en "Borrar búsqueda" (sin resultados) borra el filtro y el foco pasa a la lista, no a BODY', async () => {
  await con({ sembrar: { [CLAVE]: datos(tres(), 'c') } }, async page => {
    await page.keyboard.press('Control+KeyK');
    await page.keyboard.type('zzz');
    await page.keyboard.press('Tab');
    verdadero(await enFoco(page, '#borrar-busqueda'), 'condición previa: el foco debe estar en Borrar búsqueda');
    await page.keyboard.press('Escape');
    igual(await page.locator('#busqueda').inputValue(), '');
    const donde = await page.evaluate(() => { const a = document.activeElement; return a.id || a.tagName; });
    igual(donde, 'lista', `el foco debe volver a la lista (está en ${donde})`);
  });
});

// =====================================================================================
console.log('\n[A11Y2-02: cruzar 600 px mientras se escribe]');

await prueba('A11Y2-02: al pasar de 1100 a 550 px (zoom al 200 %) escribiendo en el editor, el editor sigue a la vista y con el foco', async () => {
  await con({ sinReloj: true, ancho: 1100, alto: 800 }, async (page, reg) => {
    await editor(page).click();
    await page.keyboard.type(' texto nuevo');
    verdadero(await enFoco(page, '#editor'), 'condición previa: el foco debe estar en el editor');
    await page.setViewportSize({ width: 550, height: 400 });
    await page.waitForTimeout(150);
    igual(await page.locator('#app').getAttribute('data-vista'), 'editor', 'la vista debe ser el editor');
    verdadero(await editor(page).isVisible(), 'el editor debe seguir visible');
    verdadero(await enFoco(page, '#editor'), 'el foco no debe caer a BODY');
    verdadero((await editor(page).inputValue()).includes('texto nuevo'), 'el texto escrito se conserva');
    limpio(reg);
  });
});

await prueba('A11Y2-02: girar un móvil de 740x360 a 360x740 con el foco en el editor mantiene el editor y el foco', async () => {
  await con({ sinReloj: true, ancho: 740, alto: 360, tactil: true }, async page => {
    await editor(page).click();
    await page.keyboard.type(' girado');
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(150);
    igual(await page.locator('#app').getAttribute('data-vista'), 'editor');
    verdadero(await editor(page).isVisible() && await enFoco(page, '#editor'), 'el editor debe verse y conservar el foco');
  });
});

await prueba('A11Y2-02: con el foco en la lista, estrechar la ventana por debajo de 600 px deja la lista (no se salta al editor)', async () => {
  await con({ sinReloj: true, ancho: 1100, alto: 800 }, async page => {
    await page.locator('#lista').focus();
    await page.setViewportSize({ width: 550, height: 400 });
    await page.waitForTimeout(150);
    igual(await page.locator('#app').getAttribute('data-vista'), 'lista');
    verdadero(await enFoco(page, '#lista'), 'el foco sigue en la lista');
  });
});

// =====================================================================================
console.log('\n[V2-01: tareas anidadas en la vista previa]');

const TAREAS = [
  '- [ ] Preparar la mudanza',
  '  - [x] Pedir cajas',
  '  - [ ] Reservar camión',
  '    - [ ] Llamar al proveedor',
  '- [ ] Comprar semillas para el huerto de la terraza, tierra, macetas y una regadera pequeña que quepa en el balcón sin estorbar el paso',
].join('\n');

for (const ancho of [360, 1440]) {
  await prueba(`V2-01: a ${ancho} px las tareas anidadas se sangran por nivel y las líneas envueltas se alinean con el texto (sangría francesa)`, async () => {
    await con({ ancho, alto: 900, sembrar: { [CLAVE]: datos([nota('t', TAREAS, T0)], 't') } }, async page => {
      await page.locator('#lista li[data-id="t"]').click();            // en 360 px la lista ocupa toda la pantalla: se abre la nota
      await page.locator('#modo').click();
      const m = await page.evaluate(() => {
        const lis = [...document.querySelectorAll('#vista li.tarea')];
        const cajas = lis.map(li => li.querySelector(':scope > input').getBoundingClientRect().left);
        const largo = lis[lis.length - 1];
        const cb = largo.querySelector(':scope > input').getBoundingClientRect();
        const texto = [...largo.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
        const rango = document.createRange(); rango.selectNodeContents(texto);
        const lineas = [...rango.getClientRects()].map(r => r.left);
        return { cajas, lineas, derechaCaja: cb.right };
      });
      // orden del documento: 0 Preparar, 1 Pedir, 2 Reservar, 3 Llamar, 4 Comprar
      verdadero(m.cajas[1] > m.cajas[0] + 12, `nivel 1 debe ir más a la derecha que el nivel 0: ${JSON.stringify(m.cajas)}`);
      verdadero(m.cajas[3] > m.cajas[1] + 12, `nivel 2 debe ir más a la derecha que el nivel 1: ${JSON.stringify(m.cajas)}`);
      igual(Math.round(m.cajas[1]), Math.round(m.cajas[2]), 'dos tareas del mismo nivel comparten sangría');
      verdadero(m.lineas.length >= 2, `la tarea larga debe envolverse en varias líneas (${m.lineas.length})`);
      verdadero(Math.abs(m.lineas[0] - m.lineas[m.lineas.length - 1]) < 2, `las líneas envueltas deben alinearse con el texto de la primera: ${JSON.stringify(m.lineas)}`);
      verdadero(m.derechaCaja <= m.lineas[0] + 1, 'la casilla no debe pisar el texto');
    });
  });
}

// =====================================================================================
console.log('\n[V2-02: móvil apaisado]');

const treinta = () => Array.from({ length: 30 }, (_, i) => nota('n' + i, `Nota número ${i}\ntexto de la nota ${i}`, T0 - (i + 1) * MIN));
const APAISADOS = [[740, 360], [667, 375], [844, 390], [896, 414], [915, 412], [932, 430]];

await prueba('V2-02: en móvil apaisado (600-932 px de ancho, menos de 450 px de alto) con 30 notas y plan elegido la lista muestra al menos 150 px', async () => {
  const mal = [];
  for (const [ancho, alto] of APAISADOS) {
    await con({ ancho, alto, tactil: true, pagina: APP + '?plan=bosque&ciclo=anual', sembrar: { [CLAVE]: datos(treinta(), 'n0') } }, async page => {
      const v = await page.evaluate(() => {
        const r = document.querySelector('.lista-nav').getBoundingClientRect();
        return Math.round(Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      });
      if (v < 150) mal.push(`${ancho}x${alto}: ${v} px`);
    });
  }
  igual(mal, [], 'la lista debe poder verse con comodidad');
});

await prueba('V2-02: en móvil apaisado el pie (Tema, Copia, Atajos) y el indicador de plan siguen alcanzables con el teclado', async () => {
  for (const [ancho, alto] of [[740, 360], [915, 412]]) {
    await con({ ancho, alto, tactil: true, pagina: APP + '?plan=bosque&ciclo=anual', sembrar: { [CLAVE]: datos(treinta(), 'n0') } }, async page => {
      await page.locator('#atajos').focus();
      const r = await page.evaluate(() => { const b = document.getElementById('atajos').getBoundingClientRect(); return { arriba: b.top, abajo: b.bottom, alto: window.innerHeight }; });
      verdadero(r.arriba >= 0 && r.abajo <= r.alto + 1, `${ancho}x${alto}: el botón Atajos queda fuera de la pantalla (${JSON.stringify(r)})`);
    });
  }
});

await prueba('V2-02: en apaisado de 900 px o más con poca altura existe el botón "Ocultar lista" y oculta y muestra la barra lateral', async () => {
  await con({ ancho: 915, alto: 412, tactil: true, sembrar: { [CLAVE]: datos(treinta(), 'n0') } }, async page => {
    const boton = page.locator('#lateral-alternar');
    verdadero(await boton.isVisible(), 'falta el botón Ocultar lista');
    await boton.click();
    verdadero(!(await page.locator('#lateral').isVisible()), 'la barra lateral debe ocultarse');
    igual(await boton.getAttribute('aria-expanded'), 'false');
    await boton.click();
    verdadero(await page.locator('#lateral').isVisible(), 'la barra lateral debe volver');
  });
});

await prueba('V2-02: en escritorio alto (1440x900) no cambia nada: no hay botón Ocultar lista y la lista ocupa el resto de la barra', async () => {
  await con({ sembrar: { [CLAVE]: datos(treinta(), 'n0') } }, async page => {
    verdadero(!(await page.locator('#lateral-alternar').isVisible()));
    const alto = await page.evaluate(() => document.querySelector('.lista-nav').getBoundingClientRect().height);
    verdadero(alto > 450, `la lista debe ocupar el resto de la barra (${alto} px)`);
  });
});

// =====================================================================================
console.log('\n[H2-01: landing sin JavaScript]');

await prueba('H2-01: sin JavaScript la comparativa no queda vacía: lista las diez funciones y Bosque marca "En preparación" en las tres que no existen', async () => {
  await con({ sinJs: true, pagina: LANDING }, async page => {
    const tablas = await page.locator('#comparativa table:visible').evaluateAll(ts => ts.map(t => ({
      filas: [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent.trim().replace(/\s+/g, ' '))),
    })));
    igual(tablas.length, 1, 'debe verse una sola tabla comparativa');
    igual(tablas[0].filas.length, 10, 'la tabla visible no debe estar vacía');
    const preparacion = tablas[0].filas.filter(f => f[3] === 'En preparación').map(f => f[0]);
    igual(preparacion, ['Espacios compartidos para equipos', 'Sincronización entre dispositivos', 'Soporte por correo en 24 h']);
  });
});

await prueba('H2-01: sin JavaScript la sección de planes avisa de que parte de Bosque está en preparación y enlaza a la comparativa', async () => {
  await con({ sinJs: true, pagina: LANDING }, async page => {
    const planes = norm(await page.locator('#planes').innerText());
    verdadero(/en preparación/i.test(planes) && /Bosque/.test(planes), `falta el aviso de funciones en preparación junto a los precios: ${planes}`);
    verdadero((await page.locator('#planes a[href="#comparativa"]').count()) >= 1, 'debe enlazar a la comparativa');
  });
});

await prueba('H2-01: con JavaScript sigue habiendo una sola tabla comparativa visible y coincide con la versión sin JavaScript', async () => {
  await con({ pagina: LANDING }, async page => {
    const r = await page.evaluate(() => {
      const leer = t => [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent.trim().replace(/\s+/g, ' ')));
      const visibles = [...document.querySelectorAll('#comparativa table')].filter(t => t.getClientRects().length > 0);
      const ns = document.querySelector('#comparativa noscript');
      const estatica = ns ? leer(new DOMParser().parseFromString(ns.textContent, 'text/html')) : null;
      return { visibles: visibles.length, filas: visibles[0] ? leer(visibles[0]) : null, estatica };
    });
    igual(r.visibles, 1);
    verdadero(r.estatica !== null, 'la comparativa debe llevar su versión <noscript>');
    igual(r.estatica, r.filas, 'la tabla de <noscript> debe coincidir con la generada desde el objeto de planes');
  });
});

// =====================================================================================
console.log('\n[R2-ROB-01: eliminaciones hechas en otra pestaña]');

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
const ids = async page => (await guardado(page)).notas.map(n => n.id).sort();
// Sin reloj falso: las fechas de lo sembrado van relativas al reloj real (las ediciones nuevas deben ser posteriores a ellas).
const base3 = () => { const r = Date.now(); return [nota('alfa', 'Alfa', r - 3 * MIN), nota('beta', 'Beta', r - 2 * MIN), nota('gamma', 'Gamma', r - 1 * MIN)]; };

await prueba('R2-ROB-01: A elimina "Beta"; B (desactualizada) solo cambia de nota con las flechas: la nota eliminada no vuelve al almacenamiento ni al recargar A', async () => {
  await conDosPestanas(base3(), 'alfa', async (a, b) => {
    await a.locator('#lista').focus();
    await a.keyboard.press('ArrowUp');                                  // la lista va de la más reciente (Gamma) a la más antigua (Alfa): Alfa -> Beta
    verdadero((await filas(a)).find(f => f.seleccionada).titulo === 'Beta', 'condición previa: A debe tener Beta activa');
    await a.keyboard.press('Alt+Backspace');
    await esperar(async () => (await ids(a)).join() === 'alfa,gamma', 'A debe haber guardado la eliminación');
    await esperar(async () => (await avisoDe(b, 'otra pestaña').count()) === 1, 'B debe mostrar el aviso de otra pestaña');
    await b.locator('#lista').focus();
    await b.keyboard.press('ArrowUp');                                  // B cambia de nota (la ve aún) -> guarda
    await b.waitForTimeout(150);
    await b.keyboard.press('ArrowUp');
    await b.waitForTimeout(150);
    igual(await ids(b), ['alfa', 'gamma'], 'la nota eliminada en A no debe volver al almacenamiento por moverse en B');
    await a.reload();
    igual((await filas(a)).map(f => f.titulo).sort(), ['Alfa', 'Gamma'], 'al recargar A no debe reaparecer Beta');
  });
});

await prueba('R2-ROB-01: A elimina las tres notas; B escribe una letra: solo vuelve la nota editada en B, no las que B no tocó', async () => {
  await conDosPestanas(base3(), 'gamma', async (a, b) => {
    await a.locator('#lista').focus();
    for (let i = 0; i < 3; i++) { await a.keyboard.press('Alt+Backspace'); await a.waitForTimeout(80); }
    await esperar(async () => (await ids(a)).length === 0, 'A debe haber eliminado las tres notas');
    await esperar(async () => (await avisoDe(b, 'otra pestaña').count()) === 1, 'B debe mostrar el aviso de otra pestaña');
    await editor(b).click();
    await b.keyboard.press('Control+End');
    await b.keyboard.type('x');
    await esperar(async () => (await ids(b)).length >= 1, 'B debe guardar lo que escribió');
    await b.waitForTimeout(400);
    igual(await ids(b), ['gamma'], 'solo la nota que se editó en B vuelve; las otras dos siguen eliminadas');
  });
});

await prueba('R2-ROB-01: una nota que A eliminó y B editó después (editada más reciente) sí se conserva con la edición de B', async () => {
  await conDosPestanas(base3(), 'beta', async (a, b) => {
    await a.locator('#lista').focus();
    await a.keyboard.press('Alt+Backspace');                            // A elimina Beta (la activa)
    await esperar(async () => (await ids(a)).join() === 'alfa,gamma', 'A debe haber guardado la eliminación');
    await esperar(async () => (await avisoDe(b, 'otra pestaña').count()) === 1, 'B debe mostrar el aviso de otra pestaña');
    await editor(b).click();
    await b.keyboard.press('Control+End');
    await b.keyboard.type(' editada en B');
    await esperar(async () => (await ids(b)).includes('beta'), 'la edición hecha en B debe guardarse');
    const g = await guardado(b);
    verdadero(g.notas.find(n => n.id === 'beta').texto.includes('editada en B'));
    igual(await ids(b), ['alfa', 'beta', 'gamma']);
  });
});

await prueba('R2-ROB-01: lo que ya funcionaba sigue igual: una nota nueva creada en A se conserva cuando B (desactualizada) guarda', async () => {
  await conDosPestanas(base3(), 'alfa', async (a, b) => {
    await a.keyboard.press('Alt+KeyN');
    await a.keyboard.type('NOTA NUEVA DE A');
    await esperar(async () => (await guardado(a)).notas.some(n => n.texto === 'NOTA NUEVA DE A'), 'A debe guardar su nota');
    await b.locator('#lista').focus();
    await b.keyboard.press('ArrowDown');
    await b.waitForTimeout(200);
    verdadero((await guardado(b)).notas.some(n => n.texto === 'NOTA NUEVA DE A'), 'la nota de A debe seguir en el almacenamiento');
    igual((await guardado(b)).notas.length, 4);
  });
});

// =====================================================================================
await cerrar();
await srv.cerrar();
process.exitCode = resumen('reg-ronda2');
