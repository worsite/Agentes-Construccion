// Pruebas de calidad transversales de Ceiba (landing y aplicación). Ejecutar: node ceiba/tests/calidad.mjs
//
// Cubre la sección 6 de la spec para ambas páginas (index.html y app.html):
//   1. Sin emojis ni caracteres decorativos (fuentes, README.md si existe, y el DOM renderizado).
//   2. Contraste WCAG 2.x de los pares de tokens de la spec, en tema claro y oscuro, y de todo el texto real renderizado.
//   3. Consola sin errores ni avisos (y sin violaciones de la CSP) tras recorrer las funciones de cada página.
//   4. Cero peticiones externas (en ejecución y en el código fuente).
//   5. Anclas e hipervínculos internos que resuelven (incluidos los enlaces de planes que la app debe aceptar).
//   6. Ids únicos y referencias ARIA que apuntan a algo.
//   7. Controles con nombre accesible según el árbol de accesibilidad de Chromium, jerarquía de títulos, alt, lang y título.
//   8. Sin scroll horizontal en 360, 768 y 1440 px.
import fs from 'node:fs';
import path from 'node:path';
import { servir, lanzar, prueba as pruebaBase, resumen, igual, verdadero, RAIZ } from './helpers.mjs';

// FILTRO="texto" (regex, sin distinguir mayúsculas) ejecuta solo las pruebas cuyo nombre coincida. Sin FILTRO corren todas.
const FILTRO = process.env.FILTRO ? new RegExp(process.env.FILTRO, 'i') : null;
const prueba = (nombre, fn) => (FILTRO && !FILTRO.test(nombre)) ? undefined : pruebaBase(nombre, fn);

const srv = await servir();
const { navegador, cerrar } = await lanzar();
const PAGINAS = [
  { archivo: 'index.html', nombre: 'landing', url: srv.url + '/index.html' },
  { archivo: 'app.html', nombre: 'app', url: srv.url + '/app.html' },
];
const fuente = a => fs.readFileSync(path.join(RAIZ, a), 'utf8');
const CLAVE = 'ceiba:notas:v1';
const PREFS = 'ceiba:prefs:v1';
const T0 = Date.parse('2026-10-16T10:32:00-05:00');
const HORA = 3600000;
const ANCHOS = [[360, 740], [768, 1024], [1440, 900]];
const ESQUEMAS = ['light', 'dark'];

// ------------------------------------------------------------------ utilidades
const nota = (id, texto, editada) => ({ id, texto, creada: editada, editada });
const NOTAS = [
  nota('arbol', 'Árbol de la ceiba\nSu tronco tiene espinas y da sombra al pueblo.', T0 - 1 * HORA),
  nota('md', '# Título grande\n\nPárrafo con **negrita**, *cursiva* y `código`.\n\n- uno\n- [x] hecha\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> una cita\n\n[web](https://example.com/a)', T0 - 2 * HORA),
  nota('compras', 'Lista de compras\n- queso\n- harina', T0 - 3 * HORA),
];
const SIEMBRA = { [CLAVE]: JSON.stringify({ version: 1, notas: NOTAS, activa: 'arbol' }) };

