// Pruebas de extremo a extremo de la aplicación (ceiba/app.html). Ejecutar: node ceiba/tests/e2e.mjs
//
// PRIMERA PARTE (Task 3): primera ejecución, crear/escribir/persistir, orden y tiempos, marca de
// edición, búsqueda con resaltado, almacenamiento robusto, diseño base y accesibilidad básica.
// SEGUNDA PARTE (Task 4): alternador Escribir/Vista previa, Alt+N, eliminar con Deshacer de 8 s, teclado
// de la lista, búsqueda con Ctrl/Cmd+K y "/", Esc, diálogo de atajos, modo enfoque, continuación de listas
// y un ciclo completo solo con teclado.
// TERCERA PARTE (Task 5): tema claro/oscuro/sistema, plan de demostración (?plan=&ciclo=), exportar nota a .md, copia de
// seguridad (exportar todo e importar con validación y fusión), avisos de almacenamiento no disponible o lleno, aviso por
// el evento storage (dos pestañas), vista móvil de menos de 600 px, teclado virtual simulado y objetivos táctiles de 44 px.
// (El contrato de interfaz de la Task 5 está comentado al comienzo de esa parte, más abajo.)
//
// Contrato añadido en la Task 4:
//   #modo (botón "Vista previa", aria-pressed), #vista (article tabindex=0, nombre "Vista previa de la nota"),
//   #eliminar (botón "Eliminar"), #atajos (botón "Atajos", en el pie de la barra lateral),
//   #ayuda (dialog modal "Atajos de teclado", filas .atajo con dt + kbd, botón "Cerrar"),
//   aviso de eliminación: #avisos .aviso con botón "Deshacer" (texto "Se eliminó «título»"),
//   #enfoque (botón "Modo enfoque", aria-pressed, en la barra de estado), :root[data-enfoque="si"] cuando está activo,
//   prefs: ceiba:prefs:v1 { foco: true } (se conservan las demás claves).
//
// Contrato de interfaz que estas pruebas dan por hecho (ids y roles estables):
//   #lista [role=listbox][aria-label="Notas"] > li[role=option][data-id][aria-selected]
//        .nota__titulo  .nota__extracto  time.nota__tiempo[datetime][title]  (mark dentro de título/extracto)
//   #busqueda [type=search] (rol searchbox, nombre "Buscar notas"), #cuenta (contador visible),
//   #sin-resultados (con el botón "Borrar búsqueda"), #lista-vacia, botón "Nueva nota",
//   #editor (textarea, aria-label "Texto de la nota"), #vacio (estado sin notas),
//   barra de estado: #est-guardado #est-palabras #est-caracteres #est-edicion (con <time id="est-fecha">),
//   #avisos .aviso (avisos visibles), una única región [aria-live] (#vivo), main#contenido, botón "Volver a la lista".
import fs from 'node:fs';
import path from 'node:path';
import { servir, lanzar, prueba as pruebaBase, resumen, igual, verdadero, RAIZ } from './helpers.mjs';

// FILTRO="texto" (regex, sin distinguir mayúsculas) ejecuta solo las pruebas cuyo nombre coincida. Sin FILTRO corren todas.
const FILTRO = process.env.FILTRO ? new RegExp(process.env.FILTRO, 'i') : null;
const prueba = (nombre, fn) => (FILTRO && !FILTRO.test(nombre)) ? undefined : pruebaBase(nombre, fn);

const srv = await servir();
const { navegador, cerrar } = await lanzar();
const PAGINA = srv.url + '/app.html';
const CLAVE = 'ceiba:notas:v1';
const PREFS = 'ceiba:prefs:v1';
const T0 = Date.parse('2026-10-16T10:32:00-05:00');   // instante de referencia de los relojes falsos
const MIN = 60000, HORA = 3600000, DIA = 86400000;
const EMOJI = /\p{Extended_Pictographic}|\uFE0F/u;
const norm = s => String(s).replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ utilidades
const nota = (id, texto, editada, creada = editada) => ({ id, texto, creada, editada });
const datos = (notas, activa) => JSON.stringify({ version: 1, notas, activa: activa === undefined ? (notas[0] ? notas[0].id : null) : activa });

/** Siembra localStorage una sola vez por pestaña (la marca en sessionStorage evita volver a sembrar al recargar). */
function sembrar(claves) {
  try {
    if (!/app\.html$/.test(location.pathname)) return;     // otras pestañas del mismo contexto (la landing) no vuelven a sembrar
    if (sessionStorage.getItem('__sembrado')) return;
    sessionStorage.setItem('__sembrado', '1');
    for (const k of Object.keys(claves)) localStorage.setItem(k, claves[k]);
  } catch (e) { /* contexto sin almacenamiento */ }
}

/**
 * Abre la app en un contexto nuevo, ejecuta fn(page, registro, ctx) y siempre cierra.
 * Opciones: ancho, alto, esquema, sembrar {clave: texto}, init {fn, arg}, reloj (ms; reloj detenido en ese instante),
 * consulta (texto que se añade a la URL, por ejemplo '?plan=brote&ciclo=anual').
 */
async function con(opciones, fn) {
  const o = opciones || {};
  const ctx = await navegador.newContext({
    viewport: { width: o.ancho || 1440, height: o.alto || 900 },
    locale: 'es-ES', timezoneId: 'America/Bogota', colorScheme: o.esquema || 'light', reducedMotion: 'reduce',
  });
  ctx.setDefaultTimeout(4000);
  if (o.sembrar) await ctx.addInitScript(sembrar, o.sembrar);
  if (o.init) await ctx.addInitScript(o.init.fn, o.init.arg);
  const page = await ctx.newPage();
  const reg = { consola: [], errores: [], peticiones: [], dialogos: [] };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') reg.consola.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => reg.errores.push(e.message));
  page.on('request', r => reg.peticiones.push(r.url()));
  page.on('dialog', d => { reg.dialogos.push(d.message()); d.dismiss().catch(() => {}); });
  try {
    // Sin "reloj": el tiempo corre con normalidad pero parte de T0, para que el orden y las fechas no dependan del reloj real.
    if (o.reloj) { await page.clock.install({ time: o.reloj - 1000 }); await page.clock.pauseAt(o.reloj); }
    else await page.clock.install({ time: T0 });
    await page.goto(PAGINA + (o.consulta || ''));
    return await fn(page, reg, ctx);
  } finally { await ctx.close(); }
}

async function esperar(fn, msg, ms = 3000) {
  const fin = Date.now() + ms; let ultimo;
  for (;;) {
    try { const r = await fn(); if (r) return r; ultimo = r; } catch (e) { ultimo = e; }
    if (Date.now() > fin) throw new Error(`${msg} (tras ${ms} ms; último: ${ultimo && ultimo.message ? ultimo.message : JSON.stringify(ultimo)})`);
    await new Promise(r => setTimeout(r, 25));
  }
}

const editor = page => page.getByRole('textbox', { name: 'Texto de la nota' });
const busqueda = page => page.getByRole('searchbox', { name: 'Buscar notas' });
const nueva = page => page.getByRole('button', { name: 'Nueva nota', exact: true });
const guardado = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), CLAVE);
const textoDe = async loc => norm(await loc.textContent());
const filas = page => page.locator('#lista [role="option"]').evaluateAll(l => l.map(li => ({
  id: li.dataset.id,
  titulo: li.querySelector('.nota__titulo').textContent,
  extracto: li.querySelector('.nota__extracto').textContent,
  tiempo: li.querySelector('time').textContent,
  seleccionada: li.getAttribute('aria-selected') === 'true',
})));
const titulos = async page => (await filas(page)).map(f => f.titulo);
const notaGuardada = async (page, id) => (await guardado(page)).notas.find(n => n.id === id);
const fecha = (page, ms) => page.evaluate(m => window.Ceiba.fechaCompleta(m), ms);
const limpio = reg => { igual(reg.consola, [], 'consola'); igual(reg.errores, [], 'errores de página'); };
async function escribir(page, texto) { await editor(page).focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(texto); }

const AMBIENTE = [
  nota('arbol', 'Árbol de la ceiba\nSu tronco tiene espinas y da sombra al pueblo.', T0 - 1 * HORA),
  nota('arepas', 'Receta de arepas\nHarina de maíz, agua y sal.\n\nSe acompañan con queso.', T0 - 2 * HORA),
  nota('compras', 'Lista de compras\n- queso\n- harina\n- café', T0 - 3 * HORA),
  nota('ideas', 'Ideas\nUn cuento sobre una CEIBA y un pueblo con queso.', T0 - 4 * HORA),
];
const SIEMBRA_AMBIENTE = { [CLAVE]: datos(AMBIENTE, 'arbol') };

/** Oráculo independiente de la búsqueda: sin tildes ni mayúsculas, todas las palabras. */
const plano = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const oraculo = (consulta, notas) => {
  const ps = plano(consulta).split(/\s+/).filter(Boolean);
  return notas.filter(n => ps.every(p => plano(n.texto).includes(p))).map(n => n.texto.split('\n')[0]);
};

// =====================================================================================
console.log('\n[primera ejecución y estado vacío]');

await prueba('primera ejecución: crea la nota "Bienvenida a Ceiba", activa, y la guarda con el esquema de la spec', async () => {
  await con({}, async (page, reg) => {
    const f = await filas(page);
    igual(f.length, 1);
    igual(f[0].titulo, 'Bienvenida a Ceiba');
    verdadero(f[0].seleccionada, 'la bienvenida debe estar seleccionada');
    const v = await editor(page).inputValue();
    verdadero(v.startsWith('# Bienvenida a Ceiba'), 'el editor debe mostrar la bienvenida');
    const g = await guardado(page);
    igual(g.version, 1);
    igual(g.notas.length, 1);
    igual(g.activa, g.notas[0].id);
    igual(Object.keys(g.notas[0]).sort(), ['creada', 'editada', 'id', 'texto']);
    igual(g.notas[0].texto, v);
    verdadero(g.notas[0].creada === g.notas[0].editada, 'creada y editada deben coincidir al crearla');
    igual(await textoDe(page.locator('#est-guardado')), 'Guardado');
    limpio(reg);
  });
});

await prueba('la bienvenida es contenido real: guía de markdown, explica dónde se guardan las notas y no usa emojis', async () => {
  await con({}, async page => {
    const v = await editor(page).inputValue();
    verdadero(v.length > 500, 'la guía es demasiado corta para ser útil');
    verdadero(/^## /m.test(v) && /\*\*[^*]+\*\*/.test(v) && /^- \[ \]/m.test(v) && /^> /m.test(v) && /^- /m.test(v), 'faltan ejemplos de markdown');
    verdadero(/navegador/i.test(v), 'debe decir que las notas viven en el navegador');
    verdadero(!EMOJI.test(v), 'la bienvenida no debe tener emojis');
  });
});

await prueba('recargar no recrea la bienvenida ni cambia su id', async () => {
  await con({}, async page => {
    const antes = await guardado(page);
    await page.reload();
    const despues = await guardado(page);
    igual(despues.notas.length, 1);
    igual(despues.notas[0].id, antes.notas[0].id);
    igual(despues.notas[0].editada, antes.notas[0].editada);
    igual((await filas(page)).length, 1);
  });
});

await prueba('sin notas guardadas: estado vacío con la rama, sin recrear la bienvenida; el botón escribe la primera nota', async () => {
  await con({ sembrar: { [CLAVE]: datos([], null) } }, async (page, reg) => {
    verdadero(await page.locator('#vacio').isVisible(), 'falta el estado vacío');
    verdadero(await page.locator('#vacio svg.rama').isVisible(), 'falta la rama de ceiba');
    verdadero(await page.locator('#lista-vacia').isVisible(), 'la lista debe decir que no hay notas');
    verdadero(!(await editor(page).isVisible()), 'el editor no debe verse sin notas');
    verdadero(!(await page.locator('#est-guardado').isVisible()), 'la barra de estado no tiene sentido sin nota');
    igual((await guardado(page)).notas.length, 0);
    await page.getByRole('button', { name: 'Escribir la primera nota' }).click();
    igual((await filas(page)).length, 1);
    verdadero(!(await page.locator('#vacio').isVisible()), 'el estado vacío debe ocultarse');
    verdadero(await editor(page).isVisible());
    verdadero(await editor(page).evaluate(e => e === document.activeElement), 'el cursor debe quedar en el editor');
    igual((await guardado(page)).notas.length, 1);
    limpio(reg);
  });
});

// =====================================================================================
console.log('\n[crear, escribir y persistir]');

await prueba('Nueva nota: crea una nota vacía arriba, la activa, deja el cursor en el editor y la guarda al instante', async () => {
  await con({}, async (page, reg) => {
    await nueva(page).click();
    const f = await filas(page);
    igual(f.length, 2);
    igual(f[0].titulo, 'Sin título');
    verdadero(f[0].seleccionada && !f[1].seleccionada, 'la nueva debe ser la activa');
    igual(await editor(page).inputValue(), '');
    verdadero(await editor(page).evaluate(e => e === document.activeElement), 'el cursor debe estar en el editor');
    const g = await guardado(page);
    igual(g.notas.length, 2);
    igual(g.activa, f[0].id);
    limpio(reg);
  });
});

await prueba('escribir actualiza título y extracto en la lista y los contadores de la barra de estado', async () => {
  await con({}, async page => {
    await nueva(page).click();
    await page.keyboard.type('Mi diario');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Hoy escribí sobre la ceiba.');
    const f = (await filas(page))[0];
    igual(f.titulo, 'Mi diario');
    igual(f.extracto, 'Hoy escribí sobre la ceiba.');
    const t = await editor(page).inputValue();
    igual(await textoDe(page.locator('#est-palabras')), '7 palabras');
    igual(await textoDe(page.locator('#est-caracteres')), `${t.length} caracteres`);
  });
});

await prueba('barra de estado: singular y plural de palabras y caracteres', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('a', '', T0)], 'a') } }, async page => {
    igual(await textoDe(page.locator('#est-palabras')), '0 palabras');
    igual(await textoDe(page.locator('#est-caracteres')), '0 caracteres');
    await escribir(page, 'a');
    igual(await textoDe(page.locator('#est-palabras')), '1 palabra');
    igual(await textoDe(page.locator('#est-caracteres')), '1 carácter');
    await page.keyboard.type(' ñu\ncd');
    igual(await textoDe(page.locator('#est-palabras')), '3 palabras');
    igual(await textoDe(page.locator('#est-caracteres')), '7 caracteres');
  });
});

await prueba('el guardado espera 300 ms de pausa: "Guardando" hasta entonces y se reinicia con cada pulsación', async () => {
  await con({ reloj: T0 }, async page => {
    await nueva(page).click();
    const id = (await guardado(page)).activa;
    await page.keyboard.type('ho');
    await page.clock.runFor(200);
    await page.keyboard.type('la');
    await page.clock.runFor(200);                                  // 400 ms desde la primera tecla, 200 desde la última
    igual((await notaGuardada(page, id)).texto, '', 'no debe haber guardado todavía');
    igual(await textoDe(page.locator('#est-guardado')), 'Guardando');
    await page.clock.runFor(99);
    igual((await notaGuardada(page, id)).texto, '', 'a los 299 ms aún no');
    await page.clock.runFor(1);
    igual((await notaGuardada(page, id)).texto, 'hola', 'a los 300 ms debe guardar');
    igual(await textoDe(page.locator('#est-guardado')), 'Guardado');
  });
});

await prueba('crear una nota guarda al instante lo pendiente de la anterior', async () => {
  await con({ reloj: T0 }, async page => {
    const a = (await guardado(page)).activa;
    await escribir(page, ' zzmarcazz');
    igual((await notaGuardada(page, a)).texto.includes('zzmarcazz'), false);
    await nueva(page).click();
    const g = await guardado(page);
    verdadero(g.notas.find(n => n.id === a).texto.endsWith(' zzmarcazz'), 'el texto pendiente debía guardarse al crear');
    verdadero(g.activa !== a, 'la activa guardada debe ser la nueva');
  });
});

await prueba('cambiar de nota guarda al instante lo pendiente y la nueva nota activa', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_AMBIENTE }, async page => {
    await escribir(page, ' X');
    await page.locator('#lista [data-id="arepas"]').click();
    const g = await guardado(page);
    verdadero(g.notas.find(n => n.id === 'arbol').texto.endsWith(' X'), 'el texto pendiente debía guardarse al cambiar de nota');
    igual(g.activa, 'arepas');
    verdadero((await editor(page).inputValue()).startsWith('Receta de arepas'), 'el editor debe mostrar la nota elegida');
  });
});

await prueba('pagehide guarda lo pendiente sin esperar al temporizador', async () => {
  await con({ reloj: T0 }, async page => {
    const id = (await guardado(page)).activa;
    await escribir(page, ' extra');
    verdadero(!(await notaGuardada(page, id)).texto.endsWith('extra'));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    verdadero((await notaGuardada(page, id)).texto.endsWith(' extra'), 'pagehide debía guardar');
    igual(await textoDe(page.locator('#est-guardado')), 'Guardado');
  });
});

await prueba('visibilitychange a oculto guarda lo pendiente', async () => {
  await con({ reloj: T0 }, async page => {
    const id = (await guardado(page)).activa;
    await escribir(page, ' oculto');
    verdadero(!(await notaGuardada(page, id)).texto.endsWith('oculto'));
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    verdadero((await notaGuardada(page, id)).texto.endsWith(' oculto'), 'visibilitychange debía guardar');
  });
});

await prueba('recargar justo después de escribir (con el temporizador detenido) no pierde el texto', async () => {
  await con({ reloj: T0 }, async page => {
    await page.clock.fastForward(5000);                            // la nueva nota queda más reciente que la bienvenida
    await nueva(page).click();
    await page.keyboard.type('Escrito sin pausa');
    await page.reload();                                           // el reloj sigue detenido: solo pagehide puede salvarlo
    const f = await filas(page);
    igual(f.map(x => x.titulo), ['Escrito sin pausa', 'Bienvenida a Ceiba']);
    igual(await editor(page).inputValue(), 'Escrito sin pausa');
    verdadero(f[0].seleccionada, 'la nota nueva sigue siendo la activa');
  });
});

await prueba('recargar conserva notas, texto, nota activa y orden', async () => {
  await con({}, async page => {
    await nueva(page).click();
    await page.keyboard.type('Segunda nota\ncon dos líneas');
    await nueva(page).click();
    await page.keyboard.type('Tercera nota');
    await page.locator('#lista [role="option"]').nth(1).click();   // activa la segunda (queda en medio del orden)
    await esperar(async () => (await guardado(page)).notas.length === 3, 'faltan notas guardadas');
    const antes = await filas(page);
    await page.reload();
    const despues = await filas(page);
    igual(despues.map(f => [f.titulo, f.seleccionada]), antes.map(f => [f.titulo, f.seleccionada]));
    verdadero(despues.some(f => f.seleccionada), 'debe haber una nota activa tras recargar');
    const activa = (await guardado(page)).activa;
    igual(await page.locator('#lista [aria-selected="true"]').getAttribute('data-id'), activa);
  });
});

// =====================================================================================
console.log('\n[orden y marcas de tiempo]');

await prueba('la lista se ordena por última edición descendente y la activa viene seleccionada', async () => {
  const notas = [nota('c', 'Tres', T0 - 3 * HORA), nota('a', 'Uno', T0 - 1 * HORA), nota('b', 'Dos', T0 - 2 * HORA)];
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(notas, 'b') } }, async page => {
    const f = await filas(page);
    igual(f.map(x => x.titulo), ['Uno', 'Dos', 'Tres']);
    igual(f.map(x => x.seleccionada), [false, true, false]);
    igual(await page.locator('#lista').getAttribute('aria-activedescendant'), 'nota-b');
  });
});

await prueba('editar una nota antigua la sube al tope tras la pausa de escritura, sin perder la selección', async () => {
  const notas = [nota('a', 'Uno', T0 - 1 * HORA), nota('b', 'Dos', T0 - 2 * HORA), nota('c', 'Tres', T0 - 3 * HORA)];
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(notas, 'c') } }, async page => {
    await escribir(page, ' y más');
    igual(await titulos(page), ['Uno', 'Dos', 'Tres y más'], 'mientras se escribe la lista no salta');
    await page.clock.runFor(300);
    const f = await filas(page);
    igual(f.map(x => x.titulo), ['Tres y más', 'Uno', 'Dos']);
    verdadero(f[0].seleccionada, 'la nota editada sigue seleccionada');
    verdadero(await editor(page).evaluate(e => e === document.activeElement), 'reordenar no debe quitar el foco del editor');
  });
});

await prueba('cada elemento muestra extracto, <time datetime> y title absoluto, con tiempo relativo corto', async () => {
  const notas = [
    nota('a', 'Reciente\nprimera línea de texto', T0 - 3 * MIN),
    nota('b', 'De hoy', T0 - 20 * HORA),
    nota('c', 'De ayer', T0 - 30 * HORA),
    nota('d', 'Antigua', T0 - 5 * DIA),
  ];
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(notas, 'a') } }, async page => {
    const f = await filas(page);
    igual(f.map(x => x.tiempo), ['hace 3 min', 'hace 20 h', 'ayer', '11 oct']);
    igual(f[0].extracto, 'primera línea de texto');
    const t = await page.locator('#lista time').evaluateAll(l => l.map(x => [x.getAttribute('datetime'), x.getAttribute('title'), x.tagName]));
    igual(t[0][0], new Date(T0 - 3 * MIN).toISOString());
    igual(t[0][2], 'TIME');
    igual(t[3][1], await fecha(page, T0 - 5 * DIA));
    verdadero(/^\d{1,2} \S+ 2026, \d{2}:\d{2}$/.test(t[3][1]), `formato absoluto inesperado: ${t[3][1]}`);
  });
});

await prueba('las etiquetas relativas se refrescan cada 60 s y al volver a la pestaña', async () => {
  const notas = [nota('a', 'Nota', T0 - 30 * 1000)];
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(notas, 'a') } }, async page => {
    igual((await filas(page))[0].tiempo, 'ahora mismo');
    await page.clock.runFor(59 * 1000);
    igual((await filas(page))[0].tiempo, 'ahora mismo', 'antes de 60 s no se refresca');
    await page.clock.runFor(1000);
    igual((await filas(page))[0].tiempo, 'hace 1 min', 'a los 60 s se refresca');
    await page.clock.setFixedTime(T0 + 10 * MIN);                  // el reloj salta sin disparar temporizadores
    igual((await filas(page))[0].tiempo, 'hace 1 min');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    igual((await filas(page))[0].tiempo, 'hace 10 min', 'al volver a la pestaña se refresca');
  });
});

await prueba('fechas futuras o corruptas nunca producen tiempos negativos, NaN ni "Invalid Date"', async () => {
  const notas = [nota('a', 'Futuro cercano', T0 + 3 * MIN), nota('b', 'Futuro lejano', T0 + 400 * DIA), nota('c', 'Cero', 0)];
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(notas, 'a') } }, async (page, reg) => {
    const f = await filas(page);
    igual(f.length, 3);
    for (const x of f) verdadero(!/-|NaN|undefined|Invalid/.test(x.tiempo) && x.tiempo.length > 0, `etiqueta inválida: "${x.tiempo}"`);
    verdadero(!/NaN|undefined|Invalid/.test(await textoDe(page.locator('#est-edicion'))), 'barra de estado inválida');
    limpio(reg);
  });
});

await prueba('la fecha de última edición cambia solo cuando el texto cambia (no al abrir, enfocar, mover el cursor ni cambiar de nota)', async () => {
  const notas = [nota('a', 'Primera nota\ncon texto', T0 - 2 * HORA), nota('b', 'Segunda nota', T0 - 3 * HORA)];
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(notas, 'a') } }, async page => {
    const edicion = () => textoDe(page.locator('#est-edicion'));
    const fa = await fecha(page, T0 - 2 * HORA), fb = await fecha(page, T0 - 3 * HORA);
    igual(await edicion(), `Última edición: ${fa}`);
    verdadero((await page.locator('#est-fecha').getAttribute('datetime')) === new Date(T0 - 2 * HORA).toISOString(), 'time sin datetime correcto');
    await page.clock.runFor(5 * MIN);
    await page.locator('#lista [data-id="b"]').click();                 // abrir otra nota
    igual(await edicion(), `Última edición: ${fb}`);
    await page.locator('#lista [data-id="a"]').click();
    await editor(page).focus();                                         // enfocar
    for (const t of ['End', 'Home', 'ArrowLeft', 'Control+a', 'ArrowRight']) await page.keyboard.press(t);
    await editor(page).fill(await editor(page).inputValue());           // "escribir" exactamente lo mismo
    await editor(page).evaluate(e => e.dispatchEvent(new Event('input', { bubbles: true })));   // evento redundante, mismo texto
    await page.clock.runFor(1000);
    igual(await edicion(), `Última edición: ${fa}`);
    igual((await notaGuardada(page, 'a')).editada, T0 - 2 * HORA);
    igual((await notaGuardada(page, 'b')).editada, T0 - 3 * HORA);
    igual((await filas(page)).map(f => f.titulo), ['Primera nota', 'Segunda nota']);
    await page.keyboard.press('Control+End');
    await page.keyboard.type('!');                                      // ahora sí cambia el texto
    const ahora = T0 + 5 * MIN + 1000;
    igual(await edicion(), `Última edición: ${await fecha(page, ahora)}`);
    await page.clock.runFor(300);
    igual((await notaGuardada(page, 'a')).editada, ahora);
    igual((await notaGuardada(page, 'b')).editada, T0 - 3 * HORA);
    await page.reload();
    igual(await textoDe(page.locator('#est-edicion')), `Última edición: ${await fecha(page, ahora)}`);
  });
});

// =====================================================================================
console.log('\n[búsqueda instantánea]');

await prueba('filtra en cada pulsación por título y cuerpo, igual que el oráculo (todas las palabras, sin mayúsculas ni tildes)', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    const q = busqueda(page);
    for (const consulta of ['harina queso', 'ARBOL', 'cafe', 'CEIBA pueblo', 'queso   harina']) {
      await q.fill('');
      let acumulado = '';
      for (const ch of consulta) {
        acumulado += ch;
        await q.pressSequentially(ch);
        igual(await titulos(page), oraculo(acumulado, AMBIENTE), `consulta parcial "${acumulado}"`);
      }
    }
    igual(await titulos(page), oraculo('queso   harina', AMBIENTE));
  });
});

await prueba('"ARBOL" encuentra "Árbol", "cafe" encuentra "café" y la consulta de solo espacios no filtra', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await busqueda(page).fill('ARBOL');
    igual(await titulos(page), ['Árbol de la ceiba']);
    await busqueda(page).fill('cafe');
    igual(await titulos(page), ['Lista de compras']);
    await busqueda(page).fill('   ');
    igual((await filas(page)).length, 4);
    igual(await textoDe(page.locator('#cuenta')), '4 notas');
  });
});

await prueba('resalta con <mark> en título y extracto, conservando mayúsculas y tildes originales', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await busqueda(page).fill('ceiba pueblo');
    const marcas = await page.locator('#lista [role="option"]').evaluateAll(l => l.map(li => ({
      id: li.dataset.id,
      titulo: [...li.querySelectorAll('.nota__titulo mark')].map(m => m.textContent),
      extracto: [...li.querySelectorAll('.nota__extracto mark')].map(m => m.textContent),
    })));
    igual(marcas, [
      { id: 'arbol', titulo: ['ceiba'], extracto: ['pueblo'] },
      { id: 'ideas', titulo: [], extracto: ['CEIBA', 'pueblo'] },
    ]);
    await busqueda(page).fill('arbol');
    const m2 = await page.locator('#lista mark').evaluateAll(l => l.map(m => [m.textContent, m.parentElement.className]));
    igual(m2, [['Árbol', 'nota__titulo']]);
    const t = await page.locator('#lista .nota__titulo').first().evaluate(e => [e.textContent, [...e.childNodes].map(n => n.nodeType + ':' + n.textContent)]);
    igual(t[0], 'Árbol de la ceiba');
    igual(t[1], ['1:Árbol', '3: de la ceiba']);
  });
});

await prueba('el resaltado funciona con texto descompuesto (NFD) y abarca la marca de acento', async () => {
  const notas = [nota('a', 'Cafe\u0301 del pueblo\nAhí tomamos cafe\u0301 y arepas', T0)];
  await con({ sembrar: { [CLAVE]: datos(notas, 'a') } }, async page => {
    await busqueda(page).fill('cafe');
    igual(await page.locator('#lista mark').evaluateAll(l => l.map(m => m.textContent)), ['Cafe\u0301', 'cafe\u0301']);
    await busqueda(page).fill('CAFÉ');                                  // consulta con tilde también coincide
    igual((await filas(page)).length, 1);
  });
});

await prueba('el texto de las notas y de la consulta nunca se interpreta como HTML', async () => {
  const notas = [nota('x', '<img src=x onerror="window.__xss=1">\n<script>window.__xss=2</script> <b>negrita</b>', T0)];
  await con({ sembrar: { [CLAVE]: datos(notas, 'x') } }, async (page, reg) => {
    await busqueda(page).fill('img');
    igual((await filas(page)).length, 1);
    igual(await page.locator('#lista mark').evaluateAll(l => l.map(m => m.textContent)), ['img']);
    igual(await page.locator('#lista img, #lista script, #lista b').count(), 0);
    await busqueda(page).fill('<b>');
    igual((await filas(page)).length, 1);
    await busqueda(page).fill('<i onclick=alert(1)>');
    verdadero(await page.locator('#sin-resultados').isVisible());
    verdadero((await textoDe(page.locator('#sin-resultados'))).includes('<i onclick=alert(1)>'), 'la consulta se muestra como texto');
    igual(await page.locator('#sin-resultados i, #sin-resultados *[onclick]').count(), 0);
    igual(await page.evaluate(() => window.__xss), undefined);
    igual(reg.dialogos, []);
    limpio(reg);
  });
});

await prueba('contador visible y región aria-live: "n resultados", "1 resultado" y una sola región viva', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    igual(await textoDe(page.locator('#cuenta')), '4 notas');
    igual(await page.locator('[aria-live]').count(), 1, 'debe haber una sola región aria-live');
    const viva = page.locator('[aria-live]');
    igual(await viva.getAttribute('aria-live'), 'polite');
    igual(await textoDe(viva), '', 'sin consulta no se anuncia nada');
    await busqueda(page).fill('queso');
    igual(await textoDe(page.locator('#cuenta')), '3 resultados');
    igual(await textoDe(viva), '3 resultados');
    await busqueda(page).fill('arbol');
    igual(await textoDe(page.locator('#cuenta')), '1 resultado');
    igual(await textoDe(viva), '1 resultado');
    await busqueda(page).fill('');
    igual(await textoDe(page.locator('#cuenta')), '4 notas');
    igual(await textoDe(viva), '');
  });
});

await prueba('sin resultados: mensaje con la consulta, sugerencia y un único "Borrar búsqueda" que restaura la lista y devuelve el foco', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await busqueda(page).fill('zzzz');
    verdadero(await page.locator('#sin-resultados').isVisible(), 'falta el mensaje de sin resultados');
    verdadero(!(await page.locator('#lista').isVisible()), 'la lista debe ocultarse');
    const msg = await textoDe(page.locator('#sin-resultados'));
    verdadero(msg.includes('«zzzz»') && /prueba|revisa|menos/i.test(msg), `mensaje poco útil: ${msg}`);
    igual(await textoDe(page.locator('#cuenta')), 'Sin resultados');
    igual(await textoDe(page.locator('[aria-live]')), 'Sin resultados');
    igual(await page.getByRole('button', { name: 'Borrar búsqueda', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Borrar búsqueda', exact: true }).click();
    igual(await busqueda(page).inputValue(), '');
    igual((await filas(page)).length, 4);
    verdadero(!(await page.locator('#sin-resultados').isVisible()));
    verdadero(await busqueda(page).evaluate(e => e === document.activeElement), 'el foco vuelve al campo de búsqueda');
  });
});

await prueba('el botón de limpiar del campo vacía la búsqueda y solo aparece cuando hay texto', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    const x = page.getByRole('button', { name: 'Limpiar búsqueda', exact: true });
    verdadero(!(await x.isVisible()), 'sin texto no debe verse');
    await busqueda(page).fill('queso');
    verdadero(await x.isVisible());
    await x.click();
    igual(await busqueda(page).inputValue(), '');
    igual((await filas(page)).length, 4);
    verdadero(await busqueda(page).evaluate(e => e === document.activeElement));
  });
});

await prueba('"Nueva nota" con un filtro activo lo limpia', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await busqueda(page).fill('queso');
    igual((await filas(page)).length, 3);
    await nueva(page).click();
    igual(await busqueda(page).inputValue(), '');
    const f = await filas(page);
    igual(f.length, 5);
    igual(f[0].titulo, 'Sin título');
    verdadero(f[0].seleccionada);
  });
});

await prueba('si el filtro excluye la nota activa, el editor la sigue mostrando y ninguna opción aparece seleccionada', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await busqueda(page).fill('harina');
    igual(await titulos(page), ['Receta de arepas', 'Lista de compras']);
    verdadero((await filas(page)).every(f => !f.seleccionada), 'ninguna debe estar seleccionada');
    igual(await page.locator('#lista').getAttribute('aria-activedescendant'), null);
    verdadero((await editor(page).inputValue()).startsWith('Árbol de la ceiba'), 'el editor sigue con la nota activa');
    await page.locator('#lista [data-id="compras"]').click();
    verdadero((await editor(page).inputValue()).startsWith('Lista de compras'));
    igual((await filas(page)).map(f => f.seleccionada), [false, true]);
  });
});

await prueba('una consulta de 1 MB de palabras repetidas no cuelga la lista (se usan 200 caracteres)', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
    const ms = await page.evaluate(() => {
      const q = document.querySelector('#busqueda'); const t0 = performance.now();
      q.value = 'queso '.repeat(170000); q.dispatchEvent(new Event('input', { bubbles: true }));
      return performance.now() - t0;
    });
    verdadero(ms < 1500, `la consulta enorme tardó ${ms.toFixed(0)} ms`);
    igual(await titulos(page), oraculo('queso', AMBIENTE));
    limpio(reg);
  });
});

await prueba('buscar y filtrar no modifica ninguna nota ni sus fechas', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_AMBIENTE }, async page => {
    const antes = await guardado(page);
    await busqueda(page).fill('queso');
    await busqueda(page).fill('');
    await page.clock.runFor(2000);
    igual(await guardado(page), antes);
  });
});

// =====================================================================================
console.log('\n[almacenamiento robusto]');

const RAW_ROTO = '{"version":1,"notas":[{"id":"a","texto":"se cortó';

await prueba('JSON roto: copia exacta en ceiba:notas:v1:corrupto:<ts>, aviso visible y arranque con datos limpios', async () => {
  await con({ reloj: T0, sembrar: { [CLAVE]: RAW_ROTO } }, async (page, reg) => {
    const clave = `${CLAVE}:corrupto:${T0}`;
    igual(await page.evaluate(k => localStorage.getItem(k), clave), RAW_ROTO, 'la copia debe ser idéntica al valor roto');
    const g = await guardado(page);
    igual(g.version, 1);
    igual(g.notas.length, 1);
    igual((await filas(page))[0].titulo, 'Bienvenida a Ceiba');
    const aviso = await textoDe(page.locator('#avisos .aviso').first());
    verdadero(/dañad/i.test(aviso) && aviso.includes(clave), `el aviso debe explicar el problema y dónde está la copia: ${aviso}`);
    verdadero((await textoDe(page.locator('[aria-live]'))).includes('dañad'), 'el aviso también debe anunciarse en la región viva');
    await page.getByRole('button', { name: 'Cerrar aviso' }).click();
    igual(await page.locator('#avisos .aviso').count(), 0, 'Cerrar aviso debe quitarlo');
    await page.reload();
    const claves = await page.evaluate(() => Object.keys(localStorage).sort());
    igual(claves, [CLAVE, clave].sort(), 'recargar no debe crear otra copia');
    igual(await page.locator('#avisos .aviso').count(), 0, 'el aviso no vuelve si los datos ya están sanos');
    limpio(reg);
  });
});

for (const [nombre, raw] of [
  ['versión desconocida', '{"version":2,"notas":[]}'],
  ['notas que no es un arreglo', '{"version":1,"notas":"x","activa":null}'],
  ['un arreglo en vez de objeto', '[]'],
  ['la cadena "null"', 'null'],
  ['una cadena vacía', ''],
]) {
  await prueba(`esquema roto (${nombre}): también se copia, se avisa y se arranca limpio`, async () => {
    await con({ reloj: T0, sembrar: { [CLAVE]: raw } }, async (page, reg) => {
      igual(await page.evaluate(k => localStorage.getItem(k), `${CLAVE}:corrupto:${T0}`), raw);
      igual((await filas(page)).map(f => f.titulo), ['Bienvenida a Ceiba']);
      verdadero(await page.locator('#avisos .aviso').count() === 1, 'falta el aviso');
      limpio(reg);
    });
  });
}

await prueba('mezcla de notas válidas y dañadas: conserva las válidas, copia el original y dice cuántas se omitieron', async () => {
  const raw = JSON.stringify({ version: 1, activa: 'ok1', notas: [
    nota('ok1', 'Buena uno', T0 - HORA), { id: 5, texto: 'id inválido', creada: 1, editada: 1 },
    nota('ok2', 'Buena dos', T0 - 2 * HORA), { id: 'x', texto: 7, creada: 1, editada: 1 }, 'basura'] });
  await con({ reloj: T0, sembrar: { [CLAVE]: raw } }, async (page, reg) => {
    igual(await titulos(page), ['Buena uno', 'Buena dos']);
    igual(await page.evaluate(k => localStorage.getItem(k), `${CLAVE}:corrupto:${T0}`), raw);
    const aviso = await textoDe(page.locator('#avisos .aviso').first());
    verdadero(/3 notas/.test(aviso), `el aviso debe decir que se omitieron 3 notas: ${aviso}`);
    igual((await guardado(page)).notas.length, 2);
    limpio(reg);
  });
});

await prueba('ids y textos hostiles guardados no rompen la lista ni inyectan nada', async () => {
  const notas = [
    nota('__proto__', 'Proto', T0 - 1 * HORA), nota('constructor', 'Constructor', T0 - 2 * HORA),
    nota('<img src=x onerror=alert(1)>', '<b>negrita</b>\n<img src=x onerror=alert(2)>', T0 - 3 * HORA),
    nota('a'.repeat(200), 'Id larguísimo', T0 - 4 * HORA),
  ];
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(notas, 'constructor') } }, async (page, reg) => {
    const f = await filas(page);
    igual(f.length, 4);
    verdadero(f.every(x => /^[A-Za-z0-9_-]{1,64}$/.test(x.id)), 'los ids del DOM deben estar saneados');
    igual(await page.locator('#lista img, #lista b, #lista script').count(), 0);
    igual(new Set(await page.locator('[id]').evaluateAll(l => l.map(e => e.id))).size, await page.locator('[id]').count(), 'ids duplicados en el DOM');
    igual(reg.dialogos, []);
    limpio(reg);
  });
});

await prueba('localStorage bloqueado: la app funciona en memoria, avisa y la barra dice "Sin guardar"', async () => {
  const bloquear = () => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Acceso denegado', 'SecurityError'); } });
  await con({ init: { fn: bloquear } }, async (page, reg) => {
    igual((await filas(page)).map(f => f.titulo), ['Bienvenida a Ceiba']);
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    const aviso = await textoDe(page.locator('#avisos .aviso').first());
    verdadero(aviso.includes('Los cambios no se están guardando'), `aviso inesperado: ${aviso}`);
    await nueva(page).click();
    await page.keyboard.type('Sigue funcionando en memoria');
    igual((await filas(page))[0].titulo, 'Sigue funcionando en memoria');
    await busqueda(page).fill('memoria');
    igual((await filas(page)).length, 1);
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    igual(await page.locator('#avisos .aviso').count(), 1, 'un solo aviso, no uno por cada intento');
    igual(reg.errores, []);
  });
});

await prueba('cuota llena: avisa y dice "Sin guardar"; al liberarse el espacio vuelve a guardar y quita el aviso', async () => {
  const cuota = () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (window.__llena) throw new DOMException('cuota', 'QuotaExceededError'); return original.call(this, k, v); };
  };
  await con({ reloj: T0, init: { fn: cuota } }, async (page, reg) => {
    await page.evaluate(() => { window.__llena = true; });
    await escribir(page, ' primero');
    await page.clock.runFor(300);
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    verdadero((await textoDe(page.locator('#avisos .aviso').first())).includes('Los cambios no se están guardando'));
    await page.keyboard.type(' segundo');
    await page.clock.runFor(300);
    igual(await page.locator('#avisos .aviso').count(), 1, 'sin avisos repetidos');
    await page.evaluate(() => { window.__llena = false; });
    await page.keyboard.type(' tercero');
    await page.clock.runFor(300);
    igual(await textoDe(page.locator('#est-guardado')), 'Guardado');
    igual(await page.locator('#avisos .aviso').count(), 0, 'el aviso debe quitarse al recuperarse');
    const g = await guardado(page);
    verdadero(g.notas[0].texto.endsWith(' primero segundo tercero'), 'debe haberse guardado todo el texto acumulado');
    limpio(reg);
  });
});

await prueba('si no se puede conservar el valor roto, no se escribe sobre la clave principal', async () => {
  const sinCopia = () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).includes(':corrupto:')) throw new DOMException('cuota', 'QuotaExceededError'); return original.call(this, k, v); };
  };
  await con({ reloj: T0, sembrar: { [CLAVE]: RAW_ROTO }, init: { fn: sinCopia } }, async (page, reg) => {
    await escribir(page, ' trabajo nuevo');
    await page.clock.runFor(300);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    igual(await page.evaluate(k => localStorage.getItem(k), CLAVE), RAW_ROTO, 'el valor roto no debe pisarse sin copia');
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    verdadero((await textoDe(page.locator('#avisos .aviso').first())).length > 20, 'debe explicar la situación');
    limpio(reg);
  });
});

// =====================================================================================
console.log('\n[diseño, accesibilidad y robustez]');

await prueba('sin JavaScript: se explica que hace falta y no se muestra una interfaz que no funcionaría', async () => {
  const ctx = await navegador.newContext({ javaScriptEnabled: false, viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  try {
    await page.goto(PAGINA);
    verdadero(await page.getByText('Ceiba necesita JavaScript').isVisible(), 'falta el mensaje');
    verdadero(!(await page.locator('.app').isVisible()), 'la interfaz no debe verse sin JavaScript');
    verdadero(!(await page.locator('textarea').isVisible()), 'el editor no debe verse sin JavaScript');
  } finally { await ctx.close(); }
});

await prueba('escritorio 1440: barra lateral con ancho clamp(280px, 26vw, 340px) y editor a la derecha', async () => {
  for (const [ancho, esperado] of [[1440, 340], [1024, 280], [900, 280], [1300, 338]]) {
    await con({ ancho }, async page => {
      const r = await page.evaluate(() => ({ l: document.querySelector('aside').getBoundingClientRect().toJSON(), e: document.querySelector('#editor').getBoundingClientRect().toJSON() }));
      verdadero(Math.abs(r.l.width - esperado) <= 1, `a ${ancho} px la lateral mide ${r.l.width}, esperado ${esperado}`);
      verdadero(r.e.left >= r.l.right - 1 && r.e.width > 400, 'el editor debe estar a la derecha de la lateral');
    });
  }
});

await prueba('sin scroll horizontal en 360, 768 y 1440, ni siquiera con un título larguísimo sin espacios', async () => {
  const largo = 'x'.repeat(5000);
  const notas = [nota('a', largo + '\n' + largo, T0), nota('b', 'Normal\nlínea', T0 - HORA)];
  for (const ancho of [360, 768, 1440]) {
    await con({ ancho, sembrar: { [CLAVE]: datos(notas, 'b') } }, async page => {
      const m = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cuerpo: document.body.scrollWidth - document.body.clientWidth,
        lista: (() => { const n = document.querySelector('.lista-nav'); return n ? n.scrollWidth - n.clientWidth : 0; })(),
      }));
      igual(m, { doc: 0, cuerpo: 0, lista: 0 }, `desbordamiento horizontal a ${ancho} px`);
    });
  }
});

await prueba('los avisos caben en la pantalla de 360 px y no tapan la barra de estado (los de estado van en una banda bajo el diseño)', async () => {
  await con({ ancho: 360, alto: 740, reloj: T0, sembrar: { [CLAVE]: RAW_ROTO } }, async page => {
    const r = await page.evaluate(() => { const a = document.querySelector('.aviso').getBoundingClientRect(); return { izq: a.left, der: a.right, ancho: innerWidth }; });
    verdadero(r.izq >= 0 && r.der <= r.ancho, `el aviso se sale de la pantalla: ${JSON.stringify(r)}`);
    await page.locator('#lista [role="option"]').first().click();
    const sup = await page.evaluate(() => { const a = document.querySelector('.aviso').getBoundingClientRect(), e = document.querySelector('#estado').getBoundingClientRect(); return { avisoArr: a.top, avisoAba: a.bottom, estadoArr: e.top, estadoAba: e.bottom }; });
    verdadero(sup.avisoAba <= sup.estadoArr || sup.avisoArr >= sup.estadoAba, `el aviso tapa la barra de estado: ${JSON.stringify(sup)}`);
  });
});

await prueba('móvil 360: la lista ocupa toda la pantalla; abrir una nota muestra el editor y "Volver a la lista" regresa', async () => {
  await con({ ancho: 360, alto: 740, sembrar: SIEMBRA_AMBIENTE }, async page => {
    const lateral = page.locator('aside'), principal = page.locator('main');
    verdadero(await lateral.isVisible() && !(await principal.isVisible()), 'al abrir solo se ve la lista');
    const w = await lateral.evaluate(e => e.getBoundingClientRect().width);
    verdadero(Math.abs(w - 360) <= 1, `la lista debe ocupar todo el ancho (${w})`);
    await page.locator('#lista [data-id="arepas"]').click();
    verdadero(await principal.isVisible() && !(await lateral.isVisible()), 'al abrir una nota solo se ve el editor');
    verdadero((await editor(page).inputValue()).startsWith('Receta de arepas'));
    const volver = page.getByRole('button', { name: 'Volver a la lista', exact: true });
    verdadero(await volver.isVisible());
    await volver.click();
    verdadero(await lateral.isVisible() && !(await principal.isVisible()));
    verdadero(await page.locator('#lista').evaluate(e => e === document.activeElement), 'el foco vuelve a la lista');
    verdadero((await filas(page)).find(f => f.id === 'arepas').seleccionada, 'la nota abierta sigue seleccionada');
    await nueva(page).click();
    verdadero(await principal.isVisible() && await editor(page).evaluate(e => e === document.activeElement), 'nueva nota abre el editor con foco');
  });
});

await prueba('en escritorio el botón "Volver a la lista" no se muestra', async () => {
  await con({}, async page => {
    verdadero(!(await page.getByRole('button', { name: 'Volver a la lista', exact: true }).isVisible()));
  });
});

await prueba('roles y nombres accesibles: puntos de referencia, listbox/option, searchbox, textbox y enlace de salto', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    igual(await page.locator('html').getAttribute('lang'), 'es');
    igual(await page.locator('main').count(), 1);
    igual(await page.locator('aside').count(), 1);
    igual(await page.locator('nav').count(), 1);
    igual(await page.locator('[role="search"]').count(), 1);
    verdadero(await page.getByRole('listbox', { name: 'Notas' }).isVisible());
    igual(await page.getByRole('option').count(), 4);
    verdadero(await busqueda(page).isVisible());
    verdadero(await editor(page).isVisible());
    igual(await editor(page).getAttribute('lang'), 'es');
    igual(await page.locator('#lista').getAttribute('tabindex'), '0', 'el listbox es una sola parada de tabulación');
    igual(await page.locator('#lista [aria-selected="true"]').count(), 1);
    igual(await page.locator('#lista').getAttribute('aria-activedescendant'), 'nota-arbol');
    const salto = page.getByRole('link', { name: 'Saltar al contenido' });
    igual(await salto.getAttribute('href'), '#contenido');
    igual(await page.locator('main').getAttribute('id'), 'contenido');
    // Todo control tiene nombre accesible
    const sinNombre = await page.locator('button, input, textarea, a[href], [role="listbox"]').evaluateAll(l => l
      .filter(e => e.getClientRects().length)
      .filter(e => !(e.getAttribute('aria-label') || '').trim() && !(e.textContent || '').trim() && !(e.labels && e.labels.length) && !(e.getAttribute('aria-labelledby')))
      .map(e => e.outerHTML.slice(0, 80)));
    igual(sinNombre, [], 'controles sin nombre accesible');
    igual(await page.locator('svg:not([aria-hidden="true"])').evaluateAll(l => l.filter(s => !s.closest('[aria-hidden="true"]')).length), 0, 'los SVG decorativos deben ser aria-hidden');
  });
});

await prueba('el enlace "Saltar al contenido" lleva el foco al contenido principal', async () => {
  await con({}, async page => {
    await page.keyboard.press('Tab');
    verdadero(await page.getByRole('link', { name: 'Saltar al contenido' }).evaluate(e => e === document.activeElement), 'el primer Tab debe caer en el enlace de salto');
    await page.keyboard.press('Enter');
    verdadero(await page.locator('#contenido').evaluate(e => e === document.activeElement), 'el foco debe pasar a main');
  });
});

await prueba('orden de tabulación base (sigue el orden visual): salto, Nueva nota, búsqueda, lista (una sola parada), Tema, Copia de seguridad, Atajos, Vista previa, Eliminar, Exportar nota, editor y Modo enfoque', async () => {
  // Task 4: el pie de la barra lateral (Atajos), la barra superior (Vista previa, Eliminar) y el botón de
  // Modo enfoque de la barra de estado se suman a las cinco paradas de la Task 3, sin romper su orden relativo.
  // Task 5: el pie suma Tema y Copia de seguridad (antes de Atajos) y la barra superior suma Exportar nota (después de Eliminar).
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    const paradas = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      paradas.push(await page.evaluate(() => { const a = document.activeElement; return a.id || a.textContent.trim().slice(0, 30); }));
    }
    igual(paradas, ['Saltar al contenido', 'nueva', 'busqueda', 'lista', 'tema', 'respaldo', 'atajos', 'modo', 'eliminar', 'exportar-nota', 'editor', 'enfoque']);
  });
});

await prueba('tema: respeta las preferencias guardadas por la landing y el esquema del sistema', async () => {
  const fondo = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await con({ esquema: 'light', sembrar: { [PREFS]: JSON.stringify({ tema: 'oscuro', plan: 'brote' }) } }, async page => {
    igual(await page.locator('html').getAttribute('data-theme'), 'dark');
    igual(await fondo(page), 'rgb(27, 25, 21)');
  });
  await con({ esquema: 'dark', sembrar: { [PREFS]: JSON.stringify({ tema: 'claro' }) } }, async page => {
    igual(await page.locator('html').getAttribute('data-theme'), 'light');
    igual(await fondo(page), 'rgb(251, 246, 234)');
  });
  await con({ esquema: 'dark' }, async page => igual(await fondo(page), 'rgb(27, 25, 21)'));
  await con({ esquema: 'light' }, async page => igual(await fondo(page), 'rgb(251, 246, 234)'));
  await con({ esquema: 'light', sembrar: { [PREFS]: '{roto' } }, async (page, reg) => { igual(await fondo(page), 'rgb(251, 246, 234)'); limpio(reg); });
});

await prueba('contraste real (WCAG AA, 4.5:1) de los textos principales en tema claro y oscuro', async () => {
  const medir = () => {
    const analizar = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(s => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const sobre = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const fondoDe = el => {
      const capas = [];
      for (let e = el; e; e = e.parentElement) { const c = analizar(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { capas.push(c); if (c.a === 1) break; } }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = capas.length - 1; i >= 0; i--) base = sobre(capas[i], base);
      return base;
    };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const pares = [];
    const medirSel = (sel, pseudo) => {
      const el = document.querySelector(sel); if (!el) { pares.push([sel, 0]); return; }
      const bg = fondoDe(el); const col = analizar(getComputedStyle(el, pseudo || null).color); pares.push([sel + (pseudo || ''), ratio(sobre(col, bg), bg)]);
    };
    ['#lista .nota__titulo', '#lista .nota__extracto', '#lista .nota__tiempo', '#cuenta', '#busqueda', '#busqueda::placeholder', '#editor', '#est-guardado', '#est-palabras', '#est-edicion', '#nueva'].forEach(s => {
      if (s.endsWith('::placeholder')) medirSel(s.replace('::placeholder', ''), '::placeholder'); else medirSel(s);
    });
    const marca = document.querySelector('#lista mark'); if (marca) medirSel('#lista mark');
    return pares;
  };
  for (const esquema of ['light', 'dark']) {
    await con({ esquema, sembrar: SIEMBRA_AMBIENTE }, async page => {
      await busqueda(page).fill('ceiba');
      const pares = await page.evaluate(medir);
      for (const [sel, r] of pares) verdadero(r >= 4.5, `contraste insuficiente en ${esquema} para ${sel}: ${r.toFixed(2)}`);
      verdadero(pares.length >= 12, 'faltaron elementos por medir');
    });
  }
});

await prueba('contraste real (WCAG AA) también en sin resultados, estado vacío, avisos y barra de estado con fallo', async () => {
  const medir = sels => {
    const analizar = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(s => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const sobre = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const fondoDe = el => { const capas = []; for (let e = el; e; e = e.parentElement) { const c = analizar(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { capas.push(c); if (c.a === 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = capas.length - 1; i >= 0; i--) base = sobre(capas[i], base); return base; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    return sels.map(sel => { const el = document.querySelector(sel); if (!el || !el.getClientRects().length) return [sel, 0]; const bg = fondoDe(el); return [sel, ratio(sobre(analizar(getComputedStyle(el).color), bg), bg)]; });
  };
  const cuota = () => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (window.__llena) throw new DOMException('c', 'QuotaExceededError'); return o.call(this, k, v); }; };
  for (const esquema of ['light', 'dark']) {
    await con({ esquema, sembrar: SIEMBRA_AMBIENTE }, async page => {
      await busqueda(page).fill('zzzz');
      for (const [s, r] of await page.evaluate(medir, ['#sin-resultados-titulo', '.sin-resultados__ayuda', '#borrar-busqueda', '#cuenta', '#busqueda'])) verdadero(r >= 4.5, `${esquema} sin resultados ${s}: ${r.toFixed(2)}`);
    });
    await con({ esquema, sembrar: { [CLAVE]: datos([], null) } }, async page => {
      for (const [s, r] of await page.evaluate(medir, ['.vacio__titulo', '.vacio__texto', '#primera', '.lista-vacia', '#cuenta'])) verdadero(r >= 4.5, `${esquema} vacío ${s}: ${r.toFixed(2)}`);
    });
    await con({ esquema, sembrar: { [CLAVE]: RAW_ROTO } }, async page => {
      for (const [s, r] of await page.evaluate(medir, ['.aviso__texto', '.aviso .boton-icono'])) verdadero(r >= 4.5, `${esquema} aviso ${s}: ${r.toFixed(2)}`);
    });
    await con({ esquema, reloj: T0, init: { fn: cuota } }, async page => {
      await page.evaluate(() => { window.__llena = true; });
      await escribir(page, 'x'); await page.clock.runFor(300);
      for (const [s, r] of await page.evaluate(medir, ['#est-guardado', '#est-palabras'])) verdadero(r >= 4.5, `${esquema} sin guardar ${s}: ${r.toFixed(2)}`);
    });
  }
});

await prueba('sin recursos externos: ninguna petición salvo la propia página; sin emojis en el texto ni en el DOM', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
    await busqueda(page).fill('ceiba');
    await nueva(page).click();
    const externas = reg.peticiones.filter(u => !u.startsWith(srv.url + '/app.html'));
    igual(externas, [], 'peticiones inesperadas');
    const t = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML);
    verdadero(!EMOJI.test(t), 'hay emojis o selectores de variación en la página');
    limpio(reg);
  });
});