function sembrar(claves) {
  try {
    if (sessionStorage.getItem('__sembrado')) return;
    sessionStorage.setItem('__sembrado', '1');
    for (const k of Object.keys(claves)) localStorage.setItem(k, claves[k]);
  } catch (e) { /* sin almacenamiento */ }
}
function vigilarCsp() {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI}`));
}

/**
 * Abre una página en un contexto nuevo con registro de consola, errores, peticiones y violaciones de la CSP.
 * Toda petición que no sea al servidor de pruebas (ni data: ni blob:) se aborta y se anota como externa.
 */
async function con(pagina, opciones, fn) {
  const o = opciones || {};
  const ctx = await navegador.newContext({
    viewport: { width: o.ancho || 1440, height: o.alto || 900 }, locale: 'es-ES', timezoneId: 'America/Bogota',
    colorScheme: o.esquema || 'light', reducedMotion: 'reduce', acceptDownloads: true,
  });
  ctx.setDefaultTimeout(5000);
  const reg = { consola: [], errores: [], peticiones: [], externas: [], csp: [] };
  await ctx.route('**/*', ruta => {
    const u = ruta.request().url();
    if (u.startsWith(srv.url + '/')) return ruta.continue();
    reg.externas.push(u);
    return ruta.abort();
  });
  await ctx.addInitScript(vigilarCsp);
  if (o.sembrar) await ctx.addInitScript(sembrar, o.sembrar);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') reg.consola.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => reg.errores.push(e.message));
  page.on('request', r => reg.peticiones.push(r.url()));
  try {
    await page.clock.install({ time: T0 });
    await page.goto(pagina.url + (o.consulta || ''));
    return await fn(page, reg, ctx);
  } finally { await ctx.close(); }
}
const limpio = reg => {
  igual(reg.consola, [], 'consola');
  igual(reg.errores, [], 'errores de página');
};

// =================================================================================================
console.log('\n[sin emojis ni caracteres decorativos]');

// Pictogramas de la spec (Extended_Pictographic y selector de variación U+FE0F) más lo que esa propiedad no cubre:
// unión de cero ancho, marco de teclado, indicadores regionales y modificadores de tono de piel.
const DECORATIVO = /\p{Extended_Pictographic}|[\u{FE0F}\u{200D}\u{20E3}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]/gu;
const hallazgos = (texto, archivo) => {
  const salida = [];
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    for (const m of lineas[i].matchAll(DECORATIVO)) salida.push(`${archivo}:${i + 1} U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} en "${lineas[i].slice(Math.max(0, m.index - 20), m.index + 20).trim()}"`);
  }
  return salida;
};

await prueba('el detector de emojis es fiable: detecta los caracteres prohibidos de la spec y deja pasar las flechas y viñetas permitidas', async () => {
  for (const malo of ['\u{1F600}', '\u{2728}', '\u{2B50}', '\u{2705}', 'a\u{FE0F}', '\u{2764}\u{FE0F}', '\u{1F1E8}\u{1F1F4}', '1\u{FE0F}\u{20E3}', '\u{1F44D}\u{1F3FD}', '\u{1F468}\u{200D}\u{1F4BB}']) {
    verdadero(hallazgos(malo, 'x').length > 0, `no detectó U+${malo.codePointAt(0).toString(16)}`);
  }
  for (const bueno of ['→ • · — «» ¿¡ ñ á é í ó ú ü US$ 4,17 … ≠ ≤', 'Ceiba: cuaderno de notas en markdown']) {
    igual(hallazgos(bueno, 'x'), [], 'falso positivo');
  }
});

await prueba('index.html, app.html y README.md (si existe) no contienen emojis ni caracteres decorativos', async () => {
  const archivos = ['index.html', 'app.html'];
  if (fs.existsSync(path.join(RAIZ, 'README.md'))) archivos.push('README.md');
  else console.log('        README.md todavía no existe: se comprobará en cuanto se cree');
  const malos = archivos.flatMap(a => hallazgos(fuente(a), a));
  igual(malos, [], 'caracteres decorativos en el código fuente');
  // Cualquier otro archivo de la entrega (todo menos tests/) tampoco
  const otros = fs.readdirSync(RAIZ, { withFileTypes: true }).filter(d => d.isFile() && !archivos.includes(d.name) && /\.(html|css|js|md|json|svg|txt)$/.test(d.name));
  igual(otros.flatMap(d => hallazgos(fuente(d.name), d.name)), []);
});

await prueba('las pruebas y los datos de ejemplo de la entrega tampoco usan emojis (tests/*.mjs)', async () => {
  const dir = path.join(RAIZ, 'tests');
  const malos = fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).flatMap(f => hallazgos(fs.readFileSync(path.join(dir, f), 'utf8'), 'tests/' + f));
  igual(malos, []);
});

await prueba('el DOM renderizado (texto, atributos y título) de ambas páginas no tiene emojis, con interacción y en claro y oscuro', async () => {
  for (const pagina of PAGINAS) {
    for (const esquema of ESQUEMAS) {
      await con(pagina, { esquema, sembrar: SIEMBRA, consulta: pagina.nombre === 'app' ? '?plan=brote&ciclo=anual' : '' }, async (page, reg) => {
        if (pagina.nombre === 'landing') {
          await page.locator('.ciclo__opcion', { hasText: 'Mensual' }).click();
          await page.locator('details > summary').evaluateAll(l => l.forEach(s => s.click()));
        } else {
          await page.locator('#respaldo').click();
          await page.keyboard.press('Escape');
          await page.locator('#modo').click();
        }
        const t = await page.evaluate(() => {
          const atributos = [...document.querySelectorAll('*')].flatMap(e => [...e.attributes].map(a => a.value)).join('\n');
          return document.body.innerText + '\n' + atributos + '\n' + document.title;
        });
        igual(hallazgos(t, pagina.nombre), [], `${pagina.nombre} ${esquema}`);
        limpio(reg);
      });
    }
  }
});

// =================================================================================================
console.log('\n[contraste WCAG]');

const hexARgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const luminancia = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contraste = (a, b) => { const x = luminancia(hexARgb(a)), y = luminancia(hexARgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Tokens de la spec, sección 3. Se comprueban contra el texto de la spec y contra lo que realmente calcula cada página.
const TOKENS = {
  claro: { '--papel': '#FBF6EA', '--hoja': '#FFFDF7', '--tinta': '#2B2620', '--tinta-suave': '#5E554A', '--linea': '#E3D9C4', '--musgo': '#4B5A35', '--musgo-oscuro': '#3A4728', '--terracota': '#9C4A27', '--arcilla': '#E7C9A5', '--peligro': '#A3281E', '--foco': '#1F5FBF' },
  oscuro: { '--papel': '#1B1915', '--hoja': '#24211C', '--tinta': '#EEE6D4', '--tinta-suave': '#B9AE9B', '--linea': '#3A352C', '--musgo': '#A9BC87', '--musgo-oscuro': '#BFD0A0', '--terracota': '#E5987A', '--arcilla': '#5A4631', '--peligro': '#F08A7E', '--foco': '#8DB8FF' },
};
const SOBRE_MUSGO = { claro: '#FFFFFF', oscuro: '#1B1915' };   // "texto blanco encima" / "texto oscuro #1B1915 encima"
// Pares [primer plano, fondo, mínimo, para qué sirve]. 4,5 para texto, 3 para componentes y anillo de foco (WCAG 1.4.3 y 1.4.11).
const PARES = [
  ['--tinta', '--papel', 4.5, 'texto principal sobre la página'], ['--tinta', '--hoja', 4.5, 'texto principal sobre superficies'],
  ['--tinta-suave', '--papel', 4.5, 'texto secundario sobre la página'], ['--tinta-suave', '--hoja', 4.5, 'texto secundario sobre superficies'],
  ['--terracota', '--papel', 4.5, 'énfasis de texto sobre la página'], ['--terracota', '--hoja', 4.5, 'énfasis de texto sobre superficies'],
  ['--peligro', '--papel', 4.5, 'eliminar sobre la página'], ['--peligro', '--hoja', 4.5, 'eliminar sobre superficies'],
  ['--musgo', '--papel', 4.5, 'texto de acción sobre la página'], ['--musgo', '--hoja', 4.5, 'texto de acción sobre superficies'],
  ['--sobre-musgo', '--musgo', 4.5, 'texto del botón primario'], ['--sobre-musgo', '--musgo-oscuro', 4.5, 'texto del botón primario con hover'],
  ['--tinta', '--arcilla', 4.5, 'texto resaltado (mark)'], ['--tinta', '--linea', 4.5, 'texto sobre el hover de botones'],
  ['--tinta-suave', '--linea', 4.5, 'texto secundario sobre el hover de botones'],
  ['--foco', '--papel', 3, 'anillo de foco sobre la página'], ['--foco', '--hoja', 3, 'anillo de foco sobre superficies'],
  ['--musgo', '--papel', 3, 'indicadores y casillas'],
];

await prueba('los tokens de color de ambas páginas son exactamente los de la spec (claro y oscuro) y la spec los lista tal cual', async () => {
  const spec = fs.readFileSync(path.join(RAIZ, '..', 'docs', 'superpowers', 'specs', '2026-10-16-ceiba-design.md'), 'utf8');
  for (const tema of ['claro', 'oscuro']) {
    for (const [k, v] of Object.entries(TOKENS[tema])) verdadero(spec.includes(`${k}: ${v}`), `la spec no lista ${k}: ${v} (${tema})`);
  }
  for (const pagina of PAGINAS) {
    for (const [esquema, tema] of [['light', 'claro'], ['dark', 'oscuro']]) {
      await con(pagina, { esquema }, async page => {
        const real = await page.evaluate(ks => Object.fromEntries(ks.map(k => [k, getComputedStyle(document.documentElement).getPropertyValue(k).trim().toUpperCase()])), Object.keys(TOKENS[tema]));
        igual(real, Object.fromEntries(Object.entries(TOKENS[tema]).map(([k, v]) => [k, v.toUpperCase()])), `${pagina.nombre} ${tema}`);
      });
    }
  }
});

await prueba('los tokens también valen con el tema elegido a mano (data-theme) en la app y en la landing', async () => {
  for (const pagina of PAGINAS) {
    for (const [tema, attr, esquemaSistema] of [['claro', 'light', 'dark'], ['oscuro', 'dark', 'light']]) {
      await con(pagina, { esquema: esquemaSistema, sembrar: { [PREFS]: JSON.stringify({ tema }) } }, async page => {
        igual(await page.locator('html').getAttribute('data-theme'), attr);
        const real = await page.evaluate(ks => Object.fromEntries(ks.map(k => [k, getComputedStyle(document.documentElement).getPropertyValue(k).trim().toUpperCase()])), Object.keys(TOKENS[tema]));
        igual(real, Object.fromEntries(Object.entries(TOKENS[tema]).map(([k, v]) => [k, v.toUpperCase()])), `${pagina.nombre} ${tema} elegido a mano`);
      });
    }
  }
});

await prueba('contraste WCAG de los pares de tokens (texto >= 4,5:1; anillo de foco y componentes >= 3:1) en tema claro y oscuro', async () => {
  const calculados = [];
  for (const tema of ['claro', 'oscuro']) {
    const t = { ...TOKENS[tema], '--sobre-musgo': SOBRE_MUSGO[tema] };
    for (const [fg, bg, minimo, uso] of PARES) {
      const r = contraste(t[fg], t[bg]);
      calculados.push(`${tema} ${fg} sobre ${bg}: ${r.toFixed(2)}:1`);
      verdadero(r >= minimo, `${tema}: ${fg} (${t[fg]}) sobre ${bg} (${t[bg]}) = ${r.toFixed(2)}:1, mínimo ${minimo} (${uso})`);
    }
  }
  verdadero(calculados.length === PARES.length * 2);
  // --sobre-musgo es el único token fuera de la lista de la spec: debe valer lo que la spec dice en prosa
  for (const pagina of PAGINAS) {
    for (const [esquema, tema] of [['light', 'claro'], ['dark', 'oscuro']]) {
      await con(pagina, { esquema }, async page => {
        const v = (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sobre-musgo').trim())).toUpperCase();
        if (v) igual(v, SOBRE_MUSGO[tema], `--sobre-musgo en ${pagina.nombre} ${tema}`);
      });
    }
  }
});

await prueba('--arcilla es solo decoración: ninguna regla la usa como color de texto en el código fuente', async () => {
  for (const a of ['index.html', 'app.html']) {
    const malas = fuente(a).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /(^|[^-a-z])color:\s*var\(--arcilla\)/.test(l));
    igual(malas, [], `${a}: --arcilla como color de texto`);
  }
});

/** Recorre todo el texto visible y devuelve los elementos cuyo contraste real queda por debajo del mínimo (4,5, o 3 si el texto es grande). */
const escanearContraste = () => {
  const analizar = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\/]\s*|\s+/).filter(Boolean).map(s => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const sobre = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const fondoDe = el => {
    const capas = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;           // degradado o imagen: no se puede medir con este método
      const c = analizar(cs.backgroundColor);
      if (c && c.a > 0) { capas.push(c); if (c.a === 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = capas.length - 1; i >= 0; i--) base = sobre(capas[i], base);
    return base;
  };
  const malos = [], vistos = new Set();
  let medidos = 0, omitidos = 0;
  const caminante = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = caminante.nextNode(); n; n = caminante.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || vistos.has(el) || el.closest('script, style, noscript, template, [hidden], [inert]')) continue;
    vistos.add(el);
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || cs.display === 'none') continue;
    if (el.closest('dialog:not([open])')) continue;
    if (el.closest('.solo-lector') || el.closest('.salto') && !el.matches(':focus')) continue;       // texto solo para lectores y enlace de salto fuera de pantalla
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    if (op === 0) continue;
    const bg = fondoDe(el);
    if (!bg) { omitidos++; continue; }
    const col = analizar(cs.color); col.a *= op;
    const r = ratio(sobre(col, bg), bg);
    const px = parseFloat(cs.fontSize), grueso = parseInt(cs.fontWeight, 10) >= 700;
    const grande = px >= 24 || (px >= 18.66 && grueso);
    medidos++;
    if (r < (grande ? 3 : 4.5)) malos.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]} "${n.nodeValue.trim().slice(0, 30)}" ${r.toFixed(2)}:1 (${cs.color} sobre rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}))`);
  }
  return { malos, medidos, omitidos };
};