await prueba('nota de 200 KB y título de 5.000 caracteres: la interfaz sigue usable', async () => {
  const linea = 'Línea de texto de prueba con acentos: ceiba, árbol, niño. ';
  const cuerpo = (linea.repeat(30) + '\n').repeat(Math.ceil(200000 / (linea.length * 30 + 1)));
  const notas = [nota('grande', 'T'.repeat(5000) + '\n' + cuerpo, T0), nota('chica', 'Chica\nuna línea', T0 - HORA)];
  await con({ sembrar: { [CLAVE]: datos(notas, 'grande') } }, async (page, reg) => {
    const v = await editor(page).inputValue();
    verdadero(v.length > 200000, 'la nota grande debe cargarse completa');
    const ms = await page.evaluate(() => {
      const e = document.querySelector('#editor'); e.focus(); e.setSelectionRange(e.value.length, e.value.length);
      const t0 = performance.now();
      document.execCommand('insertText', false, 'z');
      return performance.now() - t0;
    });
    verdadero(ms < 400, `escribir en la nota de 200 KB tardó ${ms.toFixed(0)} ms`);
    igual(await textoDe(page.locator('#est-caracteres')), `${(await editor(page).inputValue()).length.toLocaleString('es')} caracteres`);
    const el = await page.locator('#lista .nota__titulo').first().evaluate(e => {
      const cs = getComputedStyle(e);
      return { ancho: e.getBoundingClientRect().width, lista: document.querySelector('.lista-nav').clientWidth, recortado: e.scrollWidth > e.clientWidth, overflow: cs.overflowX, puntos: cs.textOverflow, nowrap: cs.whiteSpace };
    });
    verdadero(el.ancho <= el.lista, `el título desborda la lista (${el.ancho} > ${el.lista})`);
    igual([el.recortado, el.overflow, el.puntos, el.nowrap], [true, 'hidden', 'ellipsis', 'nowrap'], 'el título largo debe recortarse con puntos suspensivos');
    const t0 = Date.now();
    await busqueda(page).fill('niño');
    verdadero(Date.now() - t0 < 2000, 'buscar en la nota grande tardó demasiado');
    igual((await filas(page)).length, 1);
    limpio(reg);
  });
});

await prueba('2.000 notas: la búsqueda responde en menos de 1 s por pulsación', async () => {
  const notas = [];
  for (let i = 0; i < 2000; i++) notas.push(nota('n' + i, `Nota número ${i} sobre ceiba\nTexto de relleno ${'palabra '.repeat(60)}fin ${i}`, T0 - i * MIN));
  await con({ sembrar: { [CLAVE]: datos(notas, 'n0') } }, async (page, reg) => {
    igual((await page.locator('#lista [role="option"]').count()), 2000);
    const medidas = await page.evaluate(() => {
      const q = document.querySelector('#busqueda'); const r = [];
      for (const v of ['n', 'nú', 'núm', 'número 19', 'número 199']) { const t0 = performance.now(); q.value = v; q.dispatchEvent(new Event('input', { bubbles: true })); r.push([v, document.querySelectorAll('#lista [role="option"]').length, performance.now() - t0]); }
      return r;
    });
    console.log('        medidas (consulta, resultados, ms): ' + medidas.map(m => `${m[0]}=${m[1]}/${m[2].toFixed(0)}`).join('  '));
    for (const [v, , ms] of medidas) verdadero(ms < 1000, `"${v}" tardó ${ms.toFixed(0)} ms`);
    igual(medidas[4][1], 12, 'número 199: 199, 1199 y 1990 a 1999');
    limpio(reg);
  });
});

// =====================================================================================
// TASK 4: vista previa, nueva, eliminar con deshacer, teclado, búsqueda, ayuda, enfoque, listas
// =====================================================================================
const modo = page => page.getByRole('button', { name: 'Vista previa', exact: true });
const vista = page => page.locator('#vista');
const eliminarBtn = page => page.getByRole('button', { name: 'Eliminar', exact: true });
const deshacerBtn = page => page.getByRole('button', { name: 'Deshacer', exact: true });
const atajosBtn = page => page.getByRole('button', { name: 'Atajos', exact: true });
const enfoqueBtn = page => page.getByRole('button', { name: 'Modo enfoque', exact: true });
const ayuda = page => page.getByRole('dialog', { name: 'Atajos de teclado' });
const avisosDeshacer = page => page.locator('#avisos .aviso', { has: page.getByRole('button', { name: 'Deshacer', exact: true }) });
const enFoco = (page, sel) => page.evaluate(s => document.activeElement === document.querySelector(s), sel);
const idFoco = page => page.evaluate(() => (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) || null);
const activaGuardada = async page => (await guardado(page)).activa;
const idsGuardados = async page => (await guardado(page)).notas.map(n => n.id);
const aLista = async page => { for (let i = 0; i < 4; i++) await page.keyboard.press('Tab'); verdadero(await enFoco(page, '#lista'), 'cuatro Tab deben llegar a la lista'); };
const tecla = (page, t) => page.keyboard.press(t);
const vivo = page => textoDe(page.locator('#vivo'));
const valor = page => page.locator('#editor').inputValue();
const seleccion = page => page.evaluate(() => { const e = document.querySelector('#editor'); return { ini: e.selectionStart, fin: e.selectionEnd, top: e.scrollTop }; });
const dentroDelDialogo = page => page.evaluate(() => { const d = document.querySelector('#ayuda'); return !!d && d.open && d.contains(document.activeElement); });

/** Contraste WCAG de selectores concretos, con el fondo opaco más cercano y la opacidad acumulada. Devuelve [selector, razón]. */
const medirContraste = sels => {
  const analizar = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(s => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const sobre = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const fondoDe = el => { const capas = []; for (let e = el; e; e = e.parentElement) { const c = analizar(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { capas.push(c); if (c.a === 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = capas.length - 1; i >= 0; i--) base = sobre(capas[i], base); return base; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  return sels.map(sel => {
    const el = document.querySelector(sel);
    if (!el || !el.getClientRects().length) return [sel, 0];
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const bg = fondoDe(el); const col = analizar(getComputedStyle(el).color); col.a *= op;
    return [sel, ratio(sobre(col, bg), bg)];
  });
};

const MD_VARIADO = [
  '# Título grande', '',
  'Párrafo con **negrita**, *cursiva* y `código` en línea.', '',
  '- uno', '- dos', '', '- [x] hecha', '- [ ] pendiente', '',
  '| a | b |', '| - | - |', '| 1 | 2 |', '',
  '> una cita', '',
  '```js', 'let x = 1;', '```', '',
  '[web](https://example.com/a) [hostil](JaVaScRiPt:alert(1)) <img src=x onerror="window.__xss=1">',
].join('\n');
const LARGO = Array.from({ length: 120 }, (_, i) => `Línea ${i} con algo de texto para ocupar espacio y forzar el desplazamiento`).join('\n');

// =====================================================================================
console.log('\n[vista previa]');

await prueba('Alt+P alterna Escribir y Vista previa: botón con aria-pressed y texto visible, article con nombre, foco que sigue al contenido y render seguro', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('m', MD_VARIADO, T0)], 'm') } }, async (page, reg) => {
    verdadero(await modo(page).isVisible(), 'falta el botón de vista previa');
    igual(await modo(page).getAttribute('aria-pressed'), 'false');
    verdadero((await textoDe(modo(page))).includes('Vista previa'), 'el botón debe tener texto visible');
    verdadero(await editor(page).isVisible() && !(await vista(page).isVisible()), 'al abrir se escribe');
    await editor(page).focus();
    await tecla(page, 'Alt+KeyP');
    igual(await modo(page).getAttribute('aria-pressed'), 'true');
    verdadero(!(await editor(page).isVisible()) && await vista(page).isVisible(), 'en vista previa se ve el render y no el área de texto');
    verdadero(await page.getByRole('article', { name: 'Vista previa de la nota' }).isVisible(), 'falta el article con nombre accesible');
    igual(await vista(page).getAttribute('tabindex'), '0');
    verdadero(await enFoco(page, '#vista'), 'el foco debe pasar a la vista previa para no perderse');
    const v = vista(page);
    igual(await textoDe(v.locator('h1')), 'Título grande');
    igual(await textoDe(v.locator('strong')), 'negrita');
    igual(await v.locator('li').count(), 4);
    igual(await v.locator('input[type="checkbox"]').count(), 2);
    igual(await v.locator('table th').count(), 2);
    igual(await v.locator('blockquote').count(), 1);
    igual(await v.locator('pre code').count(), 1);
    const enlace = v.locator('a[href^="https://example.com"]');
    igual(await enlace.getAttribute('target'), '_blank');
    igual(await enlace.getAttribute('rel'), 'noopener noreferrer');
    igual(await v.locator('a[href*="javascript" i], img, script, [onerror]').count(), 0, 'nada ejecutable en el render');
    verdadero((await textoDe(v)).includes('<img src=x'), 'el HTML crudo debe verse como texto');
    igual(await page.evaluate(() => window.__xss), undefined);
    igual(reg.dialogos, []);
    await tecla(page, 'Alt+KeyP');
    igual(await modo(page).getAttribute('aria-pressed'), 'false');
    verdadero(await editor(page).isVisible() && !(await vista(page).isVisible()));
    verdadero(await enFoco(page, '#editor'), 'al volver a escribir el foco vuelve al editor');
    limpio(reg);
  });
});

await prueba('el botón "Vista previa" alterna con el ratón y deja el foco en el propio botón', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('m', MD_VARIADO, T0)], 'm') } }, async page => {
    await modo(page).click();
    igual(await modo(page).getAttribute('aria-pressed'), 'true');
    verdadero(await vista(page).isVisible() && !(await editor(page).isVisible()));
    igual(await idFoco(page), 'modo');
    await modo(page).click();
    igual(await modo(page).getAttribute('aria-pressed'), 'false');
    verdadero(await editor(page).isVisible() && !(await vista(page).isVisible()));
    igual(await idFoco(page), 'modo');
  });
});

await prueba('volver a Escribir conserva la posición del cursor, la selección y el desplazamiento, y se sigue escribiendo ahí', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('l', LARGO, T0)], 'l') } }, async page => {
    await editor(page).focus();
    const meta = await page.evaluate(() => { const e = document.querySelector('#editor'); const i = e.value.indexOf('Línea 70'); e.setSelectionRange(i + 3, i + 9, 'backward'); e.scrollTop = 1200; return { ini: i + 3, fin: i + 9, top: e.scrollTop }; });
    verdadero(meta.top > 500, `la nota debe poder desplazarse (scrollTop ${meta.top})`);
    await tecla(page, 'Alt+KeyP');
    verdadero(await vista(page).isVisible());
    await tecla(page, 'Alt+KeyP');
    const s = await seleccion(page);
    igual([s.ini, s.fin], [meta.ini, meta.fin], 'selección');
    verdadero(Math.abs(s.top - meta.top) <= 1, `desplazamiento ${s.top} en vez de ${meta.top}`);
    igual(await page.evaluate(() => document.querySelector('#editor').selectionDirection), 'backward');
    verdadero(await enFoco(page, '#editor'));
    await page.keyboard.type('X');
    igual(await valor(page), LARGO.slice(0, meta.ini) + 'X' + LARGO.slice(meta.fin), 'se escribe donde estaba el cursor');
    // y también cuando se alterna con el botón
    await page.evaluate(() => { const e = document.querySelector('#editor'); e.setSelectionRange(50, 50); e.scrollTop = 300; });
    await modo(page).click(); await modo(page).click();
    const s2 = await seleccion(page);
    igual([s2.ini, s2.fin], [50, 50]);
    verdadero(Math.abs(s2.top - 300) <= 1, `desplazamiento con botón ${s2.top}`);
    // Chromium ya conserva la selección del área oculta; otros motores no. Si algo la altera mientras se ve
    // la vista previa, la aplicación devuelve la que guardó al entrar (por el camino del teclado, con foco).
    await editor(page).focus();
    await page.evaluate(() => document.querySelector('#editor').setSelectionRange(80, 90));
    await tecla(page, 'Alt+KeyP');
    await page.evaluate(() => document.querySelector('#editor').setSelectionRange(0, 0));
    await tecla(page, 'Alt+KeyP');
    igual([(await seleccion(page)).ini, (await seleccion(page)).fin], [80, 90], 'la selección guardada al entrar vuelve al salir');
  });
});

await prueba('al previsualizar una nota larga la vista se coloca en una zona equivalente a la del editor', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('l', LARGO, T0)], 'l') } }, async page => {
    await page.evaluate(() => { const e = document.querySelector('#editor'); e.scrollTop = e.scrollHeight; });
    await tecla(page, 'Alt+KeyP');
    const r = await page.evaluate(() => { const v = document.querySelector('#vista'); return { top: v.scrollTop, max: v.scrollHeight - v.clientHeight }; });
    verdadero(r.max > 200, 'la vista debe poder desplazarse');
    verdadero(r.top > r.max * 0.8, `la vista debería estar cerca del final (${r.top} de ${r.max})`);
  });
});

await prueba('alternar la vista previa no cambia la nota, sus fechas, la barra de estado ni dispara guardados', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_AMBIENTE }, async page => {
    const antes = await guardado(page);
    const estado = await textoDe(page.locator('#estado'));
    for (let i = 0; i < 3; i++) { await tecla(page, 'Alt+KeyP'); await tecla(page, 'Alt+KeyP'); }
    await modo(page).click(); await modo(page).click();
    await page.clock.runFor(2000);
    igual(await guardado(page), antes);
    igual(await textoDe(page.locator('#estado')), estado);
    igual((await filas(page)).map(f => f.tiempo), ['hace 1 h', 'hace 2 h', 'hace 3 h', 'hace 4 h']);
  });
});

await prueba('la vista previa sigue a la nota activa al cambiar de nota con el teclado y muestra un texto de ayuda si la nota está vacía', async () => {
  const notas = [nota('a', '# Primera\n\ncontenido **uno**', T0 - HORA), nota('b', '## Segunda\n\ncontenido dos', T0 - 2 * HORA), nota('v', '', T0 - 3 * HORA)];
  await con({ sembrar: { [CLAVE]: datos(notas, 'a') } }, async page => {
    await tecla(page, 'Alt+KeyP');
    igual(await textoDe(vista(page).locator('h1')), 'Primera');
    await tecla(page, 'Escape');
    verdadero(await enFoco(page, '#lista'), 'Esc desde la vista previa lleva a la lista');
    await tecla(page, 'ArrowDown');
    verdadero(await vista(page).isVisible(), 'el modo se mantiene al cambiar de nota');
    igual(await textoDe(vista(page).locator('h2')), 'Segunda');
    await tecla(page, 'ArrowDown');
    verdadero(/vac[ií]a/i.test(await textoDe(vista(page))), 'una nota vacía debe explicar que está vacía');
    verdadero(await vista(page).isVisible());
  });
});

await prueba('sin notas no hay vista previa que alternar: el botón no se ofrece y Alt+P no hace nada ni falla', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('a', 'Una', T0)], 'a') } }, async page => {
    verdadero(await modo(page).isVisible() && await eliminarBtn(page).isVisible(), 'con una nota sí se ofrecen el modo y Eliminar');
  });
  await con({ sembrar: { [CLAVE]: datos([], null) } }, async (page, reg) => {
    verdadero(!(await modo(page).isVisible()), 'sin notas el botón no debe verse');
    verdadero(!(await eliminarBtn(page).isVisible()), 'sin notas no hay nada que eliminar');
    await tecla(page, 'Alt+KeyP');
    await tecla(page, 'Alt+Backspace');
    verdadero(!(await vista(page).isVisible()) && await page.locator('#vacio').isVisible());
    limpio(reg);
  });
});

await prueba('los enlaces internos (#) de la vista previa no cambian la URL: llevan al título coincidente o no hacen nada', async () => {
  const cuerpo = ['# Inicio', '', '[ir al final](#fin)', '', '[a ningún sitio](#no-existe)', '', '[contenido](#contenido)', ''].concat(Array.from({ length: 70 }, (_, i) => `Párrafo ${i}\n`), ['## Fin', '', 'cierre']).join('\n');
  await con({ sembrar: { [CLAVE]: datos([nota('a', cuerpo, T0)], 'a') } }, async (page, reg) => {
    const url0 = page.url();
    await tecla(page, 'Alt+KeyP');
    igual(await vista(page).evaluate(v => v.scrollTop), 0);
    await vista(page).getByRole('link', { name: 'ir al final' }).click();
    verdadero(await vista(page).evaluate(v => v.scrollTop) > 200, 'el enlace a #fin debe llevar al título "Fin"');
    await vista(page).getByRole('link', { name: 'a ningún sitio' }).click();
    await vista(page).getByRole('link', { name: 'contenido', exact: true }).click();
    igual(page.url(), url0, 'la URL no cambia');
    verdadero(await vista(page).isVisible());
    limpio(reg);
  });
});

await prueba('alternar a vista previa una nota de 200 KB es rápido (< 800 ms) y la vista no desborda', async () => {
  const linea = 'Línea de texto de prueba con **énfasis**, `código` y [enlace](https://example.com/x). ';
  const cuerpo = ('# Título\n\n' + linea.repeat(8) + '\n\n').repeat(Math.ceil(200000 / (linea.length * 8 + 12)));
  await con({ sembrar: { [CLAVE]: datos([nota('g', cuerpo, T0)], 'g') } }, async page => {
    const ms = await page.evaluate(() => {
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', altKey: true, bubbles: true, cancelable: true }));
      return performance.now() - t0;
    });
    verdadero(await vista(page).isVisible(), 'la vista previa debe abrirse');
    verdadero(ms < 800, `renderizar 200 KB tardó ${ms.toFixed(0)} ms`);
    igual(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  });
});

// =====================================================================================
console.log('\n[nueva nota y atajos de acción]');

await prueba('Alt+N crea una nota vacía con el cursor en el editor desde el editor, la lista, la búsqueda y la vista previa, y limpia el filtro', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await editor(page).focus();
    await tecla(page, 'Alt+KeyN');
    let f = await filas(page);
    igual(f.length, 5);
    igual([f[0].titulo, f[0].seleccionada], ['Sin título', true]);
    verdadero(await enFoco(page, '#editor') && await valor(page) === '', 'cursor en el editor, vacío');
    igual((await guardado(page)).notas.length, 5, 'se guarda al instante');
    await page.locator('#lista').focus();
    await tecla(page, 'Alt+KeyN');
    igual((await filas(page)).length, 6);
    verdadero(await enFoco(page, '#editor'));
    await busqueda(page).fill('queso');
    await tecla(page, 'Alt+KeyN');
    igual(await busqueda(page).inputValue(), '');
    igual((await filas(page)).length, 7, 'el filtro se limpia al crear');
    await tecla(page, 'Alt+KeyP');
    verdadero(await vista(page).isVisible());
    await tecla(page, 'Alt+KeyN');
    verdadero(await editor(page).isVisible() && !(await vista(page).isVisible()), 'una nota nueva se escribe, no se previsualiza');
    verdadero(await enFoco(page, '#editor'));
    igual((await filas(page)).length, 8);
    igual(await modo(page).getAttribute('aria-pressed'), 'false');
  });
});

await prueba('los atajos con Alt no se disparan con Ctrl, Meta o Mayús añadidos ni al mantener la tecla pulsada', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    for (const t of ['Control+Alt+KeyN', 'Meta+Alt+KeyN', 'Shift+Alt+KeyN']) await tecla(page, t);
    igual((await filas(page)).length, 4, 'Alt+N con otro modificador no crea');
    for (const t of ['Control+Alt+Backspace', 'Meta+Alt+Backspace', 'Shift+Alt+Backspace']) await tecla(page, t);
    igual((await filas(page)).length, 4, 'Alt+Retroceso con otro modificador no elimina');
    await tecla(page, 'Alt+KeyN');
    igual((await filas(page)).length, 5);
    const n = await page.evaluate(() => {
      const ev = () => new KeyboardEvent('keydown', { code: 'KeyN', altKey: true, repeat: true, bubbles: true, cancelable: true });
      for (let i = 0; i < 5; i++) document.dispatchEvent(ev());
      return document.querySelectorAll('#lista [role="option"]').length;
    });
    igual(n, 5, 'la repetición de tecla no crea notas en cadena');
    await tecla(page, 'Escape');                                     // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8): se vuelve a la lista
    await tecla(page, 'Alt+Backspace');
    igual((await filas(page)).length, 4);
    const m = await page.evaluate(() => {
      for (let i = 0; i < 5; i++) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace', altKey: true, repeat: true, bubbles: true, cancelable: true }));
      return document.querySelectorAll('#lista [role="option"]').length;
    });
    igual(m, 4, 'mantener Alt+Retroceso no elimina notas en cadena');
  });
});

// =====================================================================================
console.log('\n[eliminar y deshacer]');

const ORIGINALES = [
  { id: 'arbol', texto: 'Árbol de la ceiba\nSu tronco tiene espinas y da sombra al pueblo.', creada: T0 - 9 * DIA, editada: T0 - 1 * HORA },
  { id: 'arepas', texto: 'Receta de arepas\nHarina de maíz, agua y sal.\n\nSe acompañan con queso.', creada: T0 - 8 * DIA, editada: T0 - 2 * HORA },
  { id: 'compras', texto: 'Lista de compras\n- queso\n- harina\n- café', creada: T0 - 7 * DIA, editada: T0 - 3 * HORA },
  { id: 'ideas', texto: 'Ideas\nUn cuento sobre una CEIBA y un pueblo con queso.', creada: T0 - 6 * DIA, editada: T0 - 4 * HORA },
];
const SIEMBRA_ORIG = { [CLAVE]: datos(ORIGINALES, 'arbol') };

await prueba('Alt+Retroceso elimina de inmediato: guarda sin esperar, selecciona la vecina, anuncia y ofrece Deshacer', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Alt+Backspace');
    const g = await guardado(page);                                   // el reloj está detenido: nada se guardó por temporizador
    igual(g.notas.map(n => n.id), ['arepas', 'compras', 'ideas'], 'la persistencia no espera');
    igual(g.activa, 'arepas');
    igual(await titulos(page), ['Receta de arepas', 'Lista de compras', 'Ideas']);
    igual((await filas(page)).map(f => f.seleccionada), [true, false, false]);
    verdadero((await valor(page)).startsWith('Receta de arepas'), 'el editor muestra la nota vecina');
    const aviso = avisosDeshacer(page);
    igual(await aviso.count(), 1);
    verdadero((await textoDe(aviso)).includes('Se eliminó «Árbol de la ceiba»'), `texto del aviso: ${await textoDe(aviso)}`);
    verdadero(await deshacerBtn(page).isVisible());
    const anuncio = await vivo(page);
    verdadero(anuncio.includes('Se eliminó «Árbol de la ceiba»') && anuncio.includes('Alt+Z'), `anuncio: ${anuncio}`);
    igual(await page.locator('[aria-live]').count(), 1, 'sigue habiendo una sola región viva');
  });
});

await prueba('tras eliminar se selecciona la nota vecina: la siguiente (más antigua) o, en el último lugar, la anterior', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await page.locator('#lista [data-id="arepas"]').click();
    await tecla(page, 'Alt+Backspace');
    igual(await activaGuardada(page), 'compras', 'en medio: la siguiente');
    await page.locator('#lista [data-id="ideas"]').click();
    await tecla(page, 'Alt+Backspace');
    igual(await activaGuardada(page), 'compras', 'al final: la anterior');
    igual(await titulos(page), ['Árbol de la ceiba', 'Lista de compras']);
    verdadero((await filas(page)).find(f => f.id === 'compras').seleccionada);
  });
});

await prueba('Deshacer con el botón restaura la nota en su posición con sus fechas originales y la deja activa; guarda al instante', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await page.locator('#lista [data-id="arepas"]').click();
    await tecla(page, 'Alt+Backspace');
    igual(await titulos(page), ['Árbol de la ceiba', 'Lista de compras', 'Ideas']);
    await page.clock.runFor(2000);
    await deshacerBtn(page).click();
    igual(await titulos(page), ['Árbol de la ceiba', 'Receta de arepas', 'Lista de compras', 'Ideas'], 'vuelve a su posición');
    const g = await guardado(page);
    igual(g.notas.find(n => n.id === 'arepas'), ORIGINALES[1], 'texto, creada y editada idénticos a los originales');
    igual(g.notas.map(n => n.id), ['arbol', 'arepas', 'compras', 'ideas'], 'también en el orden guardado');
    igual(g.activa, 'arepas');
    verdadero((await filas(page)).find(f => f.id === 'arepas').seleccionada);
    verdadero((await valor(page)).startsWith('Receta de arepas'));
    igual(await textoDe(page.locator('#est-edicion')), `Última edición: ${await fecha(page, T0 - 2 * HORA)}`);
    igual(await avisosDeshacer(page).count(), 0, 'el aviso desaparece al deshacer');
    verdadero((await vivo(page)).includes('Receta de arepas'), 'se anuncia la restauración');
    igual(await idFoco(page), 'lista', 'el foco no se pierde: vuelve a la lista');
  });
});

await prueba('Alt+Z deshace mientras el aviso está visible y no hace nada cuando no hay nada que deshacer', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Alt+KeyZ');
    igual((await guardado(page)).notas.length, 4, 'sin aviso, Alt+Z no hace nada');
    igual(await valor(page), ORIGINALES[0].texto);
    await tecla(page, 'Alt+Backspace');
    igual((await guardado(page)).notas.length, 3);
    await tecla(page, 'Alt+KeyZ');
    const g = await guardado(page);
    igual(g.notas.length, 4);
    igual(g.notas.find(n => n.id === 'arbol'), ORIGINALES[0]);
    igual(g.activa, 'arbol');
    igual(await titulos(page), ['Árbol de la ceiba', 'Receta de arepas', 'Lista de compras', 'Ideas']);
    await tecla(page, 'Alt+KeyZ');
    igual((await guardado(page)).notas.length, 4, 'una segunda vez no hace nada');
  });
});

await prueba('Alt+Z funciona con el foco en el editor y no escribe ningún carácter', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await page.locator('#lista').focus();                            // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8)
    await tecla(page, 'Alt+Backspace');
    igual((await guardado(page)).notas.length, 3, 'la nota se eliminó con el foco en la lista');
    verdadero((await valor(page)).startsWith('Receta de arepas'), 'el editor pasó a la vecina');
    await editor(page).focus();
    await tecla(page, 'Alt+KeyZ');
    igual(await valor(page), ORIGINALES[0].texto, 'el editor muestra la nota restaurada, sin caracteres extra');
    igual((await guardado(page)).notas.length, 4);
    igual((await guardado(page)).activa, 'arbol');
  });
});

await prueba('el aviso dura 8 s: a los 7.999 ms aún se puede deshacer; a los 8.000 ms desaparece y Alt+Z ya no restaura', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Alt+Backspace');
    await page.clock.runFor(7999);
    igual(await avisosDeshacer(page).count(), 1, 'a los 7.999 ms el aviso sigue');
    await tecla(page, 'Alt+KeyZ');
    igual((await guardado(page)).notas.length, 4, 'a los 7.999 ms se puede deshacer');
  });
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Alt+Backspace');
    await page.clock.runFor(8000);
    igual(await avisosDeshacer(page).count(), 0, 'a los 8.000 ms el aviso se retira');
    await tecla(page, 'Alt+KeyZ');
    igual((await guardado(page)).notas.map(n => n.id), ['arepas', 'compras', 'ideas'], 'ya no se restaura');
    igual((await filas(page)).length, 3);
  });
});

await prueba('recargar antes de que acabe el aviso deja la eliminación confirmada y sin aviso', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Alt+Backspace');
    await page.reload();
    igual(await titulos(page), ['Receta de arepas', 'Lista de compras', 'Ideas']);
    igual(await avisosDeshacer(page).count(), 0);
    igual((await guardado(page)).notas.length, 3);
    await tecla(page, 'Alt+KeyZ');
    igual((await filas(page)).length, 3, 'tras recargar ya no hay nada que deshacer');
  });
});

await prueba('eliminar varias seguidas: se deshacen en orden inverso, cada una durante sus propios 8 s, y solo se ve un aviso', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Alt+Backspace');                              // elimina arbol
    await page.clock.runFor(5000);
    await tecla(page, 'Alt+Backspace');                              // elimina arepas
    igual(await avisosDeshacer(page).count(), 1, 'un solo aviso a la vez');
    verdadero((await textoDe(avisosDeshacer(page))).includes('Receta de arepas'), 'el aviso habla de la última');
    igual((await guardado(page)).notas.map(n => n.id), ['compras', 'ideas']);
    await page.clock.runFor(3000);                                   // arbol cumple sus 8 s; arepas lleva 3 s
    igual(await avisosDeshacer(page).count(), 1);
    await tecla(page, 'Alt+KeyZ');                                   // restaura arepas
    igual((await guardado(page)).notas.map(n => n.id), ['arepas', 'compras', 'ideas']);
    igual(await avisosDeshacer(page).count(), 0, 'la de arbol ya venció: no reaparece su aviso');
    await tecla(page, 'Alt+KeyZ');
    igual((await guardado(page)).notas.map(n => n.id), ['arepas', 'compras', 'ideas'], 'arbol ya no se recupera');
  });
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Alt+Backspace');
    await page.clock.runFor(2000);
    await tecla(page, 'Alt+Backspace');
    await tecla(page, 'Alt+KeyZ');                                   // restaura arepas
    igual(await avisosDeshacer(page).count(), 1, 'reaparece el aviso de la anterior mientras dure');
    verdadero((await textoDe(avisosDeshacer(page))).includes('Árbol de la ceiba'));
    await tecla(page, 'Alt+KeyZ');                                   // restaura arbol
    igual((await guardado(page)).notas.map(n => n.id), ['arbol', 'arepas', 'compras', 'ideas']);
    igual(await titulos(page), ['Árbol de la ceiba', 'Receta de arepas', 'Lista de compras', 'Ideas']);
    igual(await avisosDeshacer(page).count(), 0);
  });
});

await prueba('eliminar la última nota: estado vacío con el foco en "Escribir la primera nota", sin recrear la bienvenida; Deshacer la devuelve', async () => {
  await con({ reloj: T0 }, async (page, reg) => {
    await editor(page).focus();
    await tecla(page, 'Escape');                                     // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8)
    await tecla(page, 'Alt+Backspace');
    verdadero(await page.locator('#vacio').isVisible(), 'estado vacío');
    igual((await guardado(page)).notas.length, 0);
    igual(await idFoco(page), 'primera', 'el foco no se pierde: va al botón del estado vacío');
    igual(await avisosDeshacer(page).count(), 1);
    await tecla(page, 'Alt+KeyZ');
    igual(await titulos(page), ['Bienvenida a Ceiba']);
    verdadero(!(await page.locator('#vacio').isVisible()) && await editor(page).isVisible());
    await tecla(page, 'Alt+Backspace');
    await page.clock.runFor(8000);
    await page.reload();
    verdadero(await page.locator('#vacio').isVisible(), 'sigue vacío tras recargar');
    igual((await guardado(page)).notas.length, 0, 'la bienvenida no se recrea');
    await tecla(page, 'Alt+KeyN');
    verdadero(await enFoco(page, '#editor') && (await filas(page)).length === 1, 'Alt+N sirve también desde el estado vacío');
    limpio(reg);
  });
});

await prueba('eliminar con un filtro activo toma la vecina de lo que se ve y actualiza el contador; Deshacer la vuelve a mostrar', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await busqueda(page).fill('queso');
    igual(await titulos(page), ['Receta de arepas', 'Lista de compras', 'Ideas']);
    await page.locator('#lista [data-id="arepas"]').click();
    await tecla(page, 'Alt+Backspace');
    igual(await titulos(page), ['Lista de compras', 'Ideas']);
    igual(await activaGuardada(page), 'compras');
    igual(await textoDe(page.locator('#cuenta')), '2 resultados');
    await tecla(page, 'Alt+KeyZ');
    igual(await titulos(page), ['Receta de arepas', 'Lista de compras', 'Ideas']);
    igual(await textoDe(page.locator('#cuenta')), '3 resultados');
    igual(await busqueda(page).inputValue(), 'queso', 'el filtro se conserva');
  });
});

await prueba('el botón Eliminar de la barra elimina la nota activa y conserva el foco en el botón', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await eliminarBtn(page).click();
    igual(await titulos(page), ['Receta de arepas', 'Lista de compras', 'Ideas']);
    igual(await idFoco(page), 'eliminar');
    verdadero(await deshacerBtn(page).isVisible());
  });
});

await prueba('el botón Deshacer es alcanzable con Tab desde el editor y se activa con Enter', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await page.locator('#lista').focus();                            // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8)
    await tecla(page, 'Alt+Backspace');
    await editor(page).focus();
    const paradas = [];
    for (let i = 0; i < 2; i++) { await tecla(page, 'Tab'); paradas.push(await idFoco(page)); }
    igual(paradas[0], 'enfoque', 'tras el editor viene Modo enfoque');
    verdadero(await deshacerBtn(page).evaluate(b => b === document.activeElement), 'después, el botón Deshacer');
    await tecla(page, 'Enter');
    igual((await guardado(page)).notas.length, 4);
    igual(await avisosDeshacer(page).count(), 0);
    igual(await idFoco(page), 'lista', 'el foco pasa a la lista, no se pierde');
  });
});

await prueba('eliminar y restaurar una nota con texto pendiente de guardar conserva lo último escrito', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await escribir(page, ' EXTRA');
    await tecla(page, 'Escape');                                     // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8); Esc no pierde el texto
    await tecla(page, 'Alt+Backspace');
    const g = await guardado(page);
    verdadero(!g.notas.some(n => n.id === 'arbol'));
    await tecla(page, 'Alt+KeyZ');
    const r = (await guardado(page)).notas.find(n => n.id === 'arbol');
    igual(r.texto, ORIGINALES[0].texto + ' EXTRA', 'se conserva el texto que aún no se había guardado');
    igual(r.creada, ORIGINALES[0].creada);
  });
});

await prueba('eliminar sin almacenamiento disponible funciona en memoria y se puede deshacer', async () => {
  const bloquear = () => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Acceso denegado', 'SecurityError'); } });
  await con({ init: { fn: bloquear } }, async (page, reg) => {
    await tecla(page, 'Alt+KeyN');
    await page.keyboard.type('Segunda');
    await tecla(page, 'Escape');                                     // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8)
    await tecla(page, 'Alt+Backspace');
    igual(await titulos(page), ['Bienvenida a Ceiba']);
    await tecla(page, 'Alt+KeyZ');
    igual(await titulos(page), ['Segunda', 'Bienvenida a Ceiba']);
    igual(reg.errores, []);
  });
});

// =====================================================================================
console.log('\n[teclado: lista, búsqueda y Esc]');

await prueba('lista: flechas mueven la selección y abren la nota sin sacar el foco de la lista; Inicio y Fin saltan; no se sale por los extremos', async () => {
  await con({ sembrar: SIEMBRA_ORIG }, async page => {
    await aLista(page);
    const paso = async (t, esperada) => {
      await tecla(page, t);
      igual(await activaGuardada(page), esperada, `${t}: nota activa guardada`);
      igual(await page.locator('#lista').getAttribute('aria-activedescendant'), 'nota-' + esperada);
      igual((await filas(page)).filter(f => f.seleccionada).map(f => f.id), [esperada]);
      verdadero((await valor(page)).startsWith(ORIGINALES.find(n => n.id === esperada).texto.slice(0, 8)), `${t}: el editor muestra la nota`);
      verdadero(await enFoco(page, '#lista'), `${t}: el foco sigue en la lista`);
    };
    await paso('ArrowDown', 'arepas');
    await paso('ArrowDown', 'compras');
    await paso('End', 'ideas');
    await paso('ArrowDown', 'ideas');
    await paso('ArrowUp', 'compras');
    await paso('Home', 'arbol');
    await paso('ArrowUp', 'arbol');
  });
});

await prueba('lista: Enter y Flecha derecha pasan el foco al editor sin tocar el texto ni las fechas', async () => {
  for (const t of ['Enter', 'ArrowRight']) {
    await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
      await aLista(page);
      await tecla(page, 'ArrowDown');
      await tecla(page, t);
      verdadero(await enFoco(page, '#editor'), `${t} debe llevar al editor`);
      verdadero((await valor(page)).startsWith('Receta de arepas'));
      await page.clock.runFor(1000);
      igual((await notaGuardada(page, 'arepas')).editada, T0 - 2 * HORA, 'solo moverse no cambia la fecha');
    });
  }
});

await prueba('lista: la navegación sigue lo que se ve (filtro activo) y Flecha abajo desde la búsqueda pasa a la lista', async () => {
  await con({ sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Control+KeyK');
    await page.keyboard.type('queso');
    igual(await titulos(page), ['Receta de arepas', 'Lista de compras', 'Ideas']);
    await tecla(page, 'ArrowDown');                                    // desde la búsqueda: pasa a la lista
    verdadero(await enFoco(page, '#lista'));
    igual(await activaGuardada(page), 'arepas', 'la activa (Árbol) no coincide: se selecciona el primer resultado');
    await tecla(page, 'ArrowDown');
    igual(await activaGuardada(page), 'compras');
    await tecla(page, 'End');
    igual(await activaGuardada(page), 'ideas');
    await tecla(page, 'ArrowDown');
    igual(await activaGuardada(page), 'ideas', 'el último resultado no pasa a una nota oculta');
    await tecla(page, 'Home');
    igual(await activaGuardada(page), 'arepas');
  });
});

await prueba('lista con la nota activa excluida por el filtro: Flecha abajo elige el primer resultado y Flecha arriba el último', async () => {
  await con({ sembrar: SIEMBRA_ORIG }, async page => {
    await busqueda(page).fill('queso');
    await page.locator('#lista').focus();
    await tecla(page, 'ArrowUp');
    igual(await activaGuardada(page), 'ideas');
  });
  await con({ sembrar: SIEMBRA_ORIG }, async page => {
    await busqueda(page).fill('queso');
    await page.locator('#lista').focus();
    await tecla(page, 'ArrowDown');
    igual(await activaGuardada(page), 'arepas');
  });
});

await prueba('lista: las teclas con Ctrl, Alt o Meta no mueven la selección ni se interceptan', async () => {
  await con({ sembrar: SIEMBRA_ORIG }, async page => {
    await aLista(page);
    for (const t of ['Control+ArrowDown', 'Meta+ArrowDown', 'Shift+ArrowDown', 'Control+End', 'Alt+ArrowDown']) await tecla(page, t);
    igual(await activaGuardada(page), 'arbol');
    await tecla(page, 'ArrowDown');
    igual(await activaGuardada(page), 'arepas', 'sin modificadores la misma tecla sí mueve');
  });
});

await prueba('Ctrl+K y Cmd+K enfocan y seleccionan la búsqueda desde el editor, la lista y la vista previa, sin escribir nada', async () => {
  for (const combo of ['Control+KeyK', 'Meta+KeyK']) {
    await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
      await busqueda(page).fill('queso');
      await editor(page).focus();
      await tecla(page, combo);
      verdadero(await enFoco(page, '#busqueda'), `${combo} desde el editor`);
      igual(await page.evaluate(() => { const b = document.querySelector('#busqueda'); return [b.selectionStart, b.selectionEnd]; }), [0, 5], 'el texto queda seleccionado');
      igual(await valor(page), AMBIENTE[0].texto, 'no se escribe nada en la nota');
      await page.locator('#lista').focus();
      await tecla(page, combo);
      verdadero(await enFoco(page, '#busqueda'), `${combo} desde la lista`);
      await tecla(page, 'Alt+KeyP');
      await tecla(page, combo);
      verdadero(await enFoco(page, '#busqueda'), `${combo} desde la vista previa`);
      await page.keyboard.type('s');                                   // reemplaza la selección
      igual(await busqueda(page).inputValue(), 's');
    });
  }
});

await prueba('"/" fuera de un campo de texto enfoca la búsqueda sin escribir la barra; dentro del editor y de la búsqueda se escribe', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await aLista(page);
    await tecla(page, 'Slash');
    verdadero(await enFoco(page, '#busqueda'), '"/" desde la lista');
    igual(await busqueda(page).inputValue(), '', 'la barra no se escribe en la búsqueda');
    await page.keyboard.type('a/b');
    igual(await busqueda(page).inputValue(), 'a/b', 'dentro de la búsqueda "/" es un carácter');
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await tecla(page, 'Slash');
    verdadero(await enFoco(page, '#editor'), 'dentro del editor "/" no mueve el foco');
    verdadero((await valor(page)).endsWith('/'), 'y se escribe');
    await tecla(page, 'Alt+KeyP');                                    // vista previa: no es un campo de texto
    await tecla(page, 'Slash');
    verdadero(await enFoco(page, '#busqueda'), '"/" desde la vista previa');
    await page.locator('#nueva').focus();
    await tecla(page, 'Slash');
    verdadero(await enFoco(page, '#busqueda'), '"/" desde un botón');
  });
});

await prueba('Esc en la búsqueda borra el texto y devuelve el foco a la lista (también con la búsqueda vacía)', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await tecla(page, 'Control+KeyK');
    await page.keyboard.type('queso');
    igual((await filas(page)).length, 3);
    await tecla(page, 'Escape');
    igual(await busqueda(page).inputValue(), '');
    igual((await filas(page)).length, 4);
    igual(await textoDe(page.locator('#cuenta')), '4 notas');
    verdadero(await enFoco(page, '#lista'), 'el foco vuelve a la lista');
    await tecla(page, 'Control+KeyK');
    await tecla(page, 'Escape');
    verdadero(await enFoco(page, '#lista'), 'con la búsqueda vacía también va a la lista');
    await busqueda(page).fill('zzzz');
    await busqueda(page).focus();
    await tecla(page, 'Escape');
    verdadero(await page.locator('#lista').isVisible() && await enFoco(page, '#lista'), 'tras una búsqueda sin resultados, Esc restaura la lista y el foco');
  });
});

await prueba('Esc en la lista con una búsqueda activa la borra sin mover el foco; sin búsqueda no hace nada', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await busqueda(page).fill('queso');
    await page.locator('#lista').focus();
    await tecla(page, 'Escape');
    igual(await busqueda(page).inputValue(), '');
    igual((await filas(page)).length, 4);
    verdadero(await enFoco(page, '#lista'));
    await tecla(page, 'Escape');
    verdadero(await enFoco(page, '#lista'));
    igual(await activaGuardada(page), 'arbol');
  });
});

await prueba('Esc en el editor devuelve el foco a la lista sin perder texto ni tocar las fechas; también desde la vista previa', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await escribir(page, ' nuevo');
    const antes = await valor(page);
    await tecla(page, 'Escape');
    verdadero(await enFoco(page, '#lista'), 'el foco va a la lista');
    igual(await valor(page), antes, 'el texto sigue intacto');
    await page.clock.runFor(300);
    const g = (await guardado(page)).notas.find(n => n.id === 'arbol');
    igual(g.texto, antes, 'y se guarda');
    igual(g.editada, T0, 'Esc no cambia la fecha de edición');
    await tecla(page, 'Enter');
    verdadero(await enFoco(page, '#editor'));
    await tecla(page, 'Alt+KeyP');
    await tecla(page, 'Escape');
    verdadero(await enFoco(page, '#lista'));
    igual(await vista(page).isVisible(), true, 'volver a la lista no cambia el modo');
  });
});

await prueba('Enter en la búsqueda abre el primer resultado (o la nota activa si coincide) y pasa al editor', async () => {
  await con({ sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Control+KeyK');
    await page.keyboard.type('queso');
    await tecla(page, 'Enter');
    verdadero(await enFoco(page, '#editor'));
    igual(await activaGuardada(page), 'arepas', 'la activa (Árbol) no coincide: gana el primer resultado');
    await tecla(page, 'Control+KeyK');
    await tecla(page, 'Enter');
    igual(await activaGuardada(page), 'arepas', 'la activa coincide: no cambia');
  });
});

await prueba('móvil 360: las flechas recorren la lista sin cambiar de vista; Enter abre el editor; Esc vuelve a la lista; Ctrl+K y "/" muestran la búsqueda', async () => {
  await con({ ancho: 360, alto: 740, sembrar: SIEMBRA_ORIG }, async page => {
    const lateral = page.locator('aside'), principal = page.locator('main');
    await aLista(page);
    await tecla(page, 'ArrowDown');
    verdadero(await lateral.isVisible() && !(await principal.isVisible()), 'las flechas no cambian de vista');
    igual(await activaGuardada(page), 'arepas');
    await tecla(page, 'Enter');
    verdadero(await principal.isVisible() && !(await lateral.isVisible()), 'Enter abre el editor');
    verdadero(await enFoco(page, '#editor'));
    await tecla(page, 'Escape');
    verdadero(await lateral.isVisible() && !(await principal.isVisible()) && await enFoco(page, '#lista'), 'Esc vuelve a la lista');
    await tecla(page, 'Enter');
    await tecla(page, 'Control+KeyK');
    verdadero(await lateral.isVisible() && await enFoco(page, '#busqueda'), 'Ctrl+K desde el editor muestra la lista y enfoca la búsqueda');
    await tecla(page, 'ArrowDown'); await tecla(page, 'ArrowRight');
    verdadero(await enFoco(page, '#editor'));
    await tecla(page, 'Alt+KeyP');
    await tecla(page, 'Slash');
    verdadero(await lateral.isVisible() && await enFoco(page, '#busqueda'), '"/" desde la vista previa muestra la búsqueda');
  });
});

await prueba('móvil 360: Alt+P desde la vista de la lista abre la nota en vista previa (el cambio se ve) y Alt+P de nuevo vuelve a escribir', async () => {
  await con({ ancho: 360, alto: 740, sembrar: SIEMBRA_ORIG }, async page => {
    await aLista(page);
    await tecla(page, 'Alt+KeyP');
    verdadero(await page.locator('main').isVisible() && !(await page.locator('aside').isVisible()), 'debe pasar a la vista del contenido');
    verdadero(await vista(page).isVisible() && await enFoco(page, '#vista'), 'con la vista previa enfocada');
    await tecla(page, 'Alt+KeyP');
    verdadero(await editor(page).isVisible() && await enFoco(page, '#editor'));
  });
});

await prueba('"Saltar al contenido" desde la lista en móvil abre la vista de la nota y enfoca el contenido', async () => {
  await con({ ancho: 360, alto: 740, sembrar: SIEMBRA_ORIG }, async page => {
    await tecla(page, 'Tab');
    await tecla(page, 'Enter');
    verdadero(await page.locator('main').isVisible(), 'el contenido debe mostrarse');
    verdadero(await enFoco(page, '#contenido'), 'y recibir el foco');
  });
});

// =====================================================================================
console.log('\n[diálogo de atajos]');

await prueba('Shift+Slash abre el diálogo: modal con nombre, foco dentro, Tab y Shift+Tab no escapan, Esc cierra y devuelve el foco', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
    await aLista(page);
    verdadero(!(await ayuda(page).isVisible()));
    await tecla(page, 'Shift+Slash');
    verdadero(await ayuda(page).isVisible(), 'el diálogo debe verse');
    igual(await page.locator('#ayuda').getAttribute('aria-modal'), 'true');
    verdadero(await dentroDelDialogo(page), 'el foco debe estar dentro del diálogo');
    for (let i = 0; i < 8; i++) { await tecla(page, 'Tab'); verdadero(await dentroDelDialogo(page), `Tab ${i + 1} escapó del diálogo`); }
    for (let i = 0; i < 8; i++) { await tecla(page, 'Shift+Tab'); verdadero(await dentroDelDialogo(page), `Shift+Tab ${i + 1} escapó del diálogo`); }
    await tecla(page, 'Shift+Slash');
    igual(await page.locator('dialog[open]').count(), 1, 'no se apilan diálogos');
    await tecla(page, 'Escape');
    verdadero(!(await ayuda(page).isVisible()), 'Esc cierra');
    verdadero(await enFoco(page, '#lista'), 'el foco vuelve a la lista');
    igual((await filas(page)).length, 4);
    limpio(reg);
  });
});

await prueba('el diálogo lista los atajos reales con teclas (kbd) y no tiene emojis', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await tecla(page, 'Shift+Slash');
    const filasAyuda = await page.evaluate(() => [...document.querySelectorAll('#ayuda .atajo')].map(r => [r.querySelector('dt').textContent.trim(), [...r.querySelectorAll('kbd')].map(k => k.textContent.trim())]));
    const buscar = re => { const f = filasAyuda.find(x => re.test(x[0])); verdadero(f, `falta la fila ${re}`); return f[1]; };
    igual(buscar(/nueva nota/i), ['Alt', 'N']);
    igual(buscar(/eliminar/i), ['Alt', 'Retroceso']);
    igual(buscar(/deshacer/i), ['Alt', 'Z']);
    igual(buscar(/vista previa/i), ['Alt', 'P']);
    igual(buscar(/enfoque/i), ['Alt', '\\']);
    verdadero(buscar(/buscar/i).includes('K') && buscar(/buscar/i).includes('/'), 'buscar: Ctrl/Cmd+K y /');
    verdadero(buscar(/ayuda/i).includes('?'), 'ayuda: ?');
    verdadero(filasAyuda.some(f => /lista|moverse/i.test(f[0])) && filasAyuda.some(f => f[1].includes('Inicio')), 'faltan los atajos de la lista');
    verdadero(!EMOJI.test(await page.locator('#ayuda').evaluate(d => d.textContent)), 'sin emojis');
  });
});

await prueba('el botón "Atajos" del pie abre el mismo diálogo; Cerrar, Esc y clic fuera lo cierran devolviendo el foco al botón', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await atajosBtn(page).click();
    verdadero(await ayuda(page).isVisible());
    verdadero(await dentroDelDialogo(page));
    await ayuda(page).getByRole('button', { name: 'Cerrar', exact: true }).click();
    verdadero(!(await ayuda(page).isVisible()));
    igual(await idFoco(page), 'atajos');
    await atajosBtn(page).click();
    await tecla(page, 'Escape');
    verdadero(!(await ayuda(page).isVisible()));
    igual(await idFoco(page), 'atajos');
    await atajosBtn(page).click();
    await page.mouse.click(5, 5);
    verdadero(!(await ayuda(page).isVisible()), 'clic en el fondo cierra');
    igual(await idFoco(page), 'atajos');
  });
});

await prueba('"?" no abre la ayuda al escribir en el editor ni en la búsqueda: es un carácter más', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await nueva(page).click();
    await page.keyboard.type('Qué pasó? Nada?');
    verdadero(!(await ayuda(page).isVisible()));
    igual(await valor(page), 'Qué pasó? Nada?');
    await busqueda(page).focus();
    await page.keyboard.type('a?b');
    verdadero(!(await ayuda(page).isVisible()));
    igual(await busqueda(page).inputValue(), 'a?b');
    await busqueda(page).fill('');
    await page.locator('#lista').focus();
    await tecla(page, 'Shift+Slash');
    verdadero(await ayuda(page).isVisible(), 'fuera de los campos, "?" sí abre la ayuda');
  });
});

await prueba('con el diálogo abierto los atajos globales no actúan (Alt+N, Alt+Retroceso, Alt+P, Alt+Z, Alt+\\, Ctrl+K, "/")', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
    await aLista(page);
    await tecla(page, 'Shift+Slash');
    for (const t of ['Alt+KeyN', 'Alt+Backspace', 'Alt+KeyP', 'Alt+KeyZ', 'Alt+Backslash', 'Control+KeyK', 'Slash']) await tecla(page, t);
    verdadero(await ayuda(page).isVisible(), 'sigue abierto');
    igual((await guardado(page)).notas.length, 4);
    verdadero(!(await vista(page).isVisible()));
    igual(await page.locator('html').getAttribute('data-enfoque'), null);
    verdadero(await dentroDelDialogo(page));
    await tecla(page, 'Escape');
    await tecla(page, 'Alt+KeyN');
    igual((await guardado(page)).notas.length, 5, 'al cerrar, vuelven a funcionar');
  });
});

await prueba('móvil 360: el diálogo cabe en la pantalla y su contenido se puede desplazar con el teclado', async () => {
  await con({ ancho: 360, alto: 640, sembrar: SIEMBRA_AMBIENTE }, async page => {
    await aLista(page);
    await tecla(page, 'Shift+Slash');
    const r = await page.locator('#ayuda').evaluate(d => { const b = d.getBoundingClientRect(); return { izq: b.left, der: b.right, arr: b.top, aba: b.bottom, w: innerWidth, h: innerHeight }; });
    verdadero(r.izq >= 0 && r.der <= r.w && r.arr >= 0 && r.aba <= r.h, `el diálogo se sale de la pantalla: ${JSON.stringify(r)}`);
    const zona = await page.evaluate(() => { const z = document.querySelector('#ayuda [tabindex="0"]'); return z ? { desborda: z.scrollHeight > z.clientHeight, nombre: z.getAttribute('aria-label') || z.getAttribute('aria-labelledby') } : null; });
    verdadero(zona && zona.desborda && zona.nombre, `la zona desplazable debe ser enfocable y tener nombre: ${JSON.stringify(zona)}`);
    igual(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  });
});

// =====================================================================================
console.log('\n[modo enfoque]');

const prefs = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), PREFS);

await prueba('Alt+\\ oculta la barra lateral y la superior, el editor ocupa todo el ancho, la barra de estado se atenúa; otra vez lo restaura', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
    const ancho = () => editor(page).evaluate(e => e.getBoundingClientRect().width);
    verdadero(await page.locator('aside').isVisible() && await modo(page).isVisible());
    const w0 = await ancho();
    verdadero(w0 < 1200, `ancho normal ${w0}`);
    igual(await enfoqueBtn(page).getAttribute('aria-pressed'), 'false');
    await editor(page).focus();
    await tecla(page, 'Alt+Backslash');
    igual(await page.locator('html').getAttribute('data-enfoque'), 'si');
    verdadero(!(await page.locator('aside').isVisible()), 'la barra lateral se oculta');
    verdadero(!(await modo(page).isVisible()) && !(await eliminarBtn(page).isVisible()), 'la barra superior se oculta');
    verdadero(await ancho() > 1400, `el editor debe ocupar todo el ancho (${await ancho()})`);
    verdadero(await enFoco(page, '#editor'), 'el foco sigue en el editor');
    verdadero(await page.locator('#estado').isVisible(), 'la barra de estado sigue visible');
    verdadero(parseFloat(await page.locator('#estado').evaluate(e => getComputedStyle(e).opacity)) < 1, 'y se atenúa');
    igual(await enfoqueBtn(page).getAttribute('aria-pressed'), 'true');
    verdadero((await vivo(page)).includes('enfoque activado'), `anuncio: ${await vivo(page)}`);
    await tecla(page, 'Alt+Backslash');
    igual(await page.locator('html').getAttribute('data-enfoque'), null);
    verdadero(await page.locator('aside').isVisible() && await modo(page).isVisible());
    verdadero(Math.abs(await ancho() - w0) <= 1, 'el ancho vuelve al normal');
    igual(await page.locator('#estado').evaluate(e => getComputedStyle(e).opacity), '1');
    verdadero((await vivo(page)).includes('enfoque desactivado'));
    limpio(reg);
  });
});