await prueba('contraste real de todo el texto visible de la landing (claro y oscuro, 360 y 1440, mensual y anual, con las preguntas abiertas)', async () => {
  for (const esquema of ESQUEMAS) {
    for (const [ancho, alto] of [[360, 740], [1440, 900]]) {
      await con(PAGINAS[0], { esquema, ancho, alto }, async page => {
        for (const ciclo of ['Anual', 'Mensual']) {
          await page.locator('.ciclo__opcion', { hasText: ciclo }).click();
          const r = await page.evaluate(escanearContraste);
          igual(r.malos, [], `landing ${esquema} ${ancho}px ${ciclo}`);
          verdadero(r.medidos > 100, `se midieron muy pocos textos (${r.medidos})`);
        }
        await page.locator('details > summary').evaluateAll(l => l.forEach(s => s.click()));
        igual((await page.evaluate(escanearContraste)).malos, [], `landing ${esquema} ${ancho}px con preguntas abiertas`);
      });
    }
  }
});

await prueba('contraste real de todo el texto visible de la app (claro y oscuro): lista, vista previa, diálogos, avisos, plan y estados', async () => {
  for (const esquema of ESQUEMAS) {
    await con(PAGINAS[1], { esquema, sembrar: SIEMBRA, consulta: '?plan=bosque&ciclo=mensual' }, async (page, reg, ctx) => {
      const r0 = await page.evaluate(escanearContraste);
      igual(r0.malos, [], `app ${esquema} lista`);
      verdadero(r0.medidos > 20, `se midieron muy pocos textos (${r0.medidos})`);
      await page.locator('#lista [data-id="md"]').click();
      await page.locator('#modo').click();
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} vista previa`);
      await page.keyboard.press('Alt+Backspace');
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} aviso de eliminar`);
      await page.keyboard.press('Alt+KeyZ');
      await page.locator('#busqueda').fill('zzzz');
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} sin resultados`);
      await page.locator('#busqueda').fill('ceiba');
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} búsqueda con resaltado`);
      await page.locator('#busqueda').fill('');
      await page.locator('#atajos').click();
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} atajos`);
      await page.keyboard.press('Escape');
      await page.locator('#respaldo').click();
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} copia de seguridad`);
      const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importar').click()]);
      await selector.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"roto') });
      await page.locator('#respaldo-error').waitFor({ state: 'visible' });
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} error de importación`);
      await page.keyboard.press('Escape');
      limpio(reg);
    });
    await con(PAGINAS[1], { esquema, sembrar: { [CLAVE]: JSON.stringify({ version: 1, notas: [], activa: null }) } }, async page => {
      igual((await page.evaluate(escanearContraste)).malos, [], `app ${esquema} estado vacío`);
    });
  }
});

// =================================================================================================
console.log('\n[consola, red y CSP]');

/** Recorre las funciones de la landing. */
async function recorrerLanding(page) {
  const ancho = page.viewportSize().width;
  for (const ancla of ['#principios', '#planes', '#preguntas']) {
    await page.locator(`header a[href="${ancla}"]`).first().click().catch(() => {});      // en 360 px la navegación puede ir plegada
  }
  await page.locator('.ciclo__opcion', { hasText: 'Mensual' }).click();
  await page.locator('.ciclo__opcion', { hasText: 'Anual' }).click();
  await page.locator('#planes input[name="ciclo"]:checked').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.locator('details > summary').evaluateAll(l => l.forEach(s => s.click()));
  await page.locator('details > summary').evaluateAll(l => l.forEach(s => s.click()));
  if (await page.locator('#tema').isVisible()) { await page.locator('#tema').click(); await page.locator('#tema').click(); }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  return ancho;
}
/** En pantallas pequeñas, vuelve de la nota a la lista (donde están el pie y la búsqueda). */
async function alaLista(page) { if (await page.locator('#volver').isVisible()) await page.locator('#volver').click(); }
/** Recorre las funciones de la app. */
async function recorrerApp(page, ctx) {
  const movil = page.viewportSize().width < 600;
  await page.locator('#nueva').click();
  await page.keyboard.type('# Nota de la prueba de calidad\n\n- uno\n- dos\n\n**negrita** y `código`');
  await page.keyboard.press('Alt+KeyP');
  await page.keyboard.press('Alt+KeyP');
  await alaLista(page);
  await page.locator('#busqueda').fill('calidad');
  await page.locator('#busqueda').fill('nada de nada');
  await page.locator('#borrar-busqueda').click();
  await page.locator('#lista [role="option"]').first().click();
  await page.keyboard.press('Alt+Backspace');
  await page.keyboard.press('Alt+KeyZ');
  await page.keyboard.press('Shift+Slash');
  if (!(await page.locator('#ayuda').evaluate(d => d.open))) { await alaLista(page); await page.locator('#atajos').click(); }
  await page.keyboard.press('Escape');
  await alaLista(page);
  for (let i = 0; i < 3; i++) await page.locator('#tema').click();
  // copia de seguridad: exportar todo, importar válido e inválido, exportar nota
  await page.locator('#respaldo').click();
  const [d1] = await Promise.all([page.waitForEvent('download'), page.locator('#exportar-todo').click()]);
  const copia = fs.readFileSync(await d1.path());
  await page.locator('#respaldo').click();
  const [s1] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importar').click()]);
  await s1.setFiles({ name: 'mala.json', mimeType: 'application/json', buffer: Buffer.from('no es json') });
  await page.locator('#respaldo-error').waitFor({ state: 'visible' });
  const [s2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importar').click()]);
  await s2.setFiles({ name: 'buena.json', mimeType: 'application/json', buffer: copia });
  await page.locator('#avisos .aviso', { hasText: 'Importación lista' }).waitFor();
  if (movil) await page.locator('#lista [role="option"]').first().click();
  await Promise.all([page.waitForEvent('download'), page.locator('#exportar-nota').click()]);
  await page.reload();
}

await prueba('consola sin errores ni avisos ni violaciones de la CSP en la landing y en la app (360 y 1440 px, claro y oscuro) tras recorrer sus funciones', async () => {
  for (const pagina of PAGINAS) {
    for (const esquema of ESQUEMAS) {
      for (const [ancho, alto] of [[360, 740], [1440, 900]]) {
        await con(pagina, { esquema, ancho, alto, sembrar: SIEMBRA }, async (page, reg, ctx) => {
          if (pagina.nombre === 'landing') await recorrerLanding(page); else await recorrerApp(page, ctx);
          igual(reg.consola, [], `consola de ${pagina.nombre} ${esquema} ${ancho}px`);
          igual(reg.errores, [], `errores de ${pagina.nombre} ${esquema} ${ancho}px`);
          igual(await page.evaluate(() => window.__csp || []), [], `violaciones de la CSP en ${pagina.nombre} ${esquema} ${ancho}px`);
        });
      }
    }
  }
});

await prueba('la CSP de ambas páginas es exactamente la de la spec y el documento declara idioma, título y viewport', async () => {
  const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'";
  for (const pagina of PAGINAS) {
    await con(pagina, {}, async page => {
      igual(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), CSP, pagina.nombre);
      igual(await page.locator('html').getAttribute('lang'), 'es');
      verdadero((await page.title()).trim().length > 0, 'título vacío');
      verdadero(/width=device-width/.test(await page.locator('meta[name="viewport"]').getAttribute('content')), 'viewport');
    });
  }
});

await prueba('cero peticiones externas: tras recorrer ambas páginas solo se pidieron archivos del propio sitio (y nada fue abortado)', async () => {
  for (const pagina of PAGINAS) {
    for (const [ancho, alto] of [[360, 740], [1440, 900]]) {
      await con(pagina, { ancho, alto, sembrar: SIEMBRA }, async (page, reg, ctx) => {
        if (pagina.nombre === 'landing') await recorrerLanding(page); else await recorrerApp(page, ctx);
        igual(reg.externas, [], `peticiones externas de ${pagina.nombre} a ${ancho}px`);
        const fuera = reg.peticiones.filter(u => !u.startsWith(srv.url + '/') && !u.startsWith('data:') && !u.startsWith('blob:'));
        igual(fuera, [], `peticiones fuera del sitio de ${pagina.nombre}`);
        const recursos = reg.peticiones.filter(u => u.startsWith(srv.url + '/') && !/\/(index|app)\.html(\?|#|$)/.test(u) && !u.endsWith('/'));
        igual(recursos, [], `${pagina.nombre} no debe cargar más archivos que su propia página (todo va en línea)`);
        const apis = await page.evaluate(() => ({ sw: 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null }));
        igual(apis.sw, null, 'sin service worker');
      });
    }
  }
});

await prueba('el código fuente no referencia recursos remotos (src, href, url(), @import, fetch, XMLHttpRequest, WebSocket, sendBeacon, importScripts)', async () => {
  const remoto = [
    ['atributo con URL remota', /\b(?:src|href|action|poster|data|srcset|formaction)\s*=\s*["']\s*(?:https?:)?\/\//gi],
    ['url() remoto', /url\(\s*["']?\s*(?:https?:)?\/\//gi],
    ['@import', /@import\b/gi],
    ['API de red', /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/g],
    ['hoja de estilo o script enlazado', /<link\b[^>]*rel=["']?(?:stylesheet|preload|prefetch|preconnect|dns-prefetch)|<script\b[^>]*\bsrc=/gi],
    ['iframe, object o embed', /<(?:iframe|object|embed)\b/gi],
  ];
  for (const a of ['index.html', 'app.html']) {
    const t = fuente(a);
    for (const [que, re] of remoto) {
      const hallados = [...t.matchAll(re)].map(m => `${a}: ${que}: ${m[0].slice(0, 60)}`);
      igual(hallados, [], `${a}: ${que}`);
    }
  }
});

// =================================================================================================
console.log('\n[anclas, hipervínculos e ids]');

/** Enlaces y referencias de la página tal como están en el DOM ahora. */
const reunirEnlaces = () => [...document.querySelectorAll('a[href]')].map(a => ({ href: a.getAttribute('href'), texto: (a.textContent || '').trim().slice(0, 40), visible: a.getClientRects().length > 0 }));
const referenciasAria = () => {
  const malas = [];
  const id = v => document.getElementById(v);
  for (const e of document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls],[aria-owns],[aria-activedescendant],[aria-details],[aria-errormessage],label[for],[list]')) {
    for (const [attr, valor] of [...e.attributes].filter(a => /^(aria-(labelledby|describedby|controls|owns|activedescendant|details|errormessage)|for|list)$/.test(a.name)).map(a => [a.name, a.value])) {
      if (attr === 'aria-controls' && e.getAttribute('aria-expanded') === 'false' && !id(valor.split(/\s+/)[0])) continue;
      for (const v of valor.split(/\s+/).filter(Boolean)) if (!id(v)) malas.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} ${attr}="${v}"`);
    }
  }
  return malas;
};
const idsRepetidos = () => { const c = {}; for (const e of document.querySelectorAll('[id]')) c[e.id] = (c[e.id] || 0) + 1; return Object.entries(c).filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`); };

await prueba('toda ancla (#...) de ambas páginas apunta a un elemento que existe, y ningún enlace es un "#" vacío o un javascript:', async () => {
  for (const pagina of PAGINAS) {
    await con(pagina, { sembrar: SIEMBRA }, async (page, reg) => {
      const estados = pagina.nombre === 'landing' ? ['Anual', 'Mensual'] : [''];
      for (const e of estados) {
        if (e) await page.locator('.ciclo__opcion', { hasText: e }).click();
        const enlaces = await page.evaluate(reunirEnlaces);
        verdadero(enlaces.length >= (pagina.nombre === 'landing' ? 10 : 1), `${pagina.nombre}: pocos enlaces (${enlaces.length})`);
        for (const l of enlaces) {
          verdadero(l.href !== '#' && l.href !== '' && !/^\s*javascript:/i.test(l.href), `${pagina.nombre}: enlace sin destino "${l.href}" (${l.texto})`);
          if (l.href.startsWith('#')) verdadero(await page.evaluate(h => !!document.getElementById(decodeURIComponent(h.slice(1))) || !!document.getElementsByName(decodeURIComponent(h.slice(1))).length, l.href), `${pagina.nombre}: el ancla ${l.href} (${l.texto}) no apunta a nada`);
        }
      }
      limpio(reg);
    });
  }
});

await prueba('todo hipervínculo interno entre páginas (app.html, index.html, con consulta o ancla) resuelve: el archivo existe, el ancla existe allí y la consulta de plan es válida', async () => {
  const PLANES = ['semilla', 'brote', 'bosque'], CICLOS = ['mensual', 'anual'];
  const ids = {};
  const idsDe = a => ids[a] || (ids[a] = new Set([...fuente(a).matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1])));
  const recogidos = new Set();
  for (const pagina of PAGINAS) {
    await con(pagina, { sembrar: SIEMBRA }, async (page, reg, ctx) => {
      const estados = pagina.nombre === 'landing' ? ['Anual', 'Mensual'] : [''];
      for (const e of estados) {
        if (e) await page.locator('.ciclo__opcion', { hasText: e }).click();
        for (const l of await page.evaluate(reunirEnlaces)) if (!l.href.startsWith('#')) recogidos.add(`${pagina.nombre}|${l.href}`);
      }
      // Los enlaces que están dentro de <noscript> no están en el DOM con JavaScript: se leen del código fuente.
      if (pagina.nombre === 'landing') for (const m of fuente('index.html').matchAll(/<noscript>[\s\S]*?<\/noscript>/g)) for (const h of m[0].matchAll(/href="([^"]+)"/g)) recogidos.add(`landing|${h[1].replace(/&amp;/g, '&')}`);
    });
  }
  verdadero(recogidos.size >= 4, 'se esperaban varios enlaces entre páginas');
  const cliente = (await navegador.newContext()).request;
  for (const clave of recogidos) {
    const [origen, href] = clave.split('|');
    if (/^(mailto:|tel:)/i.test(href)) continue;
    if (/^(https?:)?\/\//i.test(href)) continue;                                   // los externos se registran aparte
    const u = new URL(href, srv.url + '/' + (origen === 'landing' ? 'index.html' : 'app.html'));
    const archivo = u.pathname.replace(/^\//, '') || 'index.html';
    const r = await cliente.get(srv.url + u.pathname);
    igual(r.status(), 200, `${origen}: "${href}" no resuelve (${u.pathname})`);
    if (u.hash) verdadero(idsDe(archivo).has(decodeURIComponent(u.hash.slice(1))), `${origen}: "${href}": el ancla ${u.hash} no existe en ${archivo}`);
    if (u.searchParams.has('plan') || u.searchParams.has('ciclo')) {
      verdadero(PLANES.includes(u.searchParams.get('plan')) && CICLOS.includes(u.searchParams.get('ciclo')) && [...u.searchParams.keys()].length === 2, `${origen}: "${href}": la app no aceptaría esos parámetros`);
    }
  }
  console.log(`        enlaces entre páginas comprobados: ${recogidos.size}`);
});

await prueba('cada enlace "Elegir ..." de la landing abre la app y esta muestra exactamente el plan y el ciclo elegidos', async () => {
  const NOMBRES = { semilla: 'Semilla', brote: 'Brote', bosque: 'Bosque' };
  for (const ciclo of ['mensual', 'anual']) {
    const hrefs = await con(PAGINAS[0], {}, async page => {
      await page.locator('.ciclo__opcion', { hasText: ciclo === 'mensual' ? 'Mensual' : 'Anual' }).click();
      return page.locator('#planes a[href^="app.html?"]').evaluateAll(l => l.map(a => a.getAttribute('href')));
    });
    verdadero(hrefs.length >= 3, `faltan enlaces de plan en ciclo ${ciclo}`);
    const vistos = new Set();
    for (const href of hrefs) {
      const q = new URL(href, srv.url + '/index.html').searchParams;
      const plan = q.get('plan');
      if (q.get('ciclo') !== ciclo || vistos.has(plan)) continue;
      vistos.add(plan);
      await con(PAGINAS[1], { consulta: href.slice('app.html'.length) }, async (page, reg) => {
        const t = (await page.locator('#plan').textContent()).replace(/\s+/g, ' ');
        verdadero(t.includes(`Plan ${NOMBRES[plan]}, ${ciclo} · demostración`), `"${href}" -> "${t}"`);
        limpio(reg);
      });
    }
    igual([...vistos].sort(), ['bosque', 'brote', 'semilla'], `en ciclo ${ciclo} deben estar los tres planes`);
  }
});

await prueba('ids únicos y referencias ARIA (aria-labelledby, aria-controls, for, ...) que apuntan a algo, en todos los estados de ambas páginas', async () => {
  for (const pagina of PAGINAS) {
    await con(pagina, { sembrar: SIEMBRA, consulta: pagina.nombre === 'app' ? '?plan=brote&ciclo=anual' : '' }, async (page, reg, ctx) => {
      const revisar = async estado => {
        igual(await page.evaluate(idsRepetidos), [], `${pagina.nombre}: ids repetidos (${estado})`);
        igual(await page.evaluate(referenciasAria), [], `${pagina.nombre}: referencias ARIA rotas (${estado})`);
      };
      await revisar('inicio');
      if (pagina.nombre === 'landing') {
        await page.locator('.ciclo__opcion', { hasText: 'Mensual' }).click(); await revisar('mensual');
        await page.locator('details > summary').evaluateAll(l => l.forEach(s => s.click())); await revisar('preguntas abiertas');
      } else {
        await page.locator('#nueva').click(); await page.keyboard.type('Otra nota'); await revisar('nota nueva');
        await page.keyboard.press('Alt+KeyP'); await revisar('vista previa');
        await page.keyboard.press('Alt+Backspace'); await revisar('con aviso de deshacer');
        await page.locator('#atajos').click(); await revisar('ayuda'); await page.keyboard.press('Escape');
        await page.locator('#respaldo').click(); await revisar('copia de seguridad');
        const [s] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importar').click()]);
        await s.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"roto') });
        await page.locator('#respaldo-error').waitFor({ state: 'visible' }); await revisar('error de importación');
      }
      limpio(reg);
    });
  }
});

// =================================================================================================
console.log('\n[accesibilidad básica]');

// Roles que, según WAI-ARIA, necesitan un nombre accesible (los controles, las imágenes, los diálogos y las regiones).
const ROLES_QUE_PIDEN_NOMBRE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'option', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'slider', 'spinbutton', 'img', 'dialog', 'region']);
/** Pide a Chromium su árbol de accesibilidad y devuelve los controles (y regiones con nombre obligatorio) sin nombre. */
async function sinNombreAccesible(page, ctx) {
  const cdp = await ctx.newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('Accessibility.enable');
    // La primera consulta tras habilitar el dominio puede devolver nodos recién creados todavía sin nombre calculado
    // (Chromium construye el árbol de forma perezosa); la segunda ya es la definitiva. Un control realmente sin nombre
    // seguiría vacío en las dos.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await cdp.send('Accessibility.getFullAXTree');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const malos = [];
    let revisados = 0;
    for (const n of nodes) {
      if (n.ignored || !n.role || !ROLES_QUE_PIDEN_NOMBRE.has(n.role.value)) continue;
      revisados++;
      const nombre = n.name && typeof n.name.value === 'string' ? n.name.value.trim() : '';
      if (nombre) continue;
      let desc = n.role.value;
      try { const { node } = await cdp.send('DOM.describeNode', { backendNodeId: n.backendDOMNodeId }); desc += ` <${node.nodeName.toLowerCase()} ${(node.attributes || []).slice(0, 6).join(' ')}>`; } catch (e) { /* sin detalle */ }
      malos.push(desc);
    }
    return { malos, revisados };
  } finally { await cdp.detach(); }
}

await prueba('todos los controles de ambas páginas tienen nombre accesible según el árbol de accesibilidad de Chromium (inicio, diálogos abiertos, avisos, 360 y 1440 px)', async () => {
  for (const pagina of PAGINAS) {
    for (const [ancho, alto] of [[360, 740], [1440, 900]]) {
      await con(pagina, { ancho, alto, sembrar: SIEMBRA, consulta: pagina.nombre === 'app' ? '?plan=brote&ciclo=anual' : '' }, async (page, reg, ctx) => {
        let r = await sinNombreAccesible(page, ctx);
        verdadero(r.revisados > 8, `${pagina.nombre}: se revisaron muy pocos nodos (${r.revisados})`);
        igual(r.malos, [], `${pagina.nombre} ${ancho}px: inicio`);
        if (pagina.nombre === 'landing') {
          await page.locator('.ciclo__opcion', { hasText: 'Mensual' }).click();
          await page.locator('details > summary').evaluateAll(l => l.forEach(s => s.click()));
          igual((await sinNombreAccesible(page, ctx)).malos, [], `landing ${ancho}px: mensual y preguntas abiertas`);
        } else {
          await page.locator('#lista [data-id="md"]').click();
          await page.keyboard.press('Alt+KeyP');
          igual((await sinNombreAccesible(page, ctx)).malos, [], `app ${ancho}px: vista previa`);
          await page.keyboard.press('Alt+Backspace');
          igual((await sinNombreAccesible(page, ctx)).malos, [], `app ${ancho}px: aviso Deshacer`);
          await page.keyboard.press('Alt+KeyZ');
          if (ancho < 600) await page.locator('#volver').click();
          await page.locator('#atajos').click();
          igual((await sinNombreAccesible(page, ctx)).malos, [], `app ${ancho}px: ayuda`);
          await page.keyboard.press('Escape');
          await page.locator('#respaldo').click();
          igual((await sinNombreAccesible(page, ctx)).malos, [], `app ${ancho}px: copia de seguridad`);
          const [s] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importar').click()]);
          await s.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"roto') });
          await page.locator('#respaldo-error').waitFor({ state: 'visible' });
          igual((await sinNombreAccesible(page, ctx)).malos, [], `app ${ancho}px: error de importación`);
          await page.keyboard.press('Escape');
          await page.evaluate(k => localStorage.setItem(k, '{roto'), CLAVE);
          await page.reload();
          igual((await sinNombreAccesible(page, ctx)).malos, [], `app ${ancho}px: aviso de datos dañados`);
        }
        limpio(reg);
      });
    }
  }
});

await prueba('jerarquía de títulos: un solo h1 visible, sin saltos de nivel, imágenes con alt, idioma y título de página', async () => {
  for (const pagina of PAGINAS) {
    for (const [ancho, alto] of [[360, 740], [1440, 900]]) {
      await con(pagina, { ancho, alto, sembrar: SIEMBRA }, async (page, reg) => {
        const info = await page.evaluate(() => {
          const visibles = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h => h.getClientRects().length && !h.closest('[hidden]'));
          return {
            niveles: visibles.map(h => Number(h.tagName[1])), textos: visibles.map(h => h.textContent.trim().slice(0, 30)),
            sinAlt: [...document.querySelectorAll('img:not([alt]), area:not([alt]), input[type="image"]:not([alt])')].map(e => e.outerHTML.slice(0, 60)),
            svgSueltos: [...document.querySelectorAll('svg')].filter(s => !s.closest('[aria-hidden="true"]') && !s.getAttribute('role') && !s.getAttribute('aria-label') && !s.querySelector('title')).length,
            tablasSinTitulo: [...document.querySelectorAll('table')].filter(t => t.getClientRects().length && !t.querySelector('caption') && !t.getAttribute('aria-label') && !t.getAttribute('aria-labelledby')).length,
          };
        });
        igual(info.niveles.filter(n => n === 1).length, 1, `${pagina.nombre}: debe haber exactamente un h1 visible (${info.textos})`);
        for (let i = 1; i < info.niveles.length; i++) verdadero(info.niveles[i] - info.niveles[i - 1] <= 1, `${pagina.nombre}: salto de h${info.niveles[i - 1]} a h${info.niveles[i]} ("${info.textos[i]}")`);
        igual(info.sinAlt, [], `${pagina.nombre}: imágenes sin alt`);
        igual(info.svgSueltos, 0, `${pagina.nombre}: SVG que no son decorativos ni tienen nombre`);
        igual(info.tablasSinTitulo, 0, `${pagina.nombre}: tablas sin caption ni nombre`);
        limpio(reg);
      });
    }
  }
});

await prueba('puntos de referencia: ambas páginas tienen un main, navegación con nombre y enlace "Saltar al contenido" que lleva al contenido', async () => {
  for (const pagina of PAGINAS) {
    await con(pagina, { sembrar: SIEMBRA }, async page => {
      igual(await page.locator('main').count(), 1, `${pagina.nombre}: debe haber un solo main`);
      verdadero(await page.locator('nav[aria-label], nav[aria-labelledby]').count() >= 1, `${pagina.nombre}: la navegación debe tener nombre`);
      await page.keyboard.press('Tab');
      igual(await page.evaluate(() => document.activeElement.textContent.trim()), 'Saltar al contenido', `${pagina.nombre}: primer Tab`);
      const destino = await page.evaluate(() => document.activeElement.getAttribute('href'));
      verdadero(await page.evaluate(h => !!document.getElementById(h.slice(1)), destino), `${pagina.nombre}: el salto apunta a ${destino}`);
    });
  }
});

await prueba('hay reglas de prefers-reduced-motion y de foco visible en ambas páginas', async () => {
  for (const a of ['index.html', 'app.html']) {
    const t = fuente(a);
    verdadero(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(t), `${a}: falta prefers-reduced-motion`);
    verdadero(/:focus-visible/.test(t), `${a}: falta :focus-visible`);
  }
});

// =================================================================================================
console.log('\n[sin scroll horizontal]');

/** Mide el desbordamiento horizontal del documento y de cualquier elemento que se salga por la derecha sin estar dentro de un contenedor que se desplaza. */
const medirDesborde = () => {
  const ancho = document.documentElement.clientWidth;
  const sale = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.right <= ancho + 1 && r.left >= -1) continue;
    let recortado = false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { recortado = true; break; }
      if (cs.position === 'fixed') break;
    }
    if (e.closest('.defs-svg, .solo-lector, .salto')) continue;                    // elementos ocultos a propósito fuera de la pantalla
    if (!recortado) sale.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(' ')[0]} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return {
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cuerpo: document.body.scrollWidth - document.body.clientWidth,
    sale: sale.slice(0, 8),
  };
};

await prueba('landing: sin scroll horizontal en 360, 768 y 1440 px, claro y oscuro, en ciclo mensual y anual y con las preguntas abiertas', async () => {
  for (const [ancho, alto] of ANCHOS) {
    for (const esquema of ESQUEMAS) {
      await con(PAGINAS[0], { ancho, alto, esquema }, async (page, reg) => {
        for (const ciclo of ['Anual', 'Mensual']) {
          await page.locator('.ciclo__opcion', { hasText: ciclo }).click();
          igual(await page.evaluate(medirDesborde), { doc: 0, cuerpo: 0, sale: [] }, `landing ${ancho}px ${esquema} ${ciclo}`);
        }
        await page.locator('details > summary').evaluateAll(l => l.forEach(s => s.click()));
        igual(await page.evaluate(medirDesborde), { doc: 0, cuerpo: 0, sale: [] }, `landing ${ancho}px ${esquema} con preguntas abiertas`);
        limpio(reg);
      });
    }
  }
});

await prueba('app: sin scroll horizontal en 360, 768 y 1440 px, claro y oscuro, en lista, editor, vista previa, diálogos, avisos, sin resultados y estado vacío', async () => {
  const largo = 'x'.repeat(3000);
  const tabla = '| ' + Array.from({ length: 14 }, (_, i) => 'columna' + i).join(' | ') + ' |\n|' + ' - |'.repeat(14);
  const notas = [...NOTAS, nota('ancha', '# ' + largo + '\n\n' + largo + '\n\n' + tabla + '\n\n```\n' + 'código muy largo '.repeat(40) + '\n```', T0 - 4 * HORA)];
  for (const [ancho, alto] of ANCHOS) {
    for (const esquema of ESQUEMAS) {
      await con(PAGINAS[1], { ancho, alto, esquema, consulta: '?plan=bosque&ciclo=anual', sembrar: { [CLAVE]: JSON.stringify({ version: 1, notas, activa: 'ancha' }) } }, async (page, reg) => {
        const ok = async estado => igual(await page.evaluate(medirDesborde), { doc: 0, cuerpo: 0, sale: [] }, `app ${ancho}px ${esquema}: ${estado}`);
        await ok('lista' + (ancho < 600 ? '' : ' y editor'));
        await page.locator('#lista [data-id="ancha"]').click();
        await ok('editor');
        await page.keyboard.press('Alt+KeyP');
        await ok('vista previa');
        await page.keyboard.press('Alt+KeyP');
        await page.keyboard.press('Alt+Backspace');
        await ok('aviso de deshacer');
        await page.keyboard.press('Alt+KeyZ');
        await alaLista(page);
        await page.locator('#atajos').click();
        await ok('ayuda');
        await page.keyboard.press('Escape');
        await page.locator('#respaldo').click();
        await ok('copia de seguridad');
        const [s] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importar').click()]);
        await s.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"roto') });
        await page.locator('#respaldo-error').waitFor({ state: 'visible' });
        await ok('error de importación');
        await page.keyboard.press('Escape');
        await page.locator('#busqueda').fill('zzzz');
        await ok('sin resultados');
        limpio(reg);
      });
      await con(PAGINAS[1], { ancho, alto, esquema, sembrar: { [CLAVE]: JSON.stringify({ version: 1, notas: [], activa: null }) } }, async page => {
        igual(await page.evaluate(medirDesborde), { doc: 0, cuerpo: 0, sale: [] }, `app ${ancho}px ${esquema}: estado vacío`);
      });
    }
  }
});

await prueba('app: la barra superior, el pie y los avisos no desbordan en anchos intermedios (320, 480, 599, 600, 700, 899, 900 y 1024 px)', async () => {
  for (const ancho of [320, 480, 599, 600, 700, 899, 900, 1024]) {
    await con(PAGINAS[1], { ancho, alto: 800, consulta: '?plan=bosque&ciclo=mensual', sembrar: SIEMBRA }, async (page, reg) => {
      igual(await page.evaluate(medirDesborde), { doc: 0, cuerpo: 0, sale: [] }, `app ${ancho}px lista`);
      if (ancho < 600) await page.locator('#lista [data-id="arbol"]').click();
      igual(await page.evaluate(medirDesborde), { doc: 0, cuerpo: 0, sale: [] }, `app ${ancho}px editor`);
      limpio(reg);
    });
  }
});

await cerrar();
await srv.cerrar();
process.exitCode = resumen('calidad');