await prueba('el modo enfoque se guarda en las preferencias (conservando las demás claves) y sobrevive a recargar', async () => {
  await con({ sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ tema: 'oscuro', plan: 'brote', ciclo: 'anual' }) } }, async page => {
    await tecla(page, 'Alt+Backslash');
    igual(await prefs(page), { tema: 'oscuro', plan: 'brote', ciclo: 'anual', foco: true });
    await page.reload();
    igual(await page.locator('html').getAttribute('data-enfoque'), 'si');
    verdadero(!(await page.locator('aside').isVisible()), 'tras recargar sigue en modo enfoque');
    igual(await enfoqueBtn(page).getAttribute('aria-pressed'), 'true');
    await enfoqueBtn(page).click();                                    // el botón también lo apaga (con ratón o toque)
    igual(await prefs(page), { tema: 'oscuro', plan: 'brote', ciclo: 'anual', foco: false });
    verdadero(await page.locator('aside').isVisible());
    await page.reload();
    igual(await page.locator('html').getAttribute('data-enfoque'), null);
    igual(await page.locator('html').getAttribute('data-theme'), 'dark', 'el tema guardado no se pierde');
  });
});

await prueba('Alt+\\ con el foco en la lista lo mueve al contenido para que la barra lateral pueda ocultarse', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await aLista(page);
    await tecla(page, 'Alt+Backslash');
    verdadero(await enFoco(page, '#editor'));
    verdadero(!(await page.locator('aside').isVisible()));
    await tecla(page, 'Alt+KeyP');
    await tecla(page, 'Escape');                                       // Esc muestra la lista aunque esté oculta
    verdadero(await page.locator('aside').isVisible() && await enFoco(page, '#lista'), 'Esc asoma la lista mientras tenga el foco');
    await tecla(page, 'Enter');                                        // pasa al contenido: la lista vuelve a ocultarse
    verdadero(!(await page.locator('aside').isVisible()), 'al salir de la lista se oculta de nuevo');
  });
});

await prueba('en modo enfoque, Ctrl+K y "/" asoman la barra lateral para buscar y se oculta al pasar al contenido', async () => {
  await con({ sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ foco: true }) } }, async page => {
    verdadero(!(await page.locator('aside').isVisible()));
    await tecla(page, 'Control+KeyK');
    verdadero(await page.locator('aside').isVisible() && await enFoco(page, '#busqueda'), 'la búsqueda debe poder usarse');
    await page.keyboard.type('queso');
    igual((await filas(page)).length, 3);
    await tecla(page, 'Enter');
    verdadero(await enFoco(page, '#editor') && !(await page.locator('aside').isVisible()), 'Enter abre el resultado y vuelve a ocultar la lista');
    await tecla(page, 'Alt+KeyP');                                     // la vista previa no es un campo de texto
    await tecla(page, 'Slash');
    verdadero(await page.locator('aside').isVisible() && await enFoco(page, '#busqueda'), '"/" también');
  });
});

await prueba('en modo enfoque, cerrar el diálogo de atajos devuelve el foco a quien lo abrió aunque la barra lateral estuviera oculta mientras estaba abierto', async () => {
  await con({ sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ foco: true }) } }, async page => {
    await tecla(page, 'Control+KeyK');                                 // la barra lateral asoma porque la búsqueda tiene el foco
    await tecla(page, 'Shift+Tab');
    verdadero(await enFoco(page, '#nueva') && await page.locator('aside').isVisible(), 'el foco está en "Nueva nota", dentro de la barra asomada');
    await tecla(page, 'Shift+Slash');
    verdadero(await ayuda(page).isVisible() && !(await page.locator('aside').isVisible()), 'con el foco en el diálogo la barra lateral se oculta');
    await tecla(page, 'Escape');
    verdadero(await enFoco(page, '#nueva'), `el foco debe volver a "Nueva nota" (está en ${await idFoco(page)})`);
    verdadero(await page.locator('aside').isVisible(), 'y la barra lateral reaparece con él');
  });
});

await prueba('en modo enfoque, el ratón en el borde izquierdo o superior asoma las barras y al alejarlo se ocultan', async () => {
  await con({ sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ foco: true }) } }, async page => {
    await page.mouse.move(700, 450);
    verdadero(!(await page.locator('aside').isVisible()) && !(await modo(page).isVisible()));
    await page.mouse.move(2, 450);
    await esperar(() => page.locator('aside').isVisible(), 'la barra lateral debe asomar en el borde izquierdo');
    await page.locator('aside').getByRole('button', { name: 'Nueva nota' }).hover();
    verdadero(await page.locator('aside').isVisible(), 'sigue visible mientras el ratón está encima');
    await page.mouse.move(900, 450);
    await esperar(async () => !(await page.locator('aside').isVisible()), 'debe ocultarse al alejar el ratón');
    await page.mouse.move(700, 2);
    await esperar(() => modo(page).isVisible(), 'la barra superior debe asomar en el borde superior');
    await modo(page).hover();
    verdadero(await modo(page).isVisible());
    await page.mouse.move(700, 450);
    await esperar(async () => !(await modo(page).isVisible()), 'la barra superior debe ocultarse');
  });
});

await prueba('en modo enfoque las barras ocultas no son paradas de tabulación y la barra de estado conserva contraste AA aun atenuada', async () => {
  for (const esquema of ['light', 'dark']) {
    await con({ esquema, sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ foco: true }) } }, async page => {
      const paradas = [];
      for (let i = 0; i < 3; i++) { await tecla(page, 'Tab'); paradas.push(await idFoco(page)); }
      igual(paradas, ['A', 'editor', 'enfoque'], 'solo el salto, el editor y Modo enfoque: lo oculto no se alcanza');
      const pares = await page.evaluate(medirContraste, ['#est-guardado', '#est-palabras', '#est-caracteres', '#est-edicion', '#enfoque']);
      for (const [s, r] of pares) verdadero(r >= 4.5, `${esquema} enfoque ${s}: ${r.toFixed(2)}`);
    });
  }
});

await prueba('en pantallas pequeñas el modo enfoque no esconde la navegación (solo atenúa la barra de estado)', async () => {
  await con({ ancho: 360, alto: 740, sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ foco: true }) } }, async page => {
    igual(await page.locator('html').getAttribute('data-enfoque'), 'si', 'la preferencia sí se aplica');
    verdadero(await page.locator('aside').isVisible(), 'la lista sigue ahí');
    await page.locator('#lista [data-id="arepas"]').click();
    verdadero(await page.getByRole('button', { name: 'Volver a la lista', exact: true }).isVisible(), 'y también "Volver a la lista"');
  });
});

// =====================================================================================
console.log('\n[continuación de listas en el editor]');

const CASOS_LISTA = [
  ['viñeta con guion', ['- uno', 'Enter', 'dos'], '- uno\n- dos'],
  ['viñeta con asterisco', ['* uno', 'Enter', 'dos'], '* uno\n* dos'],
  ['viñeta con más', ['+ uno', 'Enter', 'dos'], '+ uno\n+ dos'],
  ['numerada con punto', ['1. uno', 'Enter', 'dos', 'Enter', 'tres'], '1. uno\n2. dos\n3. tres'],
  ['numerada con paréntesis y paso a dos cifras', ['9) uno', 'Enter', 'dos'], '9) uno\n10) dos'],
  ['tarea pendiente', ['- [ ] uno', 'Enter', 'dos'], '- [ ] uno\n- [ ] dos'],
  ['tarea hecha: la siguiente nace pendiente', ['- [x] uno', 'Enter', 'dos'], '- [x] uno\n- [ ] dos'],
  ['sangría conservada en viñetas', ['  - uno', 'Enter', 'dos'], '  - uno\n  - dos'],
  ['sangría conservada en numeradas', ['    3. uno', 'Enter', 'dos'], '    3. uno\n    4. dos'],
  ['espaciado original después del marcador', ['-   uno', 'Enter', 'dos'], '-   uno\n-   dos'],
  ['elemento vacío termina la lista (viñeta)', ['- uno', 'Enter', 'Enter', 'fin'], '- uno\nfin'],
  ['elemento vacío termina la lista (numerada)', ['1. a', 'Enter', 'Enter', 'x'], '1. a\nx'],
  ['elemento vacío termina la lista (tarea)', ['- [ ] a', 'Enter', 'Enter', 'x'], '- [ ] a\nx'],
  ['elemento vacío termina la lista (con sangría)', ['  - a', 'Enter', 'Enter', 'x'], '  - a\nx'],
  ['un solo marcador vacío se borra', ['- ', 'Enter', 'x'], 'x'],
  ['línea normal: salto simple', ['hola', 'Enter', 'mundo'], 'hola\nmundo'],
  ['guion pegado al texto no es lista', ['-uno', 'Enter', 'x'], '-uno\nx'],
  ['número decimal no es lista', ['1.5 litros', 'Enter', 'x'], '1.5 litros\nx'],
  ['énfasis con asterisco no es lista', ['*cursiva* y más', 'Enter', 'x'], '*cursiva* y más\nx'],
  ['Mayús+Enter inserta un salto sin continuar', ['- uno', 'Shift+Enter', 'x'], '- uno\nx'],
  ['dentro de un bloque de código no continúa', ['```', 'Enter', '- a', 'Enter', 'b'], '```\n- a\nb'],
  ['después de cerrar el bloque de código sí continúa', ['```', 'Enter', 'x', 'Enter', '```', 'Enter', '- a', 'Enter', 'b'], '```\nx\n```\n- a\n- b'],
];
for (const [nombre, pasos, esperado] of CASOS_LISTA) {
  await prueba(`Enter en el editor: ${nombre}`, async () => {
    await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
      await tecla(page, 'Alt+KeyN');
      for (const p of pasos) { if (/^(Enter|Shift\+Enter)$/.test(p)) await tecla(page, p); else await page.keyboard.type(p); }
      igual(await valor(page), esperado);
      const g = (await guardado(page)).activa;
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      igual((await notaGuardada(page, g)).texto, esperado, 'lo insertado también se guarda');
      igual(await textoDe(page.locator('#est-caracteres')), `${esperado.length.toLocaleString('es')} ${esperado.length === 1 ? 'carácter' : 'caracteres'}`, 'los contadores siguen al texto');
      limpio(reg);
    });
  });
}

await prueba('Enter con el cursor en medio de un elemento lo parte y el resto pasa al nuevo elemento con su marcador', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await tecla(page, 'Alt+KeyN');
    await page.keyboard.type('1. abcd');
    await tecla(page, 'ArrowLeft'); await tecla(page, 'ArrowLeft');
    await tecla(page, 'Enter');
    igual(await valor(page), '1. ab\n2. cd');
    igual((await seleccion(page)).ini, 9, 'el cursor queda justo después del nuevo marcador');
  });
});

await prueba('Enter con el cursor dentro del marcador o con texto seleccionado hace el salto de línea normal', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await tecla(page, 'Alt+KeyN');
    await page.keyboard.type('- a');
    await tecla(page, 'Home');
    await tecla(page, 'Enter');
    igual(await valor(page), '\n- a', 'al inicio de la línea: salto normal');
    await tecla(page, 'ArrowRight');
    await tecla(page, 'Enter');
    igual(await valor(page), '\n-\n a', 'entre el guion y el espacio: salto normal');
    await page.evaluate(() => { const e = document.querySelector('#editor'); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.keyboard.type('- uno dos');
    await page.evaluate(() => document.querySelector('#editor').setSelectionRange(2, 5));
    await tecla(page, 'Enter');
    igual(await valor(page), '- \n dos', 'con selección: reemplaza la selección por un salto, sin marcador');
  });
});

await prueba('la continuación de listas conserva el historial de deshacer del navegador (Ctrl+Z deshace y Ctrl+Mayús+Z rehace)', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await tecla(page, 'Alt+KeyN');
    await page.keyboard.type('- uno');
    await tecla(page, 'Enter');
    igual(await valor(page), '- uno\n- ');
    await tecla(page, 'Control+KeyZ');
    const tras = await valor(page);
    verdadero(tras !== '- uno\n- ' && '- uno\n- '.startsWith(tras), `Ctrl+Z debe deshacer lo insertado (quedó ${JSON.stringify(tras)})`);
    await tecla(page, 'Control+Shift+KeyZ');
    igual(await valor(page), '- uno\n- ', 'y rehacer lo devuelve');
    await tecla(page, 'Enter');                                        // termina la lista (elemento vacío)
    igual(await valor(page), '- uno\n');
    await tecla(page, 'Control+KeyZ');
    verdadero(await valor(page) !== '- uno\n', 'también se puede deshacer terminar la lista');
    const g = (await guardado(page)).activa;
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    igual((await notaGuardada(page, g)).texto, await valor(page), 'deshacer también se guarda');
  });
});

await prueba('Enter durante una composición IME o con Ctrl, Alt o Meta no continúa la lista', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await tecla(page, 'Alt+KeyN');
    await page.keyboard.type('- a');
    const r = await page.evaluate(() => {
      const e = document.querySelector('#editor'); const salida = [];
      for (const init of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
        const ev = new KeyboardEvent('keydown', Object.assign({ code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }, init));
        e.dispatchEvent(ev); salida.push(ev.defaultPrevented);
      }
      return { prevenidos: salida, valor: e.value };
    });
    igual(r.prevenidos, [false, false, false, false]);
    igual(r.valor, '- a');
  });
});

await prueba('Tab en el editor mueve el foco (no inserta tabulación): sin trampa de teclado', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    await tecla(page, 'Alt+KeyN');
    await page.keyboard.type('- a');
    await tecla(page, 'Tab');
    igual(await valor(page), '- a', 'no se inserta ninguna tabulación');
    verdadero(!(await enFoco(page, '#editor')), 'el foco sale del editor');
    await tecla(page, 'Shift+Tab');
    verdadero(await enFoco(page, '#editor'));
  });
});

// =====================================================================================
console.log('\n[ciclo completo con el teclado y accesibilidad]');

await prueba('ciclo completo solo con teclado (sin ningún evento de puntero): crear, escribir, listas, vista previa, buscar, navegar, eliminar, deshacer, ayuda y enfoque', async () => {
  const contar = () => {
    window.__puntero = 0;
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart']) window.addEventListener(t, () => { window.__puntero++; }, true);
    window.addEventListener('click', e => { if (e.detail > 0) window.__puntero++; }, true);   // detail 0 = activación por teclado
  };
  await con({ sembrar: SIEMBRA_AMBIENTE, init: { fn: contar } }, async (page, reg) => {
    // 1. Crear con el botón activado por teclado (salto, Nueva nota, Enter)
    await tecla(page, 'Tab');
    verdadero(await page.getByRole('link', { name: 'Saltar al contenido' }).evaluate(e => e === document.activeElement), 'primer Tab: enlace de salto');
    await tecla(page, 'Tab');
    igual(await idFoco(page), 'nueva');
    await tecla(page, 'Enter');
    verdadero(await enFoco(page, '#editor') && (await filas(page)).length === 5, 'paso 1: la nota nueva recibe el cursor');
    // 2. Escribir con listas que se continúan y terminan
    await page.keyboard.type('# Diario de la ceiba');
    await tecla(page, 'Enter'); await tecla(page, 'Enter');
    await page.keyboard.type('Notas de **campo**:');
    await tecla(page, 'Enter');
    await page.keyboard.type('- semilla');
    await tecla(page, 'Enter');
    await page.keyboard.type('brote');
    await tecla(page, 'Enter'); await tecla(page, 'Enter');
    await page.keyboard.type('Fin.');
    const esperado = '# Diario de la ceiba\n\nNotas de **campo**:\n- semilla\n- brote\nFin.';
    igual(await valor(page), esperado);
    const idNueva = await activaGuardada(page);
    // 3. Vista previa y de vuelta, con el cursor donde estaba
    await tecla(page, 'Alt+KeyP');
    igual(await textoDe(vista(page).locator('h1')), 'Diario de la ceiba');
    igual(await vista(page).locator('li').count(), 2);
    igual(await textoDe(vista(page).locator('strong')), 'campo');
    verdadero(await enFoco(page, '#vista'), 'paso 3: la vista previa recibe el foco');
    await tecla(page, 'Alt+KeyP');
    verdadero(await enFoco(page, '#editor') && (await seleccion(page)).ini === esperado.length, `paso 3: cursor al final, donde se dejó (${JSON.stringify(await seleccion(page))}, foco ${await idFoco(page)})`);
    // 4. Esc a la lista, buscar con Ctrl+K, Esc
    await tecla(page, 'Escape');
    verdadero(await enFoco(page, '#lista'), 'paso 4: Esc lleva a la lista');
    await tecla(page, 'Control+KeyK');
    await page.keyboard.type('semilla');
    igual(await textoDe(page.locator('#cuenta')), '1 resultado');
    igual(await titulos(page), ['Diario de la ceiba']);
    await tecla(page, 'Escape');
    igual(await busqueda(page).inputValue(), '');
    igual(await textoDe(page.locator('#cuenta')), '5 notas');
    verdadero(await enFoco(page, '#lista'), 'paso 4: Esc en la búsqueda lleva a la lista');
    // 5. Recorrer la lista
    await tecla(page, 'ArrowDown');
    igual(await activaGuardada(page), 'arbol');
    await tecla(page, 'End');
    igual(await activaGuardada(page), 'ideas');
    await tecla(page, 'Home');
    igual(await activaGuardada(page), idNueva);
    await tecla(page, 'ArrowRight');
    verdadero(await enFoco(page, '#editor'), 'paso 5: Flecha derecha pasa al editor');
    await tecla(page, 'Escape');
    // 6. Eliminar, deshacer, eliminar y dejar que venza
    await tecla(page, 'Alt+Backspace');
    igual((await guardado(page)).notas.length, 4);
    igual(await activaGuardada(page), 'arbol', 'queda seleccionada la vecina');
    await tecla(page, 'Alt+KeyZ');
    const restaurada = (await guardado(page)).notas.find(n => n.id === idNueva);
    igual(restaurada.texto, esperado);
    igual((await guardado(page)).notas.length, 5);
    igual(await activaGuardada(page), idNueva);
    await tecla(page, 'Alt+Backspace');
    await page.clock.fastForward(8100);
    igual(await avisosDeshacer(page).count(), 0, 'el aviso se retira a los 8 s');
    await tecla(page, 'Alt+KeyZ');
    igual((await guardado(page)).notas.length, 4, 'ya no hay nada que deshacer');
    // 7. Ayuda y modo enfoque
    await tecla(page, 'Shift+Slash');
    verdadero(await ayuda(page).isVisible() && await dentroDelDialogo(page), 'paso 7: el diálogo se abre con el foco dentro');
    await tecla(page, 'Tab'); await tecla(page, 'Tab'); await tecla(page, 'Tab');
    verdadero(await dentroDelDialogo(page), 'paso 7: Tab no sale del diálogo');
    await tecla(page, 'Escape');
    verdadero(!(await ayuda(page).isVisible()), 'paso 7: Esc cierra');
    await tecla(page, 'Alt+Backslash');
    verdadero(!(await page.locator('aside').isVisible()), 'paso 7: enfoque oculta la barra lateral');
    await tecla(page, 'Alt+Backslash');
    verdadero(await page.locator('aside').isVisible(), 'paso 7: y la devuelve');
    // 8. Nada de ratón y nada roto
    igual(await page.evaluate(() => window.__puntero), 0, 'no debe haberse usado ningún puntero');
    igual(reg.dialogos, []);
    limpio(reg);
  });
});

await prueba('el aviso de eliminación queda por encima de la barra de estado en 768 y 1440 px (también con la barra de estado a dos líneas) y dentro de la pantalla', async () => {
  for (const ancho of [768, 1024, 1440]) {
    await con({ ancho, alto: 900, reloj: T0, sembrar: SIEMBRA_ORIG }, async page => {
      await tecla(page, 'Alt+Backspace');
      const r = await page.evaluate(() => { const a = document.querySelector('#avisos .aviso').getBoundingClientRect(), e = document.querySelector('#estado').getBoundingClientRect(); return { avisoAba: a.bottom, estadoArr: e.top, izq: a.left, der: a.right, ancho: innerWidth }; });
      verdadero(r.avisoAba <= r.estadoArr, `a ${ancho} px el aviso tapa la barra de estado: ${JSON.stringify(r)}`);
      verdadero(r.izq >= 0 && r.der <= r.ancho, `a ${ancho} px el aviso se sale de la pantalla: ${JSON.stringify(r)}`);
    });
  }
});

await prueba('768 px: ciclo breve con teclado (crear, escribir, vista previa, eliminar, deshacer, ayuda y enfoque) sin desbordamientos ni controles tapados', async () => {
  await con({ ancho: 768, alto: 1024, reloj: T0, sembrar: SIEMBRA_ORIG }, async (page, reg) => {
    await tecla(page, 'Alt+KeyN');
    await page.keyboard.type('Nota a 768\n- uno\ndos');
    igual(await valor(page), 'Nota a 768\n- uno\n- dos');
    await tecla(page, 'Alt+KeyP');
    igual(await vista(page).locator('li').count(), 2);
    const cajas = await page.evaluate(() => ['#modo', '#eliminar', '#enfoque', '#atajos'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); return [s, b.width >= 44 && b.height >= 44 || s === '#atajos' && b.height >= 44, b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight]; }));
    for (const [s, tamano, dentro] of cajas) verdadero(tamano && dentro, `${s}: objetivo táctil de 44 px y dentro de la pantalla`);
    await tecla(page, 'Alt+Backspace');
    verdadero(await deshacerBtn(page).isVisible());
    await tecla(page, 'Alt+KeyZ');
    igual(await titulos(page), ['Nota a 768', 'Árbol de la ceiba', 'Receta de arepas', 'Lista de compras', 'Ideas']);
    await tecla(page, 'Escape');
    await tecla(page, 'Shift+Slash');
    verdadero(await ayuda(page).isVisible());
    await tecla(page, 'Escape');
    await tecla(page, 'Alt+Backslash');
    verdadero(!(await page.locator('aside').isVisible()) && await page.locator('#estado').isVisible());
    igual(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    limpio(reg);
  });
});

await prueba('controles nuevos: nombres accesibles, aria-pressed, aria-keyshortcuts, ids únicos y una sola región viva con aviso, vista y diálogo presentes', async () => {
  await con({ reloj: T0, sembrar: { [CLAVE]: datos([nota('m', MD_VARIADO, T0), nota('n', 'Otra', T0 - HORA)], 'm') } }, async page => {
    await tecla(page, 'Alt+KeyP');
    await tecla(page, 'Alt+Backspace');
    await tecla(page, 'Shift+Slash');
    igual(await page.locator('[aria-live]').count(), 1, 'una sola región aria-live');
    const ids = await page.locator('[id]').evaluateAll(l => l.map(e => e.id));
    igual(new Set(ids).size, ids.length, 'ids duplicados en el DOM');
    verdadero(await page.locator('#ayuda').evaluate(d => !!document.getElementById(d.getAttribute('aria-labelledby'))), 'el diálogo debe tener nombre por aria-labelledby');
    await tecla(page, 'Escape');
    const claves = await page.evaluate(() => ({
      modo: [document.querySelector('#modo').getAttribute('aria-keyshortcuts'), document.querySelector('#modo').getAttribute('aria-pressed')],
      eliminar: document.querySelector('#eliminar').getAttribute('aria-keyshortcuts'),
      enfoque: [document.querySelector('#enfoque').getAttribute('aria-keyshortcuts'), document.querySelector('#enfoque').getAttribute('aria-pressed')],
      deshacer: [...document.querySelectorAll('#avisos button')].map(b => b.getAttribute('aria-keyshortcuts')).filter(Boolean),
      svgSinOcultar: [...document.querySelectorAll('svg')].filter(s => !s.closest('[aria-hidden="true"]') && s.getAttribute('aria-hidden') !== 'true').length,
    }));
    igual(claves.modo, ['Alt+P', 'true']);
    igual(claves.eliminar, 'Alt+Backspace');
    igual(claves.enfoque, ['Alt+\\', 'false']);
    igual(claves.deshacer, ['Alt+Z']);
    igual(claves.svgSinOcultar, 0, 'los iconos decorativos son aria-hidden');
    const sinNombre = await page.locator('button, input, textarea, a[href], [role="listbox"], [tabindex="0"]').evaluateAll(l => l
      .filter(e => e.getClientRects().length)
      .filter(e => !(e.getAttribute('aria-label') || '').trim() && !(e.textContent || '').trim() && !(e.labels && e.labels.length) && !e.getAttribute('aria-labelledby'))
      .map(e => e.outerHTML.slice(0, 80)));
    igual(sinNombre, [], 'controles sin nombre accesible');
  });
});

await prueba('anillo de foco visible (box-shadow) en los controles nuevos al llegar con el teclado', async () => {
  await con({ reloj: T0, sembrar: { [CLAVE]: datos([nota('m', MD_VARIADO, T0), nota('n', 'Otra', T0 - HORA)], 'm') } }, async page => {
    const anillo = () => page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.id || a.textContent.trim().slice(0, 20), sombra: cs.boxShadow, contorno: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor }; });
    await tecla(page, 'Alt+Backspace');                                // al eliminar sin foco, este pasa a la lista
    verdadero(await enFoco(page, '#lista'), 'el foco no se pierde al eliminar');
    const paradas = [];
    for (let i = 0; i < 9; i++) {                                      // desde la lista: tema, respaldo, atajos, modo, eliminar, exportar-nota, editor, enfoque y Deshacer
      await tecla(page, 'Tab');
      const a = await anillo();
      paradas.push(a.id);
      const visible = (a.sombra && a.sombra !== 'none') || /solid [1-9]/.test(a.contorno);
      verdadero(visible, `sin anillo de foco en ${a.id}: ${JSON.stringify(a)}`);
    }
    igual(paradas, ['tema', 'respaldo', 'atajos', 'modo', 'eliminar', 'exportar-nota', 'editor', 'enfoque', 'Deshacer']);
    await tecla(page, 'Alt+KeyP');                                     // la vista previa es una parada más (tabindex 0)
    await vista(page).focus();
    const v = await anillo(); verdadero((v.sombra && v.sombra !== 'none') || /solid [1-9]/.test(v.contorno), `anillo en la vista previa: ${JSON.stringify(v)}`);
  });
});

await prueba('contraste real (WCAG AA) en vista previa, barra superior, aviso con Deshacer, diálogo de atajos y barra de estado, en tema claro y oscuro', async () => {
  for (const esquema of ['light', 'dark']) {
    await con({ esquema, reloj: T0, sembrar: { [CLAVE]: datos([nota('m', MD_VARIADO + '\n\n---\n\n~~tachado~~ y otro párrafo', T0), nota('n', 'Otra', T0 - HORA)], 'm') } }, async page => {
      await tecla(page, 'Alt+KeyP');
      const vistaSels = ['#vista h1', '#vista p', '#vista a', '#vista blockquote', '#vista p code', '#vista pre code', '#vista th', '#vista td', '#vista li', '#vista del', '#modo', '#eliminar', '#atajos', '#enfoque', '#est-guardado', '#est-palabras'];
      for (const [s, r] of await page.evaluate(medirContraste, vistaSels)) verdadero(r >= 4.5, `${esquema} vista previa ${s}: ${r.toFixed(2)}`);
      await tecla(page, 'Alt+Backspace');
      for (const [s, r] of await page.evaluate(medirContraste, ['.aviso__texto', '#avisos button'])) verdadero(r >= 4.5, `${esquema} aviso ${s}: ${r.toFixed(2)}`);
      await tecla(page, 'Shift+Slash');
      for (const [s, r] of await page.evaluate(medirContraste, ['#ayuda h2', '#ayuda h3', '#ayuda dt', '#ayuda kbd', '#ayuda .ayuda__nota', '#ayuda button'])) verdadero(r >= 4.5, `${esquema} diálogo ${s}: ${r.toFixed(2)}`);
    });
  }
});

await prueba('sin emojis ni recursos externos con la vista previa, el aviso y el diálogo abiertos; no hay desbordamiento horizontal en 360, 768 y 1440', async () => {
  for (const ancho of [360, 768, 1440]) {
    await con({ ancho, alto: ancho === 360 ? 740 : 900, sembrar: { [CLAVE]: datos([nota('m', MD_VARIADO + '\n\n' + 'x'.repeat(400) + '\n\n| ' + Array.from({ length: 14 }, (_, i) => 'columna' + i).join(' | ') + ' |\n|' + ' - |'.repeat(14) + '\n', T0), nota('n', 'Otra', T0 - HORA)], 'm') } }, async (page, reg) => {
      if (ancho === 360) await page.locator('#lista [data-id="m"]').click();
      const medir = () => page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, v: (() => { const v = document.querySelector('#vista'); return v && !v.hidden ? v.scrollWidth - v.clientWidth : 0; })() }));
      await tecla(page, 'Alt+KeyP');
      verdadero(await vista(page).isVisible(), 'la vista previa debe estar abierta');
      igual(await medir(), { doc: 0, v: 0 }, `vista previa a ${ancho} px`);
      await tecla(page, 'Alt+Backspace');
      verdadero(await deshacerBtn(page).isVisible(), 'el aviso con Deshacer debe estar presente');
      igual(await medir(), { doc: 0, v: 0 }, `con el aviso a ${ancho} px`);
      await tecla(page, 'Shift+Slash');
      verdadero(await ayuda(page).isVisible(), 'el diálogo debe estar abierto');
      igual(await medir(), { doc: 0, v: 0 }, `con el diálogo a ${ancho} px`);
      const t = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML);
      verdadero(!EMOJI.test(t), 'hay emojis o selectores de variación');
      const externas = reg.peticiones.filter(u => !u.startsWith(srv.url + '/app.html'));
      igual(externas, [], 'peticiones inesperadas');
      limpio(reg);
    });
  }
});

await prueba('en la vista previa las tablas y bloques de código que desbordan se pueden desplazar con el teclado (regiones enfocables con nombre)', async () => {
  const ancha = '| ' + Array.from({ length: 16 }, (_, i) => 'columna número ' + i).join(' | ') + ' |\n|' + ' - |'.repeat(16) + '\n| ' + Array.from({ length: 16 }, (_, i) => i).join(' | ') + ' |';
  const codigo = '```\n' + 'una línea de código muy larga que no cabe en el ancho de la columna '.repeat(6) + '\n```';
  await con({ ancho: 768, sembrar: { [CLAVE]: datos([nota('t', ancha + '\n\n' + codigo + '\n\n```\ncorto\n```', T0)], 't') } }, async page => {
    await tecla(page, 'Alt+KeyP');
    const r = await page.evaluate(() => [...document.querySelectorAll('#vista .tabla, #vista pre')].map(e => ({ tag: e.tagName, desborda: e.scrollWidth > e.clientWidth, tabindex: e.getAttribute('tabindex'), nombre: e.getAttribute('aria-label') || '' })));
    igual(r.length, 3);
    for (const x of r) {
      if (x.desborda) verdadero(x.tabindex === '0' && x.nombre.length > 0, `la región que desborda debe ser enfocable y tener nombre: ${JSON.stringify(x)}`);
      else igual(x.tabindex, null, 'lo que no desborda no suma paradas de Tab');
    }
    verdadero(r.some(x => x.desborda), 'la prueba debe tener al menos una región que desborde');
  });
});

// =====================================================================================
// TASK 5: tema, plan de demostración, copia de seguridad, exportar nota, almacenamiento,
// evento storage y vista móvil.
//
// Contrato añadido en la Task 5:
//   Pie de la barra lateral: #tema (botón "Tema: sistema|claro|oscuro" que rota), #respaldo (botón con nombre
//   "Copia de seguridad"), #atajos, y #plan (texto "Plan Brote, anual · demostración", solo si hay plan válido).
//   Barra superior: #exportar-nota (botón "Exportar nota"), después de #eliminar.
//   Diálogo #respaldo-dialogo (nombre "Copia de seguridad"): botones "Exportar todo" (#exportar-todo) e
//   "Importar copia" (#importar, abre el selector de archivos; input[type=file]#archivo-importar), "Cerrar"
//   (#cerrar-respaldo) y #respaldo-error (tabindex -1, recibe el foco con el mensaje de error de una importación fallida).
//   Exportar todo: ceiba-notas-AAAA-MM-DD.json { version: 1, ..., notas: [...] }. Exportar nota: <título saneado>.md.
//   Informe de importación: aviso "Importación lista: n añadidas, n actualizadas, n omitidas."
//   Aviso por el evento storage: texto con "otra pestaña" y botón "Recargar".
//   Prefs: ceiba:prefs:v1 { tema: 'claro'|'oscuro'|'sistema', plan, ciclo, foco, ...lo demás se conserva }.
//   Teclado virtual: window.visualViewport -> variables --vv-alto y --vv-arriba en :root y .app a la altura visible.
// =====================================================================================
const temaBtn = page => page.locator('#tema');
const respaldoBtn = page => page.locator('#respaldo');
const respaldoDlg = page => page.getByRole('dialog', { name: 'Copia de seguridad' });
const exportarTodoBtn = page => page.getByRole('button', { name: 'Exportar todo', exact: true });
const importarBtn = page => page.getByRole('button', { name: 'Importar copia', exact: true });
const exportarNotaBtn = page => page.getByRole('button', { name: 'Exportar nota', exact: true });
const avisoDe = (page, texto) => page.locator('#avisos .aviso', { hasText: texto });
const prefsGuardadas = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), PREFS);
const dataTheme = page => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const fondoPagina = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const CLARO = 'rgb(251, 246, 234)', OSCURO = 'rgb(27, 25, 21)';

/**
 * Espía de descargas: anota el nombre pedido con <a download> y guarda el Blob. Este Chromium sin ventana informa
 * suggestedFilename() = "download" cuando el nombre tiene letras fuera de ASCII (también con Content-Disposition), así que
 * el nombre que la app pidió se lee del enlace; el archivo que el navegador realmente descarga se compara byte a byte.
 */
const espiarDescargas = () => {
  if (window.__descargas) return;
  window.__descargas = [];
  const blobs = new Map();
  const crear = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { const u = crear(b); blobs.set(u, b); return u; };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) window.__descargas.push({ nombre: this.getAttribute('download'), blob: blobs.get(this.href) });
    return click.apply(this, arguments);
  };
};
/** Ejecuta `accion` (que provoca una descarga) y devuelve { nombre, bytes } tras comprobar que el navegador descargó lo mismo. */
async function descargar(page, accion) {
  await page.evaluate(espiarDescargas);
  const n0 = await page.evaluate(() => window.__descargas.length);
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), accion()]);
  const real = fs.readFileSync(await d.path());
  const pedido = await page.evaluate(async n => { const x = window.__descargas[n]; return x ? { nombre: x.nombre, bytes: Array.from(new Uint8Array(await x.blob.arrayBuffer())) } : null; }, n0);
  verdadero(pedido !== null, 'la app no pidió ninguna descarga con <a download>');
  const bytes = Buffer.from(pedido.bytes);
  verdadero(bytes.equals(real), 'el archivo que descargó el navegador no coincide con el Blob que preparó la app');
  if (/^[\x20-\x7e]+$/.test(pedido.nombre)) igual(d.suggestedFilename(), pedido.nombre, 'el navegador debe respetar el nombre pedido');
  return { nombre: pedido.nombre, bytes };
}
/** Pulsa "Importar copia" y entrega el archivo en el selector real del navegador. */
async function importarArchivo(page, archivo) {
  const [selector] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), importarBtn(page).click()]);
  await selector.setFiles(archivo);
}
const archivoJson = (contenido, name = 'copia.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof contenido === 'string' ? contenido : JSON.stringify(contenido), 'utf8') });
const abrirRespaldo = async page => { await respaldoBtn(page).click(); verdadero(await respaldoDlg(page).isVisible(), 'el diálogo de copia de seguridad debe abrirse'); };
const bloquearStorage = () => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Acceso denegado', 'SecurityError'); } });
const cuotaLlena = () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (window.__llena) throw new DOMException('cuota', 'QuotaExceededError'); return original.call(this, k, v); };
};
const cuotaLlenaDesdeElInicio = () => {
  const original = Storage.prototype.setItem;
  window.__llena = true;
  Storage.prototype.setItem = function (k, v) { if (window.__llena) throw new DOMException('cuota', 'QuotaExceededError'); return original.call(this, k, v); };
};

// ------------------------------------------------------------------ tema
console.log('\n[tema claro, oscuro y sistema]');

await prueba('tema: el botón rota sistema, claro y oscuro (la primera pulsación siempre se nota), aplica el tema, lo anuncia, lo persiste conservando las demás preferencias y sobrevive a la recarga', async () => {
  const previas = JSON.stringify({ plan: 'brote', ciclo: 'anual', otra: 7 });
  // Sistema claro: sistema -> oscuro -> claro -> sistema
  await con({ esquema: 'light', sembrar: { [PREFS]: previas } }, async (page, reg) => {
    verdadero(await temaBtn(page).isVisible(), 'falta el botón de tema en el pie de la barra lateral');
    igual(await textoDe(temaBtn(page)), 'Tema: sistema');
    igual(await dataTheme(page), null);
    await temaBtn(page).click();
    igual([await dataTheme(page), await textoDe(temaBtn(page)), await fondoPagina(page)], ['dark', 'Tema: oscuro', OSCURO]);
    verdadero(/oscuro/i.test(await vivo(page)), 'el cambio debe anunciarse en la región viva');
    igual(await prefsGuardadas(page), { plan: 'brote', ciclo: 'anual', otra: 7, tema: 'oscuro' });
    await page.reload();
    igual([await dataTheme(page), await textoDe(temaBtn(page)), await fondoPagina(page)], ['dark', 'Tema: oscuro', OSCURO], 'el tema oscuro debe sobrevivir a la recarga');
    await temaBtn(page).click();
    igual([await dataTheme(page), await textoDe(temaBtn(page)), await fondoPagina(page)], ['light', 'Tema: claro', CLARO]);
    igual((await prefsGuardadas(page)).tema, 'claro');
    await temaBtn(page).click();
    igual([await dataTheme(page), await textoDe(temaBtn(page)), await fondoPagina(page)], [null, 'Tema: sistema', CLARO], 'sistema quita el tema explícito y sigue al sistema (claro)');
    igual(await prefsGuardadas(page), { plan: 'brote', ciclo: 'anual', otra: 7, tema: 'sistema' });
    limpio(reg);
  });
  // Sistema oscuro: sistema -> claro -> oscuro -> sistema
  await con({ esquema: 'dark' }, async (page, reg) => {
    igual([await textoDe(temaBtn(page)), await fondoPagina(page)], ['Tema: sistema', OSCURO]);
    await temaBtn(page).click();
    igual([await dataTheme(page), await textoDe(temaBtn(page)), await fondoPagina(page)], ['light', 'Tema: claro', CLARO]);
    await temaBtn(page).click();
    igual([await dataTheme(page), await textoDe(temaBtn(page)), await fondoPagina(page)], ['dark', 'Tema: oscuro', OSCURO]);
    await temaBtn(page).click();
    igual([await dataTheme(page), await textoDe(temaBtn(page)), await fondoPagina(page)], [null, 'Tema: sistema', OSCURO]);
    limpio(reg);
  });
});

await prueba('tema: lee lo que dejó la landing (claro, oscuro, sistema, valores antiguos o inválidos) y el botón lo refleja', async () => {
  for (const [guardado_, esquema, etiqueta, attr, fondo] of [
    ['claro', 'dark', 'Tema: claro', 'light', CLARO],
    ['oscuro', 'light', 'Tema: oscuro', 'dark', OSCURO],
    ['sistema', 'dark', 'Tema: sistema', null, OSCURO],
    ['sistema', 'light', 'Tema: sistema', null, CLARO],
    ['dark', 'light', 'Tema: oscuro', 'dark', OSCURO],
    ['light', 'dark', 'Tema: claro', 'light', CLARO],
    ['rojo', 'dark', 'Tema: sistema', null, OSCURO],
    [42, 'light', 'Tema: sistema', null, CLARO],
  ]) {
    await con({ esquema, sembrar: { [PREFS]: JSON.stringify({ tema: guardado_ }) } }, async (page, reg) => {
      igual([await textoDe(temaBtn(page)), await dataTheme(page), await fondoPagina(page)], [etiqueta, attr, fondo], `tema guardado ${JSON.stringify(guardado_)} con sistema ${esquema}`);
      limpio(reg);
    });
  }
  await con({ esquema: 'light', sembrar: { [PREFS]: '{roto' } }, async (page, reg) => {
    igual(await textoDe(temaBtn(page)), 'Tema: sistema');
    await temaBtn(page).click();
    igual(await dataTheme(page), 'dark');
    limpio(reg);
  });
});

await prueba('tema: sin almacenamiento el cambio vale para la sesión y no produce errores', async () => {
  await con({ esquema: 'light', init: { fn: bloquearStorage } }, async (page, reg) => {
    await temaBtn(page).click();
    igual([await dataTheme(page), await fondoPagina(page)], ['dark', OSCURO]);
    await temaBtn(page).click();
    igual(await dataTheme(page), 'light');
    igual(reg.errores, []);
  });
});

await prueba('tema: cambiar el tema en otra pestaña (la landing) lo actualiza en la aplicación abierta', async () => {
  await con({ esquema: 'light' }, async (page, reg, ctx) => {
    const otra = await ctx.newPage();
    await otra.goto(srv.url + '/index.html');
    await otra.locator('#tema').click();                              // la landing guarda tema: oscuro en ceiba:prefs:v1
    await esperar(async () => (await dataTheme(page)) === 'dark', 'la aplicación debe pasar a oscuro');
    igual(await textoDe(temaBtn(page)), 'Tema: oscuro');
    igual(await fondoPagina(page), OSCURO);
    limpio(reg);
  });
});

// ------------------------------------------------------------------ plan de demostración
console.log('\n[plan de demostración]');

await prueba('?plan=&ciclo= válidos: se guardan en prefs, la URL se limpia sin recargar y el pie muestra "Plan X, ciclo · demostración" sin cobro', async () => {
  for (const [plan, nombre] of [['semilla', 'Semilla'], ['brote', 'Brote'], ['bosque', 'Bosque']]) {
    for (const ciclo of ['mensual', 'anual']) {
      await con({ consulta: `?plan=${plan}&ciclo=${ciclo}` }, async (page, reg) => {
        const t = await textoDe(page.locator('#plan'));
        verdadero(t.includes(`Plan ${nombre}, ${ciclo} · demostración`), `indicador inesperado: "${t}"`);
        verdadero(/sin cobro/i.test(t), `el indicador debe decir que no hay cobro: "${t}"`);
        igual(await prefsGuardadas(page), { plan, ciclo });
        igual(page.url(), srv.url + '/app.html', 'la URL debe quedar limpia');
        igual(reg.peticiones.filter(u => u.startsWith(PAGINA)).length, 1, 'limpiar la URL no debe recargar la página');
        verdadero(await page.locator('aside #plan').isVisible(), 'el indicador va en la barra lateral');
        await page.reload();
        verdadero((await textoDe(page.locator('#plan'))).includes(`Plan ${nombre}, ${ciclo} · demostración`), 'el plan guardado se muestra en las visitas siguientes');
        limpio(reg);
      });
    }
  }
});

await prueba('?plan=&ciclo=: conserva el resto de la consulta y el fragmento, y las demás preferencias', async () => {
  await con({ consulta: '?x=1&plan=bosque&ciclo=mensual&y=dos#algo', sembrar: { [PREFS]: JSON.stringify({ tema: 'claro', foco: false }) } }, async (page, reg) => {
    igual(page.url(), srv.url + '/app.html?x=1&y=dos#algo');
    igual(await prefsGuardadas(page), { tema: 'claro', foco: false, plan: 'bosque', ciclo: 'mensual' });
    limpio(reg);
  });
});

await prueba('?plan=&ciclo= no válidos o incompletos se ignoran: nada se guarda, la URL no cambia, no hay indicador ni errores ni ejecución de código', async () => {
  const casos = [
    '?plan=platino&ciclo=anual', '?plan=brote&ciclo=quincenal', '?plan=brote', '?ciclo=anual', '?plan=&ciclo=',
    '?plan=BROTE&ciclo=anual', '?plan=brote&ciclo=Anual', '?plan=brote%20&ciclo=anual', '?plan=brote&plan=semilla&ciclo=anual',
    '?plan=brote&ciclo=anual&ciclo=mensual', '?plan=__proto__&ciclo=constructor', '?plan=toString&ciclo=hasOwnProperty',
    '?plan=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&ciclo=anual', '?plan=brote&ciclo=anual%00',
  ];
  for (const c of casos) {
    await con({ consulta: c }, async (page, reg) => {
      igual(await page.locator('#plan').isVisible(), false, `no debe haber indicador con ${c}`);
      igual(await page.evaluate(k => localStorage.getItem(k), PREFS), null, `no se guardan preferencias con ${c}`);
      igual(page.url(), srv.url + '/app.html' + c, `la URL no debe cambiar con ${c}`);
      igual(reg.dialogos, []);
      limpio(reg);
    });
  }
  // Con un plan válido ya guardado, una URL inválida lo deja como estaba.
  await con({ consulta: '?plan=platino&ciclo=anual', sembrar: { [PREFS]: JSON.stringify({ plan: 'semilla', ciclo: 'mensual' }) } }, async page => {
    verdadero((await textoDe(page.locator('#plan'))).includes('Plan Semilla, mensual · demostración'));
    igual(await prefsGuardadas(page), { plan: 'semilla', ciclo: 'mensual' });
  });
});

await prueba('un plan guardado con valores inválidos no muestra indicador y el plan nuevo de la URL lo reemplaza', async () => {
  await con({ sembrar: { [PREFS]: JSON.stringify({ plan: 'oro', ciclo: 'anual' }) } }, async page => {
    igual(await page.locator('#plan').isVisible(), false);
  });
  await con({ consulta: '?plan=brote&ciclo=anual', sembrar: { [PREFS]: JSON.stringify({ plan: 'semilla', ciclo: 'mensual' }) } }, async page => {
    verdadero((await textoDe(page.locator('#plan'))).includes('Plan Brote, anual'));
    igual(await prefsGuardadas(page), { plan: 'brote', ciclo: 'anual' });
  });
});

await prueba('el plan de demostración no restringe nada: con plan Semilla se puede exportar todo, importar, cambiar de tema y tener decenas de notas', async () => {
  await con({ consulta: '?plan=semilla&ciclo=mensual', sembrar: { [CLAVE]: datos(Array.from({ length: 60 }, (_, i) => nota('n' + i, 'Nota ' + i, T0 - i * MIN)), 'n0') } }, async (page, reg) => {
    verdadero(await exportarNotaBtn(page).isEnabled() && await temaBtn(page).isEnabled() && await respaldoBtn(page).isEnabled());
    igual((await filas(page)).length, 60);
    await nueva(page).click();
    igual((await filas(page)).length, 61);
    limpio(reg);
  });
});

await prueba('con el almacenamiento bloqueado el plan de la URL se muestra igual durante la sesión y la URL se limpia', async () => {
  await con({ consulta: '?plan=bosque&ciclo=anual', init: { fn: bloquearStorage } }, async (page, reg) => {
    verdadero((await textoDe(page.locator('#plan'))).includes('Plan Bosque, anual · demostración'));
    igual(page.url(), srv.url + '/app.html');
    igual(reg.errores, []);
  });
});

// ------------------------------------------------------------------ exportar una nota
console.log('\n[exportar nota a .md]');

await prueba('Exportar nota descarga <título saneado>.md en UTF-8 con el texto exacto y sin tocar la fecha de edición', async () => {
  const texto = 'Título: ¿Qué/hay? *hoy*\nCuerpo con ñ, tildes áéíóú y «comillas».\n\n    sangría de cuatro\nfin';
  await con({ reloj: T0, sembrar: { [CLAVE]: datos([nota('x', texto, T0 - HORA), nota('y', 'Otra', T0 - 2 * HORA)], 'x') } }, async (page, reg) => {
    const antes = await guardado(page);
    const d = await descargar(page, () => exportarNotaBtn(page).click());
    igual(d.nombre, 'Título ¿Qué hay hoy.md');
    igual(d.bytes.toString('utf8'), texto, 'el contenido debe ser idéntico, en UTF-8');
    verdadero(!(d.bytes[0] === 0xEF && d.bytes[1] === 0xBB), 'sin marca BOM');
    igual(Buffer.byteLength(texto, 'utf8'), d.bytes.length, 'longitud exacta en bytes');
    igual(await guardado(page), antes, 'exportar no cambia nada de lo guardado (ni la fecha de edición)');
    verdadero((await avisoDe(page, 'Título ¿Qué hay hoy.md').count()) === 1, 'debe confirmarse la descarga');
    limpio(reg);
  });
});

await prueba('Exportar nota: nota vacía -> "Sin título.md"; nombres reservados, títulos de 5.000 caracteres y desde la vista previa', async () => {
  await con({ sembrar: { [CLAVE]: datos([nota('v', '', T0), nota('c', 'CON\ncontenido', T0 - MIN), nota('l', 'L'.repeat(5000) + '\nfin', T0 - 2 * MIN), nota('m', '# Diario\n\nhola **mundo**', T0 - 3 * MIN)], 'v') } }, async (page, reg) => {
    igual((await descargar(page, () => exportarNotaBtn(page).click())).nombre, 'Sin título.md');
    await page.locator('#lista [data-id="c"]').click();
    igual((await descargar(page, () => exportarNotaBtn(page).click())).nombre, 'nota-CON.md');
    await page.locator('#lista [data-id="l"]').click();
    const largo = await descargar(page, () => exportarNotaBtn(page).click());
    verdadero(largo.nombre.length <= 84 && largo.nombre.endsWith('.md'), `nombre demasiado largo: ${largo.nombre.length}`);
    await page.locator('#lista [data-id="m"]').click();
    await tecla(page, 'Alt+KeyP');
    const v = await descargar(page, () => exportarNotaBtn(page).click());
    igual([v.nombre, v.bytes.toString('utf8')], ['Diario.md', '# Diario\n\nhola **mundo**'], 'en vista previa se exporta el markdown, no el HTML');
    limpio(reg);
  });
});

await prueba('Exportar nota solo existe con una nota abierta y es parada de Tab con nombre accesible', async () => {
  await con({ sembrar: { [CLAVE]: datos([], null) } }, async page => {
    igual(await exportarNotaBtn(page).count() === 0 || !(await exportarNotaBtn(page).isVisible()), true, 'sin notas no hay nada que exportar');
  });
  await con({ sembrar: SIEMBRA_AMBIENTE }, async page => {
    verdadero(await exportarNotaBtn(page).isVisible());
    igual(await page.locator('#exportar-nota').evaluate(b => b.tagName), 'BUTTON');
  });
});

// ------------------------------------------------------------------ copia de seguridad: exportar todo
console.log('\n[copia de seguridad: exportar todo]');

await prueba('"Copia de seguridad" abre un diálogo modal con nombre, foco dentro, Tab/Shift+Tab no escapan, Esc cierra y devuelve el foco', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
    await page.locator('#respaldo').focus();
    await tecla(page, 'Enter');
    verdadero(await respaldoDlg(page).isVisible(), 'Enter debe abrir el diálogo');
    igual(await page.locator('#respaldo-dialogo').getAttribute('aria-modal'), 'true');
    verdadero(await page.locator('#respaldo-dialogo').evaluate(d => !!document.getElementById(d.getAttribute('aria-labelledby'))), 'nombre por aria-labelledby');
    const dentro = () => page.evaluate(() => { const d = document.querySelector('#respaldo-dialogo'); return d.open && d.contains(document.activeElement); });
    verdadero(await dentro(), 'el foco debe estar dentro');
    for (let i = 0; i < 8; i++) { await tecla(page, 'Tab'); verdadero(await dentro(), `Tab ${i + 1} escapó`); }
    for (let i = 0; i < 8; i++) { await tecla(page, 'Shift+Tab'); verdadero(await dentro(), `Shift+Tab ${i + 1} escapó`); }
    await tecla(page, 'Shift+Slash');
    igual(await page.locator('dialog[open]').count(), 1, 'con un diálogo abierto no se abre otro');
    await tecla(page, 'Escape');
    verdadero(!(await respaldoDlg(page).isVisible()), 'Esc cierra');
    verdadero(await enFoco(page, '#respaldo'), 'el foco vuelve al botón que abrió el diálogo');
    // con el ratón: el botón Cerrar y el fondo
    await respaldoBtn(page).click();
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    verdadero(!(await respaldoDlg(page).isVisible()) && await enFoco(page, '#respaldo'));
    igual(await page.locator('[aria-live]').count(), 1, 'sigue habiendo una sola región viva');
    const ids = await page.locator('[id]').evaluateAll(l => l.map(e => e.id));
    igual(new Set(ids).size, ids.length, 'ids duplicados');
    limpio(reg);
  });
});

await prueba('Exportar todo descarga ceiba-notas-AAAA-MM-DD.json con todas las notas, importable de vuelta con la misma validación; la CSP no lo bloquea', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
    await abrirRespaldo(page);
    const d = await descargar(page, () => exportarTodoBtn(page).click());
    igual(d.nombre, 'ceiba-notas-2026-10-16.json');
    verdadero(d.bytes.includes(Buffer.from('Árbol de la ceiba', 'utf8')), 'UTF-8 sin escapar los acentos');
    const json = JSON.parse(d.bytes.toString('utf8'));
    igual(json.version, 1);
    const porId = l => l.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    igual(porId(json.notas), porId((await guardado(page)).notas), 'lo exportado es exactamente lo guardado');
    igual(json.notas.length, 4);
    const v = await page.evaluate(j => window.Ceiba.validarImportacion(j), json);
    igual(v, { notas: json.notas, omitidas: 0 }, 'el archivo pasa la validación estricta de importación');
    verdadero(!(await respaldoDlg(page).isVisible()), 'el diálogo se cierra tras exportar');
    const aviso = await textoDe(avisoDe(page, 'ceiba-notas-2026-10-16.json').first());
    verdadero(aviso.includes('4 notas'), `el aviso debe decir cuántas notas: ${aviso}`);
    verdadero((await vivo(page)).includes('ceiba-notas-2026-10-16.json'), 'y anunciarse');
    verdadero(await enFoco(page, '#respaldo'), 'el foco vuelve al botón');
    limpio(reg);
  });
});

await prueba('Exportar todo incluye lo escrito hace un instante (aún sin guardar por la pausa de 300 ms)', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
    await escribir(page, ' ÚLTIMO-CAMBIO');
    await abrirRespaldo(page);
    const d = await descargar(page, () => exportarTodoBtn(page).click());
    verdadero(JSON.parse(d.bytes.toString('utf8')).notas.some(n => n.texto.endsWith(' ÚLTIMO-CAMBIO')), 'debe incluir el cambio reciente');
    limpio(reg);
  });
});

await prueba('Exportar todo sin notas avisa y no descarga nada', async () => {
  await con({ sembrar: { [CLAVE]: datos([], null) } }, async (page, reg) => {
    await abrirRespaldo(page);
    let descargo = false;
    page.once('download', () => { descargo = true; });
    await exportarTodoBtn(page).click();
    await page.waitForTimeout(400);
    igual(descargo, false, 'no debe haber descarga');
    verdadero((await avisoDe(page, 'No hay notas').count()) === 1, 'debe explicar que no hay notas');
    limpio(reg);
  });
});

await prueba('con el almacenamiento bloqueado Exportar todo sigue funcionando con lo que hay en memoria y el aviso de "no se están guardando" ofrece la copia de seguridad', async () => {
  await con({ init: { fn: bloquearStorage } }, async (page, reg) => {
    await nueva(page).click();
    await page.keyboard.type('Solo en memoria');
    const aviso = avisoDe(page, 'Los cambios no se están guardando');
    verdadero(await aviso.getByRole('button', { name: 'Copia de seguridad' }).isVisible(), 'el aviso debe ofrecer la copia de seguridad');
    await aviso.getByRole('button', { name: 'Copia de seguridad' }).click();
    verdadero(await respaldoDlg(page).isVisible());
    const d = await descargar(page, () => exportarTodoBtn(page).click());
    const json = JSON.parse(d.bytes.toString('utf8'));
    igual(json.notas.map(n => n.texto.split('\n')[0]).sort(), ['# Bienvenida a Ceiba', 'Solo en memoria']);
    igual(reg.errores, []);
  });
});

// ------------------------------------------------------------------ copia de seguridad: importar
console.log('\n[copia de seguridad: importar]');

const LOCALES = [
  nota('a', 'Local A\ntexto a', T0 - 1 * HORA),
  nota('b', 'Local B\ntexto b viejo', T0 - 2 * HORA),
  nota('c', 'Local C\ntexto c reciente', T0 - 3 * HORA),
];
const SIEMBRA_LOCALES = { [CLAVE]: datos(LOCALES, 'a') };

await prueba('Importar una copia válida: añade, actualiza (gana la edición más reciente) y omite; informa de las tres cifras; persiste y refresca la lista', async () => {
  const entrante = { version: 1, notas: [
    nota('b', 'Local B\ntexto b NUEVO desde el archivo', T0 - 10 * MIN, T0 - 5 * DIA),          // más reciente: actualiza
    nota('c', 'Local C\ntexto c del archivo, más viejo', T0 - 9 * HORA),                          // más antigua: se omite
    nota('d', 'Nota D\nllegó del archivo', T0 - 30 * MIN),                                        // nueva: se añade
    { id: 'e', texto: 7, creada: 1, editada: 1 },                                                 // inválida: se omite
    nota('d', 'Nota D\nrepetida y más vieja', T0 - 2 * DIA),                                      // id repetido: se omite
  ] };
  await con({ reloj: T0, sembrar: SIEMBRA_LOCALES }, async (page, reg) => {
    await abrirRespaldo(page);
    await importarArchivo(page, archivoJson(entrante));
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'debe aparecer el informe');
    const informe = await textoDe(avisoDe(page, 'Importación lista').first());
    verdadero(/1 añadida\b/.test(informe) && /1 actualizada\b/.test(informe) && /3 omitidas\b/.test(informe), `informe inesperado: ${informe}`);
    verdadero((await vivo(page)).includes('Importación lista'), 'el informe debe anunciarse');
    verdadero(!(await respaldoDlg(page).isVisible()), 'el diálogo se cierra al terminar bien');
    verdadero(await enFoco(page, '#respaldo'), 'el foco vuelve al botón de copia de seguridad');
    igual(await titulos(page), ['Local B', 'Nota D', 'Local A', 'Local C'], 'la lista queda por edición más reciente');
    const g = await guardado(page);
    const por = id => g.notas.find(n => n.id === id);
    igual(por('b'), nota('b', 'Local B\ntexto b NUEVO desde el archivo', T0 - 10 * MIN, T0 - 5 * DIA), 'b se reemplaza entera por la versión más reciente');
    igual(por('c'), LOCALES[2], 'c queda intacta');
    igual(por('d'), nota('d', 'Nota D\nllegó del archivo', T0 - 30 * MIN));
    igual(g.notas.length, 4);
    igual(g.activa, 'a', 'la nota activa no cambia');
    igual(await textoDe(page.locator('#est-guardado')), 'Guardado');
    limpio(reg);
  });
});

await prueba('Importar sobre un cuaderno vacío activa la nota más reciente; importar una copia que reemplaza la nota abierta actualiza el editor', async () => {
  await con({ reloj: T0, sembrar: { [CLAVE]: datos([], null) } }, async (page, reg) => {
    await abrirRespaldo(page);
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('p', 'Primera\nvieja', T0 - DIA), nota('q', 'Segunda\nreciente', T0 - HORA)] }));
    await esperar(async () => (await filas(page)).length === 2, 'deben aparecer las notas importadas');
    igual((await filas(page)).find(f => f.seleccionada).titulo, 'Segunda', 'queda activa la más reciente');
    igual(await editor(page).inputValue(), 'Segunda\nreciente');
    await abrirRespaldo(page);
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('q', 'Segunda\neditada en otra parte', T0 - MIN)] }));
    await esperar(async () => (await editor(page).inputValue()).includes('editada en otra parte'), 'el editor debe mostrar la versión importada');
    limpio(reg);
  });
});

await prueba('Importar un archivo inválido muestra un error comprensible dentro del diálogo, no cambia nada y deja reintentar', async () => {
  const filasMuchas = Array.from({ length: 5001 }, (_, i) => nota('n' + i, 'x', T0));
  const casos = [
    ['JSON roto', archivoJson('{"version":1,"notas":[{"id":"a"'), /JSON/, 'no es un JSON válido'],
    ['archivo vacío', archivoJson(''), /vacío/, 'está vacío'],
    ['una página web', archivoJson('<!doctype html><html><body>hola</body></html>', 'copia.json'), /JSON/, 'no es un JSON válido'],
    ['objeto de otra forma', archivoJson({ foo: 'bar' }), /no es una copia de seguridad de Ceiba/, 'no es una copia'],
    ['un arreglo', archivoJson([1, 2, 3]), /no es una copia de seguridad de Ceiba/, 'no es una copia'],
    ['versión futura', archivoJson({ version: 2, notas: [] }), /versión más nueva/, 'versión más nueva'],
    ['notas que no es un arreglo', archivoJson({ version: 1, notas: 'x' }), /no es una copia de seguridad de Ceiba/, 'no es una copia'],
    ['5.001 notas', archivoJson({ version: 1, notas: filasMuchas }), /5\.000/, 'más de 5.000'],
    ['más de 5 MB', { name: 'enorme.json', mimeType: 'application/json', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 32) }, /5 MB/, 'supera los 5 MB'],
  ];
  await con({ reloj: T0, sembrar: SIEMBRA_LOCALES }, async (page, reg) => {
    const antes = await page.evaluate(k => localStorage.getItem(k), CLAVE);
    await abrirRespaldo(page);
    for (const [nombre, archivo, patron] of casos) {
      await importarArchivo(page, archivo);
      const err = page.locator('#respaldo-error');
      await esperar(() => err.isVisible(), `${nombre}: debe verse el error`);
      const t = await textoDe(err);
      verdadero(patron.test(t), `${nombre}: mensaje inesperado "${t}"`);
      verdadero(/importar/i.test(t), `${nombre}: el mensaje debe decir que no se importó: "${t}"`);
      verdadero(await respaldoDlg(page).isVisible(), `${nombre}: el diálogo sigue abierto`);
      verdadero(await enFoco(page, '#respaldo-error'), `${nombre}: el foco pasa al error para que se lea`);
      igual(await page.evaluate(k => localStorage.getItem(k), CLAVE), antes, `${nombre}: no debe cambiar lo guardado`);
      igual(await titulos(page), ['Local A', 'Local B', 'Local C'], `${nombre}: la lista no cambia`);
      igual(await avisoDe(page, 'Importación lista').count(), 0, `${nombre}: sin informe de éxito`);
    }
    // Tras tantos errores, un archivo válido se importa bien y el error desaparece.
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('z', 'Zeta\ncorrecta', T0)] }));
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'el archivo válido debe importarse');
    verdadero(/1 añadida/.test(await textoDe(avisoDe(page, 'Importación lista').first())));
    await abrirRespaldo(page);
    verdadero(!(await page.locator('#respaldo-error').isVisible()), 'el error anterior no debe reaparecer al reabrir el diálogo');
    limpio(reg);
  });
});

await prueba('Importar acepta un archivo de exactamente 5 MB y rechaza 5 MB más un byte', async () => {
  const base = JSON.stringify({ version: 1, notas: [nota('t', 'Tamaño justo', T0)] });
  const justo = Buffer.concat([Buffer.from(base, 'utf8'), Buffer.alloc(5 * 1024 * 1024 - Buffer.byteLength(base, 'utf8'), 32)]);
  igual(justo.length, 5 * 1024 * 1024);
  await con({ reloj: T0, sembrar: SIEMBRA_LOCALES }, async (page, reg) => {
    await abrirRespaldo(page);
    await importarArchivo(page, { name: 'justo.json', mimeType: 'application/json', buffer: Buffer.concat([justo, Buffer.from(' ')]) });
    await esperar(() => page.locator('#respaldo-error').isVisible(), 'un byte de más debe rechazarse');
    await importarArchivo(page, { name: 'justo.json', mimeType: 'application/json', buffer: justo });
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, '5 MB exactos deben aceptarse');
    verdadero(/1 añadida/.test(await textoDe(avisoDe(page, 'Importación lista').first())));
    limpio(reg);
  });
});

await prueba('Importar ids y textos hostiles: ids saneados, sin inyección, sin contaminar prototipos, la lista sigue usable', async () => {
  const crudo = '{"__proto__":{"contaminado":1},"version":1,"notas":' + JSON.stringify([
    nota('__proto__', 'Proto hostil\ntexto', T0 - 1 * MIN), nota('constructor', 'Constructor hostil', T0 - 2 * MIN),
    nota('toString', 'toString', T0 - 3 * MIN), nota('<img src=x onerror=alert(1)>', '<b>negrita</b>\n<img src=x onerror=alert(2)>', T0 - 4 * MIN),
    nota('a'.repeat(200), 'Id larguísimo', T0 - 5 * MIN), nota('../../etc/passwd', 'Ruta', T0 - 6 * MIN),
    nota('uno"dos\'tres', 'Comillas en el id', T0 - 7 * MIN), nota('con espacios y ñ', 'Raros', T0 - 8 * MIN),
  ]) + '}';
  await con({ reloj: T0, sembrar: SIEMBRA_LOCALES }, async (page, reg) => {
    await abrirRespaldo(page);
    await importarArchivo(page, archivoJson(crudo));
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'debe importarse');
    verdadero(/8 añadidas/.test(await textoDe(avisoDe(page, 'Importación lista').first())), 'las ocho notas son válidas una vez saneado el id');
    const f = await filas(page);
    igual(f.length, 11);
    verdadero(f.every(x => /^[A-Za-z0-9_-]{1,64}$/.test(x.id)), 'los ids del DOM deben estar saneados');
    const g = await guardado(page);
    verdadero(g.notas.every(n => /^[A-Za-z0-9_-]{1,64}$/.test(n.id)), 'los ids guardados deben estar saneados');
    igual(new Set(g.notas.map(n => n.id)).size, g.notas.length, 'sin ids repetidos');
    igual(await page.locator('#lista img, #lista b, #lista script').count(), 0);
    igual(await page.evaluate(() => ({}).contaminado), undefined, 'Object.prototype intacto');
    igual(await page.evaluate(() => Object.prototype.hasOwnProperty.call(Object.prototype, 'contaminado')), false);
    const ids = await page.locator('[id]').evaluateAll(l => l.map(e => e.id));
    igual(new Set(ids).size, ids.length, 'ids duplicados en el DOM');
    igual(reg.dialogos, []);
    // Se pueden abrir y editar las notas con ids raros
    await page.locator('#lista [role="option"]').nth(1).click();
    await escribir(page, ' editada');
    await page.clock.runFor(300);
    verdadero((await guardado(page)).notas.some(n => n.texto.endsWith(' editada')));
    limpio(reg);
  });
});

await prueba('Importar no permite superar las 5.000 notas: rechaza sin cambiar nada, y llega justo a 5.000 si cabe', async () => {
  const cuatroMil = Array.from({ length: 4999 }, (_, i) => nota('n' + i, 'Nota ' + i, T0 - i * MIN));
  await con({ reloj: T0, sembrar: { [CLAVE]: datos(cuatroMil, 'n0') } }, async (page, reg) => {
    igual((await page.locator('#lista [role="option"]').count()), 4999);
    await abrirRespaldo(page);
    const antes = await page.evaluate(k => localStorage.getItem(k), CLAVE);
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('x1', 'Uno', T0), nota('x2', 'Dos', T0)] }));
    await esperar(() => page.locator('#respaldo-error').isVisible(), 'debe rechazar');
    verdadero(/5\.000/.test(await textoDe(page.locator('#respaldo-error'))), 'el mensaje debe citar el máximo de 5.000');
    igual(await page.evaluate(k => localStorage.getItem(k), CLAVE), antes, 'sin cambios');
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('x1', 'Uno', T0), nota('n5', 'Nota 5 actualizada', T0 - 2 * MIN)] }));
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'una nueva y una actualización caben');
    igual((await guardado(page)).notas.length, 5000);
    verdadero(/1 añadida/.test(await textoDe(avisoDe(page, 'Importación lista').first())) && /1 actualizada/.test(await textoDe(avisoDe(page, 'Importación lista').first())));
    limpio(reg);
  });
});

await prueba('Importar con la cuota llena: el informe aparece y además se avisa de que no se está guardando', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_LOCALES, init: { fn: cuotaLlena } }, async (page, reg) => {
    await page.evaluate(() => { window.__llena = true; });
    await abrirRespaldo(page);
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('z', 'Zeta', T0)] }));
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'informe');
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    verdadero((await avisoDe(page, 'Los cambios no se están guardando').count()) === 1, 'aviso de almacenamiento');
    igual((await filas(page)).length, 4, 'las notas importadas siguen en memoria');
    limpio(reg);
  });
});

await prueba('Importar y la vista previa: si la nota abierta se está viendo renderizada, se actualiza sin salir de la vista previa', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_LOCALES }, async (page, reg) => {
    await tecla(page, 'Alt+KeyP');
    await abrirRespaldo(page);
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('a', '# Título importado\n\n**negrita** nueva', T0)] }));
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'informe');
    verdadero(await vista(page).isVisible(), 'sigue la vista previa');
    igual(await textoDe(vista(page).locator('h1')), 'Título importado');
    limpio(reg);
  });
});

// ------------------------------------------------------------------ almacenamiento: avisos persistentes
console.log('\n[almacenamiento no disponible o lleno]');

await prueba('almacenamiento bloqueado: el aviso es persistente (no se retira solo), la barra dice "Sin guardar" y la app sigue funcionando', async () => {
  await con({ init: { fn: bloquearStorage } }, async (page, reg) => {
    const aviso = avisoDe(page, 'Los cambios no se están guardando');
    igual(await aviso.count(), 1);
    await page.clock.runFor(120000);
    igual(await aviso.count(), 1, 'el aviso no debe desaparecer con el tiempo');
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    await nueva(page).click();
    await page.keyboard.type('Escribo igual');
    await page.clock.runFor(1000);
    igual(await aviso.count(), 1, 'sin avisos repetidos');
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    igual((await filas(page))[0].titulo, 'Escribo igual');
    await tecla(page, 'Escape');                                     // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8)
    await tecla(page, 'Alt+Backspace');
    verdadero(await deshacerBtn(page).isVisible(), 'eliminar y deshacer funcionan en memoria');
    await tecla(page, 'Alt+KeyZ');
    igual((await filas(page))[0].titulo, 'Escribo igual');
    igual(reg.errores, []);
  });
});

await prueba('cuota llena desde el inicio (la primera escritura falla): aviso persistente y "Sin guardar"; al liberar espacio guarda y retira el aviso', async () => {
  await con({ reloj: T0, init: { fn: cuotaLlenaDesdeElInicio } }, async (page, reg) => {
    igual(await textoDe(page.locator('#est-guardado')), 'Sin guardar');
    igual(await avisoDe(page, 'Los cambios no se están guardando').count(), 1);
    await page.clock.runFor(60000);
    igual(await avisoDe(page, 'Los cambios no se están guardando').count(), 1, 'persiste');
    await page.evaluate(() => { window.__llena = false; });
    await escribir(page, ' ya cabe');
    await page.clock.runFor(300);
    igual(await textoDe(page.locator('#est-guardado')), 'Guardado');
    igual(await avisoDe(page, 'Los cambios no se están guardando').count(), 0, 'el aviso se retira al recuperarse');
    verdadero((await guardado(page)).notas[0].texto.endsWith(' ya cabe'));
    limpio(reg);
  });
});

// ------------------------------------------------------------------ evento storage (dos pestañas)
console.log('\n[otra pestaña modifica las notas]');

/** Una segunda pestaña (la landing, del mismo origen) cambia lo guardado, igual que lo haría otra copia de la app. */
const otraPestanaEscribe = async (ctx, cambio) => {
  const otra = await ctx.newPage();
  await otra.goto(srv.url + '/index.html');
  await otra.evaluate(([k, texto, ms]) => {
    const v = JSON.parse(localStorage.getItem(k));
    v.notas.push({ id: 'otra', texto, creada: ms, editada: ms });
    localStorage.setItem(k, JSON.stringify(v));
  }, [CLAVE, cambio, T0 + 5 * MIN]);
  return otra;
};

await prueba('storage: si otra pestaña cambia las notas, aparece un aviso con "Recargar" sin tocar el editor ni lo que se está escribiendo, y sin duplicarse', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg, ctx) => {
    await escribir(page, ' trabajo local');
    const antesEditor = await editor(page).inputValue();
    const antesSel = await seleccion(page);
    await otraPestanaEscribe(ctx, 'Desde otra pestaña\ncon su cuerpo');
    const aviso = avisoDe(page, 'otra pestaña');
    await esperar(async () => (await aviso.count()) === 1, 'debe aparecer el aviso');
    verdadero(await aviso.getByRole('button', { name: 'Recargar', exact: true }).isVisible(), 'falta el botón Recargar');
    verdadero((await vivo(page)).includes('otra pestaña'), 'debe anunciarse');
    igual(await editor(page).inputValue(), antesEditor, 'el editor no se toca');
    verdadero(await enFoco(page, '#editor'), 'el foco sigue en el editor');
    igual((await seleccion(page)).ini, antesSel.ini, 'el cursor no se mueve');
    igual((await filas(page)).length, 4, 'la lista no cambia sola');
    await page.keyboard.type(' y sigo');
    igual((await editor(page).inputValue()).endsWith(' trabajo local y sigo'), true, 'se puede seguir escribiendo');
    const otro = await ctx.newPage();
    await otro.goto(srv.url + '/index.html');
    await otro.evaluate(([k]) => { const v = JSON.parse(localStorage.getItem(k)); v.notas.push({ id: 'otra2', texto: 'Otra más', creada: 1, editada: 2 }); localStorage.setItem(k, JSON.stringify(v)); }, [CLAVE]);
    await page.waitForTimeout(250);
    igual(await aviso.count(), 1, 'un solo aviso mientras siga abierto');
    // Cambios en otras claves no avisan
    await otro.evaluate(() => localStorage.setItem('otra-cosa', '1'));
    await page.waitForTimeout(150);
    igual(await aviso.count(), 1);
    limpio(reg);
  });
});

await prueba('storage: Recargar muestra lo de la otra pestaña y no pierde lo que esta pestaña escribió y aún no había guardado', async () => {
  await con({ reloj: T0, sembrar: SIEMBRA_AMBIENTE }, async (page, reg, ctx) => {
    await escribir(page, ' PENDIENTE-LOCAL');                         // con el reloj detenido la pausa de 300 ms no vence: sigue sin guardar
    igual(await textoDe(page.locator('#est-guardado')), 'Guardando');
    await otraPestanaEscribe(ctx, 'Desde otra pestaña\ncon su cuerpo');
    await esperar(async () => (await avisoDe(page, 'otra pestaña').count()) === 1, 'aviso');
    const enAlmacen = await guardado(page);
    verdadero(enAlmacen.notas.some(n => n.id === 'otra'), 'lo de la otra pestaña sigue guardado (no se sobrescribió en silencio)');
    verdadero(!enAlmacen.notas.some(n => n.texto.includes('PENDIENTE-LOCAL')), 'esta pestaña no ha escrito todavía');
    await avisoDe(page, 'otra pestaña').getByRole('button', { name: 'Recargar', exact: true }).click();
    await page.waitForLoadState('load');
    await esperar(async () => (await filas(page)).some(f => f.titulo === 'Desde otra pestaña'), 'tras recargar debe verse la nota de la otra pestaña');
    const g = await guardado(page);
    verdadero(g.notas.some(n => n.id === 'otra'), 'la nota de la otra pestaña se conserva');
    verdadero(g.notas.find(n => n.id === 'arbol').texto.endsWith(' PENDIENTE-LOCAL'), 'lo escrito aquí y aún sin guardar también se conserva');
    igual(g.notas.length, 5);
    igual(await avisoDe(page, 'otra pestaña').count(), 0, 'sin aviso tras recargar');
    limpio(reg);
  });
});

await prueba('storage: el aviso se puede cerrar y vuelve a salir con el siguiente cambio de otra pestaña; un evento sintético de la clave de notas también avisa', async () => {
  await con({ sembrar: SIEMBRA_AMBIENTE }, async (page, reg, ctx) => {
    await otraPestanaEscribe(ctx, 'Primera\ncambio');
    const aviso = avisoDe(page, 'otra pestaña');
    await esperar(async () => (await aviso.count()) === 1, 'aviso');
    await aviso.getByRole('button', { name: 'Cerrar aviso' }).click();
    igual(await aviso.count(), 0);
    await page.evaluate(k => window.dispatchEvent(new StorageEvent('storage', { key: k })), CLAVE);
    await esperar(async () => (await aviso.count()) === 1, 'un nuevo cambio vuelve a avisar');
    limpio(reg);
  });
});

// ------------------------------------------------------------------ móvil
console.log('\n[móvil menos de 600 px]');

const NOTA_LARGA = Array.from({ length: 160 }, (_, i) => `Línea ${i} del texto largo`).join('\n');

await prueba('móvil 360: lista a pantalla completa con el pie (Tema, Copia, Atajos) alcanzable; abrir pasa al editor; Volver a la lista regresa; Esc no destruye nada', async () => {
  await con({ ancho: 360, alto: 740, sembrar: { [CLAVE]: datos([...AMBIENTE, nota('larga', 'Nota larga\n' + NOTA_LARGA, T0 - 5 * HORA)], 'arbol'), [PREFS]: JSON.stringify({ plan: 'brote', ciclo: 'anual' }) } }, async (page, reg) => {
    const lateral = page.locator('aside'), principal = page.locator('main');
    verdadero(await lateral.isVisible() && !(await principal.isVisible()), 'al abrir solo se ve la lista');
    const dentro = async sel => page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; }, sel);
    for (const sel of ['#tema', '#respaldo', '#atajos', '#plan', '#nueva', '#busqueda']) verdadero(await dentro(sel), `${sel} debe estar completo dentro de la pantalla en la lista`);
    // Abrir con el ratón
    await page.locator('#lista [data-id="arepas"]').click();
    verdadero(await principal.isVisible() && !(await lateral.isVisible()), 'abrir una nota pasa al editor');
    for (const sel of ['#volver', '#modo', '#eliminar', '#exportar-nota']) verdadero(await dentro(sel), `${sel} debe estar dentro de la pantalla en el editor`);
    // Escribir, Esc, volver a abrir: el texto sigue
    await escribir(page, ' extra');
    await tecla(page, 'Escape');
    verdadero(await lateral.isVisible() && !(await principal.isVisible()), 'Esc lleva a la lista');
    igual((await guardado(page)).notas.length, 5, 'Esc no elimina nada');
    await page.locator('#lista [data-id="arepas"]').click();
    verdadero((await editor(page).inputValue()).endsWith(' extra'), 'el texto se conserva');
    // Volver con el botón
    await page.getByRole('button', { name: 'Volver a la lista', exact: true }).click();
    verdadero(await lateral.isVisible() && !(await principal.isVisible()) && await enFoco(page, '#lista'));
    // Abrir con el teclado (Enter en la lista)
    await tecla(page, 'ArrowDown');
    await tecla(page, 'Enter');
    verdadero(await principal.isVisible() && await enFoco(page, '#editor'), 'Enter abre la nota y enfoca el editor');
    // Búsqueda desde el editor y abrir el resultado
    await tecla(page, 'Control+KeyK');
    verdadero(await lateral.isVisible() && await enFoco(page, '#busqueda'), 'Ctrl+K lleva a la lista y a la búsqueda');
    await page.keyboard.type('compras');
    await tecla(page, 'Enter');
    verdadero(await principal.isVisible() && (await editor(page).inputValue()).startsWith('Lista de compras'));
    // Pie: tema y diálogos funcionan en móvil
    await page.getByRole('button', { name: 'Volver a la lista', exact: true }).click();
    await temaBtn(page).click();
    verdadero(['light', 'dark'].includes(await dataTheme(page)), 'el tema cambia desde el móvil');
    limpio(reg);
  });
});

await prueba('móvil 360: todo lo que se puede tocar mide al menos 44 x 44 px (lista, editor, vista previa, búsqueda con texto, avisos y diálogos)', async () => {
  const medirTactil = () => {
    const sel = 'button, input:not([type="hidden"]):not([type="file"]), textarea, select, [role="option"], [role="listbox"], a[href], summary, [tabindex="0"]';
    const malos = [];
    for (const e of document.querySelectorAll(sel)) {
      if (e.closest('[inert]') || e.closest('#vista .md p, #vista .md li') && e.tagName === 'A') continue;   // enlaces dentro de texto corrido (WCAG 2.5.8)
      const r = e.getBoundingClientRect();
      if (!e.getClientRects().length || r.bottom <= 0 || r.top >= innerHeight + 1 || r.right <= 0 || r.left >= innerWidth) continue;   // ocultos o fuera de la pantalla (enlace de salto)
      if (e.matches('input[type="checkbox"]')) continue;
      if (r.width < 43.5 || r.height < 43.5) malos.push(`${e.id || e.className || e.tagName}: ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
    }
    return malos;
  };
  await con({ ancho: 360, alto: 740, reloj: T0, sembrar: { [CLAVE]: datos([...AMBIENTE, nota('md', MD_VARIADO, T0 - 6 * HORA)], 'arbol'), [PREFS]: JSON.stringify({ plan: 'bosque', ciclo: 'mensual' }) } }, async (page, reg) => {
    igual(await page.evaluate(medirTactil), [], 'lista');
    await busqueda(page).fill('ceiba');
    igual(await page.evaluate(medirTactil), [], 'lista con búsqueda');
    await busqueda(page).fill('zzzz');
    igual(await page.evaluate(medirTactil), [], 'sin resultados');
    await busqueda(page).fill('');
    await page.locator('#lista [data-id="arbol"]').click();
    igual(await page.evaluate(medirTactil), [], 'editor');
    await tecla(page, 'Alt+Backspace');
    verdadero(await deshacerBtn(page).isVisible());
    igual(await page.evaluate(medirTactil), [], 'editor con el aviso Deshacer');
    await tecla(page, 'Alt+KeyZ');
    await page.getByRole('button', { name: 'Volver a la lista', exact: true }).click();
    await page.locator('#lista [data-id="md"]').click();
    await tecla(page, 'Alt+KeyP');
    igual(await page.evaluate(medirTactil), [], 'vista previa');
    await tecla(page, 'Alt+KeyP');
    await page.getByRole('button', { name: 'Volver a la lista', exact: true }).click();
    await respaldoBtn(page).click();
    igual(await page.evaluate(medirTactil), [], 'diálogo de copia de seguridad');
    await tecla(page, 'Escape');
    await atajosBtn(page).click();
    igual(await page.evaluate(medirTactil), [], 'diálogo de atajos');
    limpio(reg);
  });
});

await prueba('móvil: el teclado virtual (visualViewport simulado) reduce la app a la zona visible, deja la barra de estado a la vista, mantiene el cursor visible y se restaura al cerrarlo', async () => {
  const falsoVisualViewport = () => {
    const vv = new EventTarget();
    Object.assign(vv, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    window.__teclado = (alto, arriba = 0, escala = 1) => { vv.height = alto; vv.offsetTop = arriba; vv.scale = escala; vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')); };
  };
  await con({ ancho: 360, alto: 740, sembrar: { [CLAVE]: datos([nota('larga', 'Nota larga\n' + NOTA_LARGA, T0)], 'larga') }, init: { fn: falsoVisualViewport } }, async (page, reg) => {
    await page.locator('#lista [data-id="larga"]').click();
    const caja = sel => page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; }, sel);
    const antes = await caja('.app');
    igual([antes.top, antes.bottom], [0, 740], 'sin teclado la app ocupa toda la pantalla');
    // 1. Cursor al final del texto: al abrirse el teclado el final debe seguir a la vista
    await editor(page).focus();
    await tecla(page, 'Control+End');
    await page.evaluate(() => window.__teclado(380));
    await esperar(async () => (await caja('.app')).bottom === 380, 'la app debe ajustarse a la altura visible (380)');
    const estado = await caja('#estado'), ed = await caja('#editor'), app = await caja('.app');
    verdadero(estado.bottom <= 380, `la barra de estado debe quedar sobre el teclado: ${JSON.stringify(estado)}`);
    verdadero(ed.bottom <= estado.top + 1 && ed.height >= 100, `el editor ocupa lo que queda: ${JSON.stringify(ed)}`);
    igual(app.top, 0);
    const finVisible = await page.evaluate(() => { const e = document.querySelector('#editor'); return e.scrollTop + e.clientHeight >= e.scrollHeight - parseFloat(getComputedStyle(e).paddingBottom) - 1; });
    verdadero(finVisible, 'la última línea (donde está el cursor) debe seguir visible');
    igual(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    // 2. Cursor en una línea que cabía con el teclado cerrado y ya no cabe con él abierto
    await page.evaluate(() => window.__teclado(740));
    await esperar(async () => (await caja('.app')).bottom === 740, 'al cerrar el teclado la app vuelve a toda la pantalla');
    igual(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vv-alto')), '', 'se quita la variable al cerrar el teclado');
    await page.evaluate(() => { const e = document.querySelector('#editor'); e.scrollTop = 0; });
    const linea = 14;
    await page.evaluate(n => { const e = document.querySelector('#editor'); const pos = e.value.split('\n').slice(0, n).join('\n').length + 1; e.focus(); e.setSelectionRange(pos, pos); }, linea);
    await page.evaluate(() => window.__teclado(380));
    await esperar(async () => (await caja('.app')).bottom === 380, 'app ajustada otra vez');
    const g = await page.evaluate(n => { const e = document.querySelector('#editor'); const cs = getComputedStyle(e); const alto = parseFloat(cs.lineHeight); const y = parseFloat(cs.paddingTop) + n * alto; return { y, alto, top: e.scrollTop, vis: e.clientHeight }; }, linea);
    verdadero(g.y >= g.top - 1 && g.y + g.alto <= g.top + g.vis + 1, `el cursor (y=${g.y}) debe quedar dentro de lo visible del editor [${g.top}, ${g.top + g.vis}]`);
    // 3. Con la ventana visual desplazada (iOS) la app sigue la zona visible
    await page.evaluate(() => window.__teclado(300, 90));
    await esperar(async () => (await caja('.app')).top === 90, 'la app debe seguir el borde superior de la zona visible');
    const sup = await caja('.app');
    igual([sup.top, sup.bottom], [90, 390]);
    // 4. Un gesto de zoom (escala > 1) no es un teclado: no se toca el diseño
    await page.evaluate(() => window.__teclado(370, 0, 2));
    await esperar(async () => (await caja('.app')).bottom === 740, 'con zoom no se reduce la app');
    // 5. Los avisos quedan sobre el teclado
    await page.evaluate(() => window.__teclado(380));
    await esperar(async () => (await caja('.app')).bottom === 380, 'app ajustada');
    await page.evaluate(() => document.activeElement.blur());        // Alt+Retroceso no elimina con el foco en el editor (ronda 1, A11Y-8); sin foco sí
    await tecla(page, 'Alt+Backspace');
    verdadero(await deshacerBtn(page).isVisible());
    const aviso = await caja('#avisos .aviso');
    verdadero(aviso.bottom <= 380, `el aviso debe quedar sobre el teclado: ${JSON.stringify(aviso)}`);
    limpio(reg);
  });
});

await prueba('móvil: sin visualViewport la altura sigue a dvh: al cambiar el alto de la ventana (teclado que redimensiona) la app se ajusta sola', async () => {
  await con({ ancho: 360, alto: 740, sembrar: { [CLAVE]: datos([nota('larga', 'Nota larga\n' + NOTA_LARGA, T0)], 'larga') }, init: { fn: () => { Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => undefined }); } } }, async (page, reg) => {
    await page.locator('#lista [data-id="larga"]').click();
    await editor(page).focus();
    await tecla(page, 'Control+End');
    await page.setViewportSize({ width: 360, height: 400 });
    const r = await page.evaluate(() => ({ app: document.querySelector('.app').getBoundingClientRect().bottom, estado: document.querySelector('#estado').getBoundingClientRect().bottom }));
    verdadero(Math.abs(r.app - 400) <= 1 && r.estado <= 400, `la app debe medir lo que mide la ventana: ${JSON.stringify(r)}`);
    await esperar(() => page.evaluate(() => { const e = document.querySelector('#editor'); return e.scrollTop + e.clientHeight >= e.scrollHeight - parseFloat(getComputedStyle(e).paddingBottom) - 1; }), 'al encogerse la ventana el cursor (al final del texto) debe seguir a la vista');
    limpio(reg);
  });
});

await prueba('600 a 899 px: la barra superior y el pie de la barra lateral caben sin desbordarse y los botones conservan nombre accesible', async () => {
  for (const ancho of [600, 680, 768, 899]) {
    await con({ ancho, alto: 900, sembrar: { [CLAVE]: SIEMBRA_AMBIENTE[CLAVE], [PREFS]: JSON.stringify({ plan: 'brote', ciclo: 'anual' }) } }, async (page, reg) => {
      const r = await page.evaluate(() => {
        const dentroDe = (sel, caja) => { const c = document.querySelector(caja).getBoundingClientRect(); return [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); return b.left >= c.left - 1 && b.right <= c.right + 1 && b.width >= 43.5 && b.height >= 43.5; }); };
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          barra: dentroDe('#barra button', '#barra'), pie: dentroDe('.lateral__pie button', '.lateral__pie'),
          barraScroll: (() => { const b = document.querySelector('#barra'); return b.scrollWidth - b.clientWidth; })(),
          pieScroll: (() => { const b = document.querySelector('.lateral__pie'); return b.scrollWidth - b.clientWidth; })(),
        };
      });
      igual(r.doc, 0, `desbordamiento horizontal a ${ancho} px`);
      verdadero(r.barra.length >= 3 && r.barra.every(Boolean), `botones de la barra superior a ${ancho} px: ${JSON.stringify(r.barra)}`);
      verdadero(r.pie.length === 3 && r.pie.every(Boolean), `botones del pie a ${ancho} px: ${JSON.stringify(r.pie)}`);
      igual([r.barraScroll, r.pieScroll], [0, 0]);
      for (const nombre of ['Vista previa', 'Eliminar', 'Exportar nota']) verdadero(await page.getByRole('button', { name: nombre, exact: true }).isVisible(), `${nombre} a ${ancho} px`);
      limpio(reg);
    });
  }
});

await prueba('el diálogo de copia de seguridad cabe en 360, 768 y 1440 px, con el error visible, sin desbordamiento, en claro y oscuro con contraste AA', async () => {
  for (const [ancho, alto] of [[360, 640], [768, 900], [1440, 900]]) {
    for (const esquema of ['light', 'dark']) {
      await con({ ancho, alto, esquema, sembrar: SIEMBRA_AMBIENTE }, async (page, reg) => {
        await abrirRespaldo(page);
        await importarArchivo(page, archivoJson('{"roto'));
        await esperar(() => page.locator('#respaldo-error').isVisible(), 'error visible');
        const r = await page.evaluate(() => { const d = document.querySelector('#respaldo-dialogo').getBoundingClientRect(); return { izq: d.left, der: d.right, sup: d.top, inf: d.bottom, an: innerWidth, al: innerHeight, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
        verdadero(r.izq >= 0 && r.der <= r.an && r.sup >= 0 && r.inf <= r.al, `el diálogo se sale de la pantalla a ${ancho} px: ${JSON.stringify(r)}`);
        igual(r.doc, 0);
        for (const [s, c] of await page.evaluate(medirContraste, ['#respaldo-dialogo h2', '#respaldo-dialogo p', '#respaldo-error', '#exportar-todo', '#importar', '#cerrar-respaldo'])) verdadero(c >= 4.5, `${esquema} ${ancho} px ${s}: ${c.toFixed(2)}`);
        limpio(reg);
      });
    }
  }
});

await prueba('contraste real (WCAG AA) del pie (Tema, Copia, Atajos, plan), de Exportar nota y del aviso de otra pestaña, en claro y oscuro', async () => {
  for (const esquema of ['light', 'dark']) {
    await con({ esquema, sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ plan: 'brote', ciclo: 'anual' }) } }, async (page, reg, ctx) => {
      for (const [s, c] of await page.evaluate(medirContraste, ['#tema', '#respaldo', '#atajos', '#plan', '#exportar-nota', '#modo', '#eliminar'])) verdadero(c >= 4.5, `${esquema} ${s}: ${c.toFixed(2)}`);
      await otraPestanaEscribe(ctx, 'Otra\ncambio');
      await esperar(async () => (await avisoDe(page, 'otra pestaña').count()) === 1, 'aviso');
      for (const [s, c] of await page.evaluate(medirContraste, ['.aviso__texto', '.aviso__accion'])) verdadero(c >= 4.5, `${esquema} aviso ${s}: ${c.toFixed(2)}`);
      limpio(reg);
    });
  }
});

await prueba('controles de la Task 5: nombres accesibles, iconos ocultos, ids únicos, una sola región viva y foco visible con el teclado', async () => {
  await con({ sembrar: { ...SIEMBRA_AMBIENTE, [PREFS]: JSON.stringify({ plan: 'brote', ciclo: 'anual' }) } }, async page => {
    const nombres = await page.evaluate(() => ['#tema', '#respaldo', '#exportar-nota', '#exportar-todo', '#importar', '#cerrar-respaldo'].map(s => { const e = document.querySelector(s); return [s, (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ')]; }));
    igual(nombres.map(n => n[0]), ['#tema', '#respaldo', '#exportar-nota', '#exportar-todo', '#importar', '#cerrar-respaldo']);
    verdadero(nombres.every(n => n[1].length > 0), `controles sin nombre: ${JSON.stringify(nombres)}`);
    igual(await page.locator('svg:not([aria-hidden="true"])').evaluateAll(l => l.filter(s => !s.closest('[aria-hidden="true"]')).length), 0, 'iconos decorativos aria-hidden (también los del diálogo cerrado)');
    igual(await page.locator('[aria-live]').count(), 1);
    const ids = await page.locator('[id]').evaluateAll(l => l.map(e => e.id));
    igual(new Set(ids).size, ids.length);
    igual(await page.locator('#archivo-importar').getAttribute('type'), 'file');
    verdadero(((await page.locator('#archivo-importar').getAttribute('aria-label')) || '').length > 0, 'el selector de archivo oculto también tiene nombre');
    igual(await page.locator('#tema').getAttribute('aria-pressed'), null, 'el botón de tema rota entre tres estados: no es un conmutador');
    igual(await page.locator('#importar').getAttribute('aria-describedby'), 'respaldo-error', 'el error de importación queda asociado al control que lo causa');
    verdadero(await page.locator('#respaldo-error').count() === 1);
    await page.locator('#nueva').focus();
    for (const id of ['busqueda', 'lista', 'tema', 'respaldo']) {
      await tecla(page, 'Tab');
      const a = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.id, sombra: cs.boxShadow, contorno: cs.outlineStyle + ' ' + cs.outlineWidth }; });
      igual(a.id, id);
      verdadero((a.sombra && a.sombra !== 'none') || /solid [1-9]/.test(a.contorno), `sin anillo de foco en ${id}: ${JSON.stringify(a)}`);
    }
    await tecla(page, 'Enter');
    for (const id of ['exportar-todo', 'importar', 'cerrar-respaldo']) {
      const a = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.id, sombra: cs.boxShadow, contorno: cs.outlineStyle + ' ' + cs.outlineWidth }; });
      if (a.id !== id) await tecla(page, 'Tab');
      const b = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.id, sombra: cs.boxShadow, contorno: cs.outlineStyle + ' ' + cs.outlineWidth }; });
      igual(b.id, id);
      verdadero((b.sombra && b.sombra !== 'none') || /solid [1-9]/.test(b.contorno), `sin anillo de foco en ${id} del diálogo: ${JSON.stringify(b)}`);
    }
  });
});

await prueba('sin emojis ni recursos externos con el diálogo de copia, el plan, el informe de importación y el aviso de otra pestaña presentes', async () => {
  await con({ consulta: '?plan=bosque&ciclo=anual', sembrar: SIEMBRA_AMBIENTE }, async (page, reg, ctx) => {
    await abrirRespaldo(page);
    await importarArchivo(page, archivoJson({ version: 1, notas: [nota('z', 'Zeta', T0)] }));
    await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'informe');
    await otraPestanaEscribe(ctx, 'Otra\ncambio');
    await esperar(async () => (await avisoDe(page, 'otra pestaña').count()) === 1, 'aviso');
    await abrirRespaldo(page);
    const t = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML);
    verdadero(!EMOJI.test(t), 'hay emojis o selectores de variación');
    igual(reg.peticiones.filter(u => !u.startsWith(PAGINA)), [], 'peticiones inesperadas');
    limpio(reg);
  });
});

// =====================================================================================
console.log('\n[capturas de revisión]');

await prueba('genera capturas de la app en 360, 768 y 1440 px, claro y oscuro (ceiba/tests/capturas/)', async () => {
  const dir = path.join(RAIZ, 'tests', 'capturas');
  fs.mkdirSync(dir, { recursive: true });
  const variadas = [
    nota('arbol', '# Árbol de la ceiba\n\nSu tronco tiene espinas y da sombra al pueblo.\n\nLa ceiba crece despacio, pero cuando madura cubre la plaza entera. Aquí van los apuntes de la visita:\n\n- Medir el contorno del tronco\n- Anotar los nombres que usan los vecinos\n- [ ] Volver en temporada de lluvias\n', T0 - 4 * MIN),
    nota('arepas', 'Receta de arepas\nHarina de maíz, agua y sal. Se acompañan con queso.', T0 - 2 * HORA),
    nota('compras', 'Lista de compras\n- queso\n- harina\n- café', T0 - 26 * HORA),
    nota('ideas', 'Ideas para el cuento\nUn cuento sobre una ceiba y un pueblo con queso.', T0 - 3 * DIA),
    nota('reunion', 'Reunión del jueves\nTemas pendientes con el equipo, presupuesto y calendario de entregas del trimestre.', T0 - 9 * DIA),
    nota('sueno', 'Sin título', T0 - 40 * DIA),
  ];
  variadas[5].texto = '';
  for (const ancho of [360, 768, 1440]) {
    for (const esquema of ['light', 'dark']) {
      await con({ ancho, alto: ancho === 360 ? 740 : ancho === 768 ? 1024 : 900, esquema, reloj: T0, sembrar: { [CLAVE]: datos(variadas, 'arbol') } }, async page => {
        const tema = esquema === 'light' ? 'claro' : 'oscuro';
        if (ancho === 360) await page.screenshot({ path: path.join(dir, `app-360-lista-${tema}.png`) });
        if (ancho === 360) await page.locator('#lista [data-id="arbol"]').click();
        await page.screenshot({ path: path.join(dir, `app-${ancho}-${tema}.png`) });
        if (ancho === 1440) {
          await page.getByRole('searchbox', { name: 'Buscar notas' }).fill('ceiba');
          await page.screenshot({ path: path.join(dir, `app-1440-busqueda-${tema}.png`) });
          await page.getByRole('searchbox', { name: 'Buscar notas' }).fill('zzz');
          await page.screenshot({ path: path.join(dir, `app-1440-sinresultados-${tema}.png`) });
        }
      });
    }
  }
  for (const esquema of ['light', 'dark']) {
    await con({ ancho: 1440, esquema, reloj: T0, sembrar: { [CLAVE]: datos(variadas, 'arbol') } }, async page => {
      const tema = esquema === 'light' ? 'claro' : 'oscuro';
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');   // salto, nueva, búsqueda, lista
      await page.screenshot({ path: path.join(dir, `app-1440-foco-lista-${tema}.png`) });
      await page.keyboard.press('Tab');
      await page.screenshot({ path: path.join(dir, `app-1440-foco-editor-${tema}.png`) });
    });
  }
  await con({ ancho: 1440, reloj: T0, sembrar: { [CLAVE]: datos([], null) } }, async page => { await page.screenshot({ path: path.join(dir, 'app-1440-vacio-claro.png') }); });
  await con({ ancho: 1440, esquema: 'dark', reloj: T0, sembrar: { [CLAVE]: datos([], null) } }, async page => { await page.screenshot({ path: path.join(dir, 'app-1440-vacio-oscuro.png') }); });
  await con({ ancho: 1440, reloj: T0, sembrar: { [CLAVE]: RAW_ROTO } }, async page => { await page.screenshot({ path: path.join(dir, 'app-1440-aviso-claro.png') }); });
  for (const f of ['app-360-claro.png', 'app-768-oscuro.png', 'app-1440-claro.png', 'app-1440-busqueda-claro.png', 'app-1440-vacio-oscuro.png', 'app-1440-aviso-claro.png']) {
    verdadero(fs.statSync(path.join(dir, f)).size > 5000, `captura vacía: ${f}`);
  }
});

await prueba('genera capturas de la vista previa, el diálogo de atajos, el aviso de deshacer y el modo enfoque (ceiba/tests/capturas/)', async () => {
  const dir = path.join(RAIZ, 'tests', 'capturas');
  fs.mkdirSync(dir, { recursive: true });
  const cuerpo = [
    '# Diario de la ceiba', '',
    'Hoy visité la plaza del pueblo. La **ceiba** tiene un tronco con espinas y da *sombra* a toda la esquina; los vecinos la llaman `el árbol grande`.', '',
    '## Lo que anoté', '',
    '- Medir el contorno del tronco', '- Hablar con doña Rosa sobre la historia', '  - Preguntar por la inundación', '- [x] Llevar la libreta', '- [ ] Volver en temporada de lluvias', '',
    '> Un árbol así no se planta: se hereda.', '',
    '| Dato | Valor |', '| :-- | --: |', '| Altura | 28 m |', '| Edad aproximada | 90 años |', '',
    '```js', 'const sombra = altura * 0.8;', '```', '',
    'Más en [el archivo de la plaza](https://example.com/plaza).',
  ].join('\n');
  const notas = [
    nota('diario', cuerpo, T0 - 4 * MIN),
    nota('arepas', 'Receta de arepas\nHarina de maíz, agua y sal. Se acompañan con queso.', T0 - 2 * HORA),
    nota('compras', 'Lista de compras\n- queso\n- harina\n- café', T0 - 26 * HORA),
    nota('ideas', 'Ideas para el cuento\nUn cuento sobre una ceiba y un pueblo con queso.', T0 - 3 * DIA),
  ];
  for (const esquema of ['light', 'dark']) {
    const tema = esquema === 'light' ? 'claro' : 'oscuro';
    await con({ ancho: 1440, esquema, reloj: T0, sembrar: { [CLAVE]: datos(notas, 'diario') } }, async page => {
      await tecla(page, 'Alt+KeyP');
      await page.screenshot({ path: path.join(dir, `app-1440-vista-${tema}.png`) });
      await tecla(page, 'Alt+KeyP');
      await page.locator('#lista [data-id="arepas"]').click();
      await tecla(page, 'Alt+Backspace');
      await page.screenshot({ path: path.join(dir, `app-1440-deshacer-${tema}.png`) });
      await tecla(page, 'Alt+KeyZ');
      await page.locator('#lista').focus();
      await tecla(page, 'Shift+Slash');
      await page.screenshot({ path: path.join(dir, `app-1440-ayuda-${tema}.png`) });
      await tecla(page, 'Escape');
      await page.locator('#lista [data-id="diario"]').click();
      await tecla(page, 'Alt+KeyP');
      await tecla(page, 'Alt+Backslash');
      await page.screenshot({ path: path.join(dir, `app-1440-enfoque-${tema}.png`) });
      await page.mouse.move(2, 400);
      await page.screenshot({ path: path.join(dir, `app-1440-enfoque-lateral-${tema}.png`) });
    });
  }
  await con({ ancho: 768, alto: 1024, reloj: T0, sembrar: { [CLAVE]: datos(notas, 'diario') } }, async page => {
    await tecla(page, 'Alt+KeyP');
    await page.screenshot({ path: path.join(dir, 'app-768-vista-claro.png') });
    await tecla(page, 'Shift+Slash');
    await page.screenshot({ path: path.join(dir, 'app-768-ayuda-claro.png') });
  });
  for (const esquema of ['light', 'dark']) {
    const tema = esquema === 'light' ? 'claro' : 'oscuro';
    await con({ ancho: 360, alto: 740, esquema, reloj: T0, sembrar: { [CLAVE]: datos(notas, 'diario') } }, async page => {
      await page.locator('#lista [data-id="diario"]').click();
      await tecla(page, 'Alt+KeyP');
      await page.screenshot({ path: path.join(dir, `app-360-vista-${tema}.png`) });
      await tecla(page, 'Alt+Backspace');
      await page.screenshot({ path: path.join(dir, `app-360-deshacer-${tema}.png`) });
      await tecla(page, 'Alt+KeyZ');
      await page.locator('#lista').focus();
      await tecla(page, 'Shift+Slash');
      await page.screenshot({ path: path.join(dir, `app-360-ayuda-${tema}.png`) });
    });
  }
  for (const f of ['app-1440-vista-claro.png', 'app-1440-ayuda-oscuro.png', 'app-1440-deshacer-claro.png', 'app-1440-enfoque-claro.png', 'app-360-vista-claro.png', 'app-360-ayuda-claro.png']) {
    verdadero(fs.statSync(path.join(dir, f)).size > 5000, `captura vacía: ${f}`);
  }
});

await prueba('genera capturas de la Task 5: plan, tema, copia de seguridad, informe, aviso de otra pestaña y móvil (ceiba/tests/capturas/)', async () => {
  const dir = path.join(RAIZ, 'tests', 'capturas');
  fs.mkdirSync(dir, { recursive: true });
  const prefs = { [PREFS]: JSON.stringify({ plan: 'brote', ciclo: 'anual' }) };
  for (const esquema of ['light', 'dark']) {
    const tema = esquema === 'light' ? 'claro' : 'oscuro';
    await con({ ancho: 1440, alto: 900, esquema, reloj: T0, sembrar: { ...SIEMBRA_AMBIENTE, ...prefs } }, async page => {
      await page.screenshot({ path: path.join(dir, `app5-1440-plan-${tema}.png`) });
      await respaldoBtn(page).click();
      await page.screenshot({ path: path.join(dir, `app5-1440-respaldo-${tema}.png`) });
      await importarArchivo(page, archivoJson('{"roto'));
      await esperar(() => page.locator('#respaldo-error').isVisible(), 'error');
      await page.screenshot({ path: path.join(dir, `app5-1440-respaldo-error-${tema}.png`) });
      await importarArchivo(page, archivoJson({ version: 1, notas: [nota('z', 'Zeta\ncon un cuerpo', T0), nota('arbol', 'Árbol\ntexto viejo', T0 - 9 * DIA)] }));
      await esperar(async () => (await avisoDe(page, 'Importación lista').count()) === 1, 'informe');
      await page.screenshot({ path: path.join(dir, `app5-1440-informe-${tema}.png`) });
    });
  }
  await con({ ancho: 1440, alto: 900, esquema: 'light', init: { fn: bloquearStorage } }, async page => {
    await page.screenshot({ path: path.join(dir, 'app5-1440-sin-almacenamiento-claro.png') });
  });
  await con({ ancho: 1440, alto: 900, esquema: 'dark', sembrar: SIEMBRA_AMBIENTE }, async (page, reg, ctx) => {
    await otraPestanaEscribe(ctx, 'Desde otra pestaña\ncon su cuerpo');
    await esperar(async () => (await avisoDe(page, 'otra pestaña').count()) === 1, 'aviso');
    await page.screenshot({ path: path.join(dir, 'app5-1440-otra-pestana-oscuro.png') });
  });
  for (const esquema of ['light', 'dark']) {
    const tema = esquema === 'light' ? 'claro' : 'oscuro';
    await con({ ancho: 360, alto: 740, esquema, reloj: T0, sembrar: { ...SIEMBRA_AMBIENTE, ...prefs } }, async page => {
      await page.screenshot({ path: path.join(dir, `app5-360-lista-${tema}.png`) });
      await page.locator('#lista [data-id="arepas"]').click();
      await page.screenshot({ path: path.join(dir, `app5-360-editor-${tema}.png`) });
      await page.getByRole('button', { name: 'Volver a la lista', exact: true }).click();
      await respaldoBtn(page).click();
      await page.screenshot({ path: path.join(dir, `app5-360-respaldo-${tema}.png`) });
    });
  }
  await con({ ancho: 768, alto: 1024, esquema: 'light', reloj: T0, sembrar: { ...SIEMBRA_AMBIENTE, ...prefs } }, async page => { await page.screenshot({ path: path.join(dir, 'app5-768-claro.png') }); });
  await con({ ancho: 640, alto: 800, esquema: 'dark', reloj: T0, sembrar: { ...SIEMBRA_AMBIENTE, ...prefs } }, async page => { await page.screenshot({ path: path.join(dir, 'app5-640-oscuro.png') }); });
  for (const f of ['app5-1440-plan-claro.png', 'app5-1440-respaldo-error-oscuro.png', 'app5-1440-informe-claro.png', 'app5-1440-otra-pestana-oscuro.png', 'app5-360-lista-claro.png', 'app5-360-respaldo-oscuro.png']) {
    verdadero(fs.statSync(path.join(dir, f)).size > 5000, `captura vacía: ${f}`);
  }
});

await cerrar();
await srv.cerrar();
process.exitCode = resumen('e2e');
