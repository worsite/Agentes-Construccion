// Pruebas unitarias del núcleo puro de Ceiba (window.Ceiba en ceiba/app.html).
// Ejecutar: node ceiba/tests/unit.mjs
// Cada caso corre en Chromium real con Playwright (page.evaluate sobre window.Ceiba).
import { servir, lanzar, prueba, resumen, igual, verdadero } from './helpers.mjs';

const srv = await servir();
const { navegador, cerrar } = await lanzar();
const tiempos = [];

async function abrir(opciones = {}) {
  const contexto = await navegador.newContext({ locale: 'es-ES', timezoneId: 'America/Bogota', ...opciones });
  const pagina = await contexto.newPage();
  const registro = [];
  pagina.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') registro.push(`${m.type()}: ${m.text()}`); });
  pagina.on('pageerror', e => registro.push(`pageerror: ${e.message}`));
  await pagina.goto(`${srv.url}/app.html`);
  return { contexto, pagina, registro };
}

// Asistentes que solo existen en la página de pruebas (no forman parte del producto).
const ASISTENTES = () => {
  window.__profundidad = el => {
    let max = 0; const pila = [[el, 0]];
    while (pila.length) { const [n, d] = pila.pop(); if (d > max) max = d; for (const h of n.children) pila.push([h, d + 1]); }
    return max;
  };
  window.__escanear = el => {
    const etiquetas = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'STRONG', 'EM', 'DEL', 'CODE', 'PRE',
      'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'INPUT', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
    const atributos = new Set(['href', 'target', 'rel', 'title', 'class', 'type', 'disabled', 'checked', 'aria-label', 'scope', 'style', 'start']);
    const problemas = [];
    for (const e of el.querySelectorAll('*')) {
      if (!etiquetas.has(e.tagName)) problemas.push(`etiqueta ${e.tagName}`);
      for (const a of e.attributes) if (!atributos.has(a.name)) problemas.push(`atributo ${a.name}`);
      if (e.tagName === 'A') {
        const h = e.getAttribute('href');
        if (!/^(https?:\/\/|mailto:|#)/i.test(h)) problemas.push(`href ${h}`);
      }
      if (e.hasAttribute('style') && !/^text-align: (left|right|center);$/.test(e.getAttribute('style'))) problemas.push('style raro');
      if (e.tagName === 'A' && e.querySelector('a')) problemas.push('enlace anidado');
    }
    return problemas;
  };
};

try {
  const { pagina, registro } = await abrir();
  await pagina.evaluate(ASISTENTES);

  const llamar = (nombre, ...args) => pagina.evaluate(([n, a]) => window.Ceiba[n](...a), [nombre, args]);
  const R = md => pagina.evaluate(s => window.Ceiba.renderMarkdown(s).innerHTML, md);
  const F = '```';

  // ------------------------------------------------------------------ página y espacio de nombres
  console.log('\n[cabecera y espacio de nombres]');
  await prueba('el documento declara idioma, juego de caracteres, viewport y título', async () => {
    const d = await pagina.evaluate(() => ({
      lang: document.documentElement.lang,
      charset: document.characterSet,
      metaCharset: !!document.querySelector('meta[charset]'),
      viewport: document.querySelector('meta[name="viewport"]')?.content,
      titulo: document.title,
    }));
    igual(d.lang, 'es');
    igual(d.charset, 'UTF-8');
    verdadero(d.metaCharset, 'falta <meta charset>');
    igual(d.viewport, 'width=device-width, initial-scale=1');
    igual(d.titulo, 'Ceiba');
  });
  await prueba('la CSP coincide con la sección 2 de la spec', async () => {
    const csp = await pagina.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content);
    igual(csp, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'");
  });
  await prueba('la CSP precede a cualquier script', async () => {
    const orden = await pagina.evaluate(() => {
      const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const s = document.querySelector('script');
      return !!csp && !!s && !!(csp.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    verdadero(orden, 'la meta CSP debe aparecer antes del primer script');
  });
  await prueba('window.Ceiba expone exactamente las 11 funciones puras y está congelado', async () => {
    const d = await pagina.evaluate(() => ({
      claves: Object.keys(window.Ceiba).sort(),
      tipos: Object.values(window.Ceiba).map(f => typeof f),
      congelado: Object.isFrozen(window.Ceiba),
    }));
    igual(d.claves, ['coincide', 'escapar', 'extracto', 'fechaCompleta', 'nombreArchivo', 'normalizar', 'renderMarkdown',
      'tiempoRelativo', 'titulo', 'urlSegura', 'validarImportacion']);
    verdadero(d.tipos.every(t => t === 'function'), 'todo debe ser función');
    verdadero(d.congelado, 'Ceiba debe estar congelado');
  });
  await prueba('la carga no produce errores ni avisos de consola (incluye violaciones de CSP)', async () => {
    igual(registro, []);
  });

  // ------------------------------------------------------------------ escapar
  console.log('\n[escapar]');
  await prueba('escapa & < > " \'', async () => {
    igual(await llamar('escapar', '<script>alert("x")&\'</script>'), '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;');
  });
  await prueba('no protege contra doble escape (es escape, no saneo)', async () => {
    igual(await llamar('escapar', '&amp;'), '&amp;amp;');
  });
  await prueba('texto sin caracteres especiales queda igual, incluidas tildes', async () => {
    igual(await llamar('escapar', 'Canción de niños: ¿qué tal?'), 'Canción de niños: ¿qué tal?');
  });
  await prueba('null, undefined y objetos dan cadena vacía; números se convierten', async () => {
    igual(await llamar('escapar', null), '');
    igual(await llamar('escapar', undefined), '');
    igual(await llamar('escapar', 42), '42');
    igual(await pagina.evaluate(() => window.Ceiba.escapar({})), '');
  });
  await prueba('es seguro en contexto de texto y de atributo entre comillas dobles y simples', async () => {
    const r = await pagina.evaluate(() => {
      const hostiles = ['"><img src=x onerror=alert(1)>', "'><script>alert(1)</script>", '&lt;b&gt;', '`x`', 'a"b\'c<d>e&f', '</p><p onclick=1>'];
      const fallas = [];
      for (const s of hostiles) {
        for (const q of ['"', "'"]) {
          const d = document.createElement('div');
          d.innerHTML = `<p title=${q}${window.Ceiba.escapar(s)}${q}>${window.Ceiba.escapar(s)}</p>`;
          const p = d.firstChild;
          if (d.querySelectorAll('*').length !== 1 || p.getAttribute('title') !== s || p.textContent !== s || p.attributes.length !== 1) fallas.push(s);
        }
      }
      return fallas;
    });
    igual(r, []);
  });

  // ------------------------------------------------------------------ titulo
  console.log('\n[titulo]');
  const casosTitulo = [
    ['quita # y espacios iniciales', '# Hola mundo', 'Hola mundo'],
    ['varios # y sangría', '   ## Con sangría', 'Con sangría'],
    ['usa la primera línea no vacía', '\n\n  \nPrimera línea\nsegunda', 'Primera línea'],
    ['CRLF', '\r\n# Hola\r\nx', 'Hola'],
    ['CR solo', '\r# Hola', 'Hola'],
    ['almohadilla pegada se quita igual (spec)', '#hashtag', 'hashtag'],
    ['recorta espacios finales', '# Hola   ', 'Hola'],
    ['conserva tabulaciones internas', 'Con\ttab', 'Con\ttab'],
    ['vacío', '', 'Sin título'],
    ['solo espacios y saltos', '   \n\t\n', 'Sin título'],
    ['solo almohadillas', '###', 'Sin título'],
    ['almohadilla y espacio', '# ', 'Sin título'],
    ['no deriva del cuerpo si la primera línea es solo #', '#\ncuerpo', 'Sin título'],
  ];
  for (const [n, entrada, esperado] of casosTitulo) await prueba(`titulo: ${n}`, async () => igual(await llamar('titulo', entrada), esperado));
  await prueba('titulo: null, undefined y objetos dan "Sin título"', async () => {
    igual(await llamar('titulo', null), 'Sin título');
    igual(await llamar('titulo', undefined), 'Sin título');
    igual(await pagina.evaluate(() => window.Ceiba.titulo({})), 'Sin título');
  });
  await prueba('titulo: máximo 80 caracteres (80 exactos se conservan, 81 se cortan)', async () => {
    igual((await llamar('titulo', 'a'.repeat(80))).length, 80);
    igual((await llamar('titulo', 'a'.repeat(81))).length, 80);
    igual((await llamar('titulo', 'a'.repeat(5000))).length, 80);
  });
  await prueba('titulo: tras cortar se recortan los espacios finales', async () => {
    igual(await llamar('titulo', 'a'.repeat(79) + ' b'), 'a'.repeat(79));
  });
  await prueba('titulo: no parte pares sustitutos al cortar', async () => {
    const t = await pagina.evaluate(() => window.Ceiba.titulo('x'.repeat(79) + '\u{1D400}\u{1D400}'));
    igual(Array.from(t).length, 80);
    verdadero(!/[\ud800-\udbff]$/.test(t), 'termina en mitad de un par sustituto');
  });
  await prueba('titulo: línea de 1 MB se resuelve en menos de 100 ms', async () => {
    const r = await pagina.evaluate(() => { const s = '# ' + 'x'.repeat(1e6); const t0 = performance.now(); const t = window.Ceiba.titulo(s); return { ms: performance.now() - t0, len: t.length }; });
    igual(r.len, 80);
    verdadero(r.ms < 100, `tardó ${r.ms} ms`);
  });
  await prueba('titulo: 1 MB de saltos de línea y luego una palabra', async () => {
    const r = await pagina.evaluate(() => { const s = '\n'.repeat(1e6) + 'fin'; const t0 = performance.now(); const t = window.Ceiba.titulo(s); return { ms: performance.now() - t0, t }; });
    igual(r.t, 'fin');
    verdadero(r.ms < 200, `tardó ${r.ms} ms`);
  });

  // ------------------------------------------------------------------ extracto
  console.log('\n[extracto]');
  const casosExtracto = [
    ['primera línea con texto tras el título', '# T\n\nPrimer párrafo\nsegundo', 'Primer párrafo'],
    ['solo título', '# T', ''],
    ['vacío', '', ''],
    ['salta líneas en blanco y recorta', 'T\n   \n\n  cuerpo  ', 'cuerpo'],
    ['CRLF', 'T\r\n\r\ncuerpo', 'cuerpo'],
    ['si la primera línea es solo #, el cuerpo es el extracto', '#\ncuerpo', 'cuerpo'],
    ['conserva los marcadores de markdown tal cual', 'T\n- elemento', '- elemento'],
  ];
  for (const [n, entrada, esperado] of casosExtracto) await prueba(`extracto: ${n}`, async () => igual(await llamar('extracto', entrada), esperado));
  await prueba('extracto: máximo 120 caracteres', async () => {
    igual((await llamar('extracto', 'T\n' + 'b'.repeat(5000))).length, 120);
    igual((await llamar('extracto', 'T\n' + 'b'.repeat(120))).length, 120);
  });
  await prueba('extracto: null y undefined dan cadena vacía', async () => {
    igual(await llamar('extracto', null), '');
    igual(await llamar('extracto', undefined), '');
  });

  // ------------------------------------------------------------------ normalizar
  console.log('\n[normalizar]');
  const casosNorm = [
    ['quita tildes y pasa a minúsculas', 'Canción', 'cancion'],
    ['eñe y mayúsculas', 'ÑANDÚ', 'nandu'],
    ['varias palabras', 'Árbol Ñu', 'arbol nu'],
    ['vocales con diéresis y grave', 'ÀÉÎÕÜ', 'aeiou'],
    ['marca combinante suelta', 'e\u0301', 'e'],
    ['vacío', '', ''],
    ['conserva otros alfabetos en minúscula', 'Привет', 'привет'],
    ['conserva signos y números', 'A-1, B_2!', 'a-1, b_2!'],
  ];
  for (const [n, entrada, esperado] of casosNorm) await prueba(`normalizar: ${n}`, async () => igual(await llamar('normalizar', entrada), esperado));
  await prueba('normalizar: null y undefined dan cadena vacía; idempotente; no lanza con sustitutos sueltos', async () => {
    igual(await llamar('normalizar', null), '');
    igual(await llamar('normalizar', undefined), '');
    const r = await pagina.evaluate(() => {
      const N = window.Ceiba.normalizar;
      const xs = ['Canción ÑANDÚ', 'İstanbul', 'ǅ', 'a\ud800b'];
      return xs.every(x => N(N(x)) === N(x)) && typeof N('\ud800') === 'string';
    });
    verdadero(r);
  });

  // ------------------------------------------------------------------ coincide
  console.log('\n[coincide]');
  const casosCoincide = [
    ['palabra única sin distinguir mayúsculas', 'Receta de arroz con coco', 'ARROZ', true],
    ['todas las palabras, en cualquier orden', 'Receta de arroz con coco', 'coco arroz', true],
    ['falta una palabra', 'Receta de arroz con coco', 'arroz pollo', false],
    ['consulta vacía coincide con todo', 'lo que sea', '', true],
    ['consulta de espacios coincide con todo', 'lo que sea', '   \t ', true],
    ['sin tildes en la consulta', 'Canción de cuna', 'cancion', true],
    ['sin tildes en el texto', 'cancion de cuna', 'CANCIÓN', true],
    ['eñe equivale a n (normalización NFD)', 'El año pasado', 'ano', true],
    ['espacios múltiples entre palabras', 'arroz con coco', 'arroz    coco', true],
    ['coincide por subcadena', 'programación', 'gram', true],
    ['metacaracteres de regex se tratan como texto', 'a(b', 'a(b', true],
    ['asterisco literal presente', '2*3', '*', true],
    ['asterisco literal ausente', '23', '*', false],
    ['corchete suelto no lanza', 'x', '[', false],
    ['barra invertida literal', 'ruta\\dir', '\\', true],
    ['busca en título y cuerpo', '# Título secreto\n\ncuerpo largo', 'secreto cuerpo', true],
  ];
  for (const [n, texto, q, esperado] of casosCoincide) {
    await prueba(`coincide: ${n}`, async () => igual(await pagina.evaluate(([t, c]) => window.Ceiba.coincide({ texto: t }, c), [texto, q]), esperado));
  }
  await prueba('coincide: consulta undefined o null equivale a vacía; nota sin texto no lanza', async () => {
    verdadero(await pagina.evaluate(() => window.Ceiba.coincide({ texto: 'x' }, undefined)));
    verdadero(await pagina.evaluate(() => window.Ceiba.coincide({ texto: 'x' }, null)));
    igual(await pagina.evaluate(() => window.Ceiba.coincide({}, 'a')), false);
    igual(await pagina.evaluate(() => window.Ceiba.coincide({}, '')), true);
    igual(await pagina.evaluate(() => window.Ceiba.coincide(null, 'a')), false);
  });
  await prueba('coincide: nota de 200 KB con tres palabras en menos de 50 ms', async () => {
    const r = await pagina.evaluate(() => {
      const texto = ('Lorem ipsum dolor sit amet, canción de niños. ').repeat(4500) + ' final';
      const t0 = performance.now(); const ok = window.Ceiba.coincide({ texto }, 'CANCION niños final'); return { ms: performance.now() - t0, ok, len: texto.length };
    });
    verdadero(r.len >= 200000);
    verdadero(r.ok);
    verdadero(r.ms < 50, `tardó ${r.ms} ms`);
  });

  // ------------------------------------------------------------------ tiempoRelativo y fechaCompleta
  console.log('\n[tiempoRelativo y fechaCompleta]');
  const loc = (y, m, d, h = 0, mi = 0, s = 0) => pagina.evaluate(a => new Date(...a).getTime(), [y, m, d, h, mi, s]);
  const AHORA = await loc(2026, 9, 16, 10, 32, 0); // 16 oct 2026, 10:32 hora local de la página
  const MIN = 60000, H = 3600000, DIA = 86400000;
  const TR = (ms, ahora = AHORA, l) => pagina.evaluate(([a, b, c]) => c === undefined ? window.Ceiba.tiempoRelativo(a, b) : window.Ceiba.tiempoRelativo(a, b, c), [ms, ahora, l]);
  const casosTR = [
    ['ahora mismo (mismo instante)', AHORA, 'ahora mismo'],
    ['ahora mismo (30 s)', AHORA - 30000, 'ahora mismo'],
    ['ahora mismo (59,9 s)', AHORA - 59900, 'ahora mismo'],
    ['1 minuto', AHORA - MIN, 'hace 1 min'],
    ['3 minutos', AHORA - 3 * MIN, 'hace 3 min'],
    ['59 minutos', AHORA - 59 * MIN - 59000, 'hace 59 min'],
    ['1 hora', AHORA - H, 'hace 1 h'],
    ['3 horas', AHORA - 3 * H, 'hace 3 h'],
    ['23 horas y 59 minutos', AHORA - 23 * H - 59 * MIN, 'hace 23 h'],
    ['exactamente 24 horas es ayer', AHORA - DIA, 'ayer'],
    ['ayer por la mañana', await loc(2026, 9, 15, 9, 0), 'ayer'],
    ['ayer a primera hora', await loc(2026, 9, 15, 0, 5), 'ayer'],
    ['anteayer por la noche es fecha corta', await loc(2026, 9, 14, 23, 59), '14 oct'],
    ['hace una semana', await loc(2026, 9, 9, 8, 0), '9 oct'],
    ['mismo año, otro mes', await loc(2026, 0, 5, 12, 0), '5 ene'],
    ['otro año añade el año', await loc(2025, 11, 31, 12, 0), '31 dic 2025'],
    ['futuro cercano (30 s) es ahora mismo', AHORA + 30000, 'ahora mismo'],
    ['futuro de 2 horas muestra fecha corta', AHORA + 2 * H, '16 oct'],
    ['futuro de 3 días muestra fecha corta', await loc(2026, 9, 19, 10, 32), '19 oct'],
    ['futuro de otro año añade el año', await loc(2027, 2, 1, 8, 0), '1 mar 2027'],
  ];
  for (const [n, ms, esperado] of casosTR) await prueba(`tiempoRelativo: ${n}`, async () => igual(await TR(ms), esperado));
  await prueba('tiempoRelativo: valores no válidos dan cadena vacía', async () => {
    for (const v of [NaN, Infinity, -Infinity, 8.64e15 + 1, '123', null, undefined, {}]) {
      const r = await pagina.evaluate(([x, a]) => window.Ceiba.tiempoRelativo(x, a), [v, AHORA]);
      igual(r, '', `con ${String(v)}`);
    }
  });
  await prueba('tiempoRelativo: nunca produce números negativos ni texto raro (barrido -10 a +10 días)', async () => {
    const malas = await pagina.evaluate(ahora => {
      const out = []; let x = 7;
      for (let i = 0; i < 4000; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        const delta = Math.floor((x / 0x7fffffff - 0.5) * 20 * 86400000);
        const r = window.Ceiba.tiempoRelativo(ahora + delta, ahora);
        if (!r || /-\d|NaN|undefined|null|Invalid/i.test(r) || r.startsWith('hace -')) out.push([delta, r]);
      }
      return out.slice(0, 5);
    }, AHORA);
    igual(malas, []);
  });
  await prueba('tiempoRelativo: el parámetro loc cambia solo la fecha corta; uno inválido cae a es', async () => {
    const viejo = await loc(2026, 0, 5, 12, 0);
    const es = await TR(viejo, AHORA, 'es');
    igual(es, await TR(viejo, AHORA));
    const en = await TR(viejo, AHORA, 'en');
    verdadero(/Jan/.test(en) && en !== es, `en: ${en}`);
    igual(await TR(viejo, AHORA, 'xx-no-valido-!!'), es);
    igual(await TR(AHORA - 3 * MIN, AHORA, 'en'), 'hace 3 min');
  });
  await prueba('tiempoRelativo: ayer y fecha corta no dependen del huso horario ni del cambio de hora', async () => {
    const { contexto, pagina: p2 } = await abrir({ timezoneId: 'Europe/Madrid' });
    // En Madrid el 25 oct 2026 se retrasa el reloj: ese día dura 25 horas.
    const r = await p2.evaluate(() => {
      const L = (y, m, d, h, mi) => new Date(y, m, d, h, mi).getTime();
      const ahora = L(2026, 9, 26, 9, 0);
      return [
        window.Ceiba.tiempoRelativo(L(2026, 9, 25, 9, 0), ahora),   // 25 h antes, es ayer
        window.Ceiba.tiempoRelativo(L(2026, 9, 25, 20, 0), ahora),  // 13 h antes
        window.Ceiba.tiempoRelativo(L(2026, 9, 24, 9, 0), ahora),   // anteayer
      ];
    });
    await contexto.close();
    igual(r, ['ayer', 'hace 13 h', '24 oct']);
    const { contexto: c3, pagina: p3 } = await abrir({ timezoneId: 'Asia/Tokyo' });
    const t = await p3.evaluate(() => {
      const L = (y, m, d, h, mi) => new Date(y, m, d, h, mi).getTime();
      const ahora = L(2026, 9, 16, 10, 32);
      return [window.Ceiba.tiempoRelativo(L(2026, 9, 15, 9, 0), ahora), window.Ceiba.tiempoRelativo(ahora - 180000, ahora), window.Ceiba.fechaCompleta(ahora)];
    });
    await c3.close();
    igual(t, ['ayer', 'hace 3 min', '16 oct 2026, 10:32']);
  });
  await prueba('fechaCompleta: formato "16 oct 2026, 10:32"', async () => {
    igual(await llamar('fechaCompleta', AHORA), '16 oct 2026, 10:32');
  });
  await prueba('fechaCompleta: hora y día de un dígito', async () => {
    igual(await llamar('fechaCompleta', await loc(2026, 0, 5, 9, 5)), '5 ene 2026, 09:05');
  });
  await prueba('fechaCompleta: medianoche y 23:59', async () => {
    igual(await llamar('fechaCompleta', await loc(2026, 11, 31, 23, 59)), '31 dic 2026, 23:59');
    igual(await llamar('fechaCompleta', await loc(2026, 5, 1, 0, 0)), '1 jun 2026, 00:00');
  });
  await prueba('fechaCompleta: otro idioma cambia el texto; loc inválido cae a es', async () => {
    const en = await pagina.evaluate(ms => window.Ceiba.fechaCompleta(ms, 'en'), AHORA);
    verdadero(/Oct/.test(en) && en !== '16 oct 2026, 10:32', `en: ${en}`);
    igual(await pagina.evaluate(ms => window.Ceiba.fechaCompleta(ms, 'xx-no-valido-!!'), AHORA), '16 oct 2026, 10:32');
  });
  await prueba('fechaCompleta: valores no válidos dan cadena vacía', async () => {
    for (const v of [NaN, Infinity, 8.64e15 + 1, '123', null, undefined]) igual(await pagina.evaluate(x => window.Ceiba.fechaCompleta(x), v), '', `con ${String(v)}`);
  });

  // ------------------------------------------------------------------ urlSegura
  console.log('\n[urlSegura]');
  const aceptadas = [
    ['https://example.com', 'https://example.com'],
    ['http://example.com/a?b=1#c', 'http://example.com/a?b=1#c'],
    ['HTTPS://EXAMPLE.COM', 'HTTPS://EXAMPLE.COM'],
    ['https://example.com/ñandú', 'https://example.com/ñandú'],
    ['https://127.0.0.1:8080/x', 'https://127.0.0.1:8080/x'],
    ['mailto:hola@example.com', 'mailto:hola@example.com'],
    ['MAILTO:hola@example.com', 'MAILTO:hola@example.com'],
    ['#seccion', '#seccion'],
    ['#', '#'],
    ['  https://example.com  ', 'https://example.com'],
  ];
  for (const [entrada, esperado] of aceptadas) await prueba(`urlSegura acepta ${JSON.stringify(entrada)}`, async () => igual(await llamar('urlSegura', entrada), esperado));
  const rechazadas = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\rscript:alert(1)',
    '\u0001javascript:alert(1)', '\u0000javascript:alert(1)', '\u001fjavascript:alert(1)', '\u200bjavascript:alert(1)', 'java\u0000script:alert(1)',
    'jav&#x61;script:alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', 'javascript&colon;alert(1)', 'javascript%3Aalert(1)',
    'javascript://%0aalert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'DATA:text/html,<script>', 'vbscript:msgbox(1)', 'file:///etc/passwd',
    'ftp://example.com', 'blob:https://example.com/x', 'about:blank', '//evil.com', '/ruta', 'ruta.html', 'www.example.com',
    '', '   ', 'http:', 'https://', 'http:///', 'https:example.com', 'http:example.com', 'https:\\\\evil.com', 'mailto:', 'MAILTO:',
    'https://exa mple.com', 'https://a.com\u0000', 'https://a.com\n.evil', 'https://a.com/\u007f', 'https://[', 'https://a.com:99999',
    '\uFF48\uFF54\uFF54\uFF50\uFF53://x.com', 'https://?x', 'https://#x', 'https://example.com/' + 'a'.repeat(9000),
  ];
  for (const entrada of rechazadas) await prueba(`urlSegura rechaza ${JSON.stringify(entrada.length > 60 ? entrada.slice(0, 40) + '...' : entrada)}`, async () => igual(await llamar('urlSegura', entrada), null));
  await prueba('urlSegura rechaza lo que no es cadena', async () => {
    for (const v of [null, undefined, 42, true, {}, []]) igual(await pagina.evaluate(x => window.Ceiba.urlSegura(x), v), null);
    igual(await pagina.evaluate(() => window.Ceiba.urlSegura(['https://example.com'])), null);
  });
  await prueba('urlSegura: todo lo aceptado resuelve a http, https o mailto', async () => {
    const r = await pagina.evaluate(lista => lista.map(u => new URL(window.Ceiba.urlSegura(u), 'http://base.test/').protocol), aceptadas.map(a => a[0]));
    verdadero(r.every(p => ['http:', 'https:', 'mailto:'].includes(p)), JSON.stringify(r));
  });

  // ------------------------------------------------------------------ renderMarkdown: casos de HTML exacto
  console.log('\n[renderMarkdown: subconjunto soportado]');
  const A = (url, texto, extra = '') => `<a href="${url}" target="_blank" rel="noopener noreferrer"${extra}>${texto}</a>`;
  const MD = [
    // títulos
    ['título 1', '# Hola', '<h1>Hola</h1>'],
    ['seis niveles', '# a\n## b\n### c\n#### d\n##### e\n###### f', '<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>'],
    ['siete almohadillas no es título', '####### siete', '<p>####### siete</p>'],
    ['sin espacio tras # no es título', '#sin espacio', '<p>#sin espacio</p>'],
    ['cierre opcional del título', '# Con cierre ##', '<h1>Con cierre</h1>'],
    ['almohadilla final pegada se conserva', '## C#', '<h2>C#</h2>'],
    ['almohadilla sola es texto', '#', '<p>#</p>'],
    ['sangría de 3 espacios', '   ## Sangrado', '<h2>Sangrado</h2>'],
    ['sangría de 4 espacios no es título', '    # no', '<p># no</p>'],
    ['énfasis dentro del título', '# **Fuerte** y `código`', '<h1><strong>Fuerte</strong> y <code>código</code></h1>'],
    // párrafos y saltos
    ['vacío', '', ''],
    ['solo espacios y saltos', '  \n\n \t\n', ''],
    ['párrafos', 'uno\ndos\n\ntres', '<p>uno<br>dos</p><p>tres</p>'],
    ['dos espacios finales', 'uno  \ndos', '<p>uno<br>dos</p>'],
    ['barra invertida final', 'uno\\\ndos', '<p>uno<br>dos</p>'],
    ['CRLF', 'a\r\nb\r\n\r\nc', '<p>a<br>b</p><p>c</p>'],
    ['CR solo', 'a\rb', '<p>a<br>b</p>'],
    ['sangría inicial ignorada', '   texto', '<p>texto</p>'],
    ['acentos y signos de apertura', '¿Qué tal, señor Núñez? ¡Bien!', '<p>¿Qué tal, señor Núñez? ¡Bien!</p>'],
    ['carácter nulo se reemplaza', 'a\u0000b', '<p>a\uFFFDb</p>'],
    // énfasis
    ['negrita, cursiva y tachado', '**negrita** *cursiva* ~~tachado~~', '<p><strong>negrita</strong> <em>cursiva</em> <del>tachado</del></p>'],
    ['con guion bajo', '__negrita__ _cursiva_', '<p><strong>negrita</strong> <em>cursiva</em></p>'],
    ['triple', '***ambos***', '<p><em><strong>ambos</strong></em></p>'],
    ['cursiva dentro de negrita', '**negrita con *cursiva* dentro**', '<p><strong>negrita con <em>cursiva</em> dentro</strong></p>'],
    ['asterisco dentro de palabra enfatiza', 'a*b*c', '<p>a<em>b</em>c</p>'],
    ['guion bajo dentro de palabra no enfatiza', 'snake_case_name', '<p>snake_case_name</p>'],
    ['asteriscos entre espacios no enfatizan', '2 * 3 * 4', '<p>2 * 3 * 4</p>'],
    ['negrita sin cerrar', '**sin cerrar', '<p>**sin cerrar</p>'],
    ['cursiva sin abrir', 'cierra*', '<p>cierra*</p>'],
    ['tachado sin cerrar', '~~abierto', '<p>~~abierto</p>'],
    ['tilde simple no tacha', '~uno~', '<p>~uno~</p>'],
    ['tres tildes en línea no tachan', 'a ~~~ b', '<p>a ~~~ b</p>'],
    // código en línea
    ['código en línea', '`x = 1`', '<p><code>x = 1</code></p>'],
    ['acento grave dentro con delimitador doble', '`` a`b ``', '<p><code>a`b</code></p>'],
    ['recorta un espacio por lado', '` a `', '<p><code>a</code></p>'],
    ['escapa HTML en código', '`<b>x</b>`', '<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>'],
    ['sin énfasis dentro del código', '`*x* **y**`', '<p><code>*x* **y**</code></p>'],
    ['el código tiene prioridad sobre el énfasis', '*a `b*` c*', '<p><em>a <code>b*</code> c</em></p>'],
    ['acento grave sin cerrar', 'a ` b', '<p>a ` b</p>'],
    ['delimitadores de distinta longitud', '``a` b', '<p>``a` b</p>'],
    ['salto de línea dentro del código', 'a `x\ny` b', '<p>a <code>x y</code> b</p>'],
    // escapes
    ['escapa asteriscos', '\\*no cursiva\\*', '<p>*no cursiva*</p>'],
    ['escapa almohadilla inicial', '\\# no título', '<p># no título</p>'],
    ['escapa punto de lista', '1\\. no lista', '<p>1. no lista</p>'],
    ['escapa guion de lista', '\\- no lista', '<p>- no lista</p>'],
    ['barra doble', 'a\\\\b', '<p>a\\b</p>'],
    ['barra ante letra se conserva', 'a\\b', '<p>a\\b</p>'],
    ['escapa corchetes de enlace', '\\[x\\](https://example.com)', '<p>[x](https://example.com)</p>'],
    ['escapa acento grave', '\\`no código\\`', '<p>`no código`</p>'],
    ['escapa delimitadores dobles', '\\*\\*no\\*\\*', '<p>**no**</p>'],
    ['las entidades HTML se muestran literales', '&lt;b&gt; &amp; &#106;', '<p>&amp;lt;b&amp;gt; &amp;amp; &amp;#106;</p>'],
    // bloques de código
    ['cerca con lenguaje', `${F}js\nconst a = 1;\n${F}`, '<pre><code class="language-js">const a = 1;</code></pre>'],
    ['cerca sin lenguaje', `${F}\ntexto\n${F}`, '<pre><code>texto</code></pre>'],
    ['cerca con tildes', '~~~\nx\n~~~', '<pre><code>x</code></pre>'],
    ['no interpreta markdown ni HTML', `${F}\n# no\n**x**\n<b>\n${F}`, '<pre><code># no\n**x**\n&lt;b&gt;</code></pre>'],
    ['cerca sin cerrar llega al final', `${F}\nabierto\nsigue`, '<pre><code>abierto\nsigue</code></pre>'],
    ['líneas en blanco dentro de la cerca', `${F}\na\n\nb\n${F}`, '<pre><code>a\n\nb</code></pre>'],
    ['cierre más largo que la apertura', `${F}\na\n\`\`\`\`\``, '<pre><code>a</code></pre>'],
    ['cierre más corto no cierra', '````\na\n```\nb\n````', '<pre><code>a\n```\nb</code></pre>'],
    ['solo se usa la primera palabra del lenguaje', `${F}js onclick=alert(1)\nx\n${F}`, '<pre><code class="language-js">x</code></pre>'],
    ['lenguaje peligroso no genera clase', `${F}"><img src=x onerror=alert(1)>\nx\n${F}`, '<pre><code>x</code></pre>'],
    ['texto tras la cerca', `${F}\nx\n${F}\ntexto`, '<pre><code>x</code></pre><p>texto</p>'],
    ['cerca con sangría de 2', `  ${F}\n  x\n    y\n  ${F}`, '<pre><code>x\n  y</code></pre>'],
    ['cerca vacía', `${F}\n${F}`, '<pre><code></code></pre>'],
    ['la cerca interrumpe un párrafo', `antes\n${F}\nx\n${F}`, '<p>antes</p><pre><code>x</code></pre>'],
    ['cerca con acento grave en la información no es cerca', '``` a`b\nx', '<p>``` a`b<br>x</p>'],
    // citas
    ['cita', '> cita', '<blockquote><p>cita</p></blockquote>'],
    ['cita de varias líneas', '> a\n> b', '<blockquote><p>a<br>b</p></blockquote>'],
    ['cita sin espacio tras >', '>pegada', '<blockquote><p>pegada</p></blockquote>'],
    ['cita con dos párrafos', '> a\n>\n> b', '<blockquote><p>a</p><p>b</p></blockquote>'],
    ['cita anidada una vez', '> a\n> > b', '<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>'],
    ['el tercer nivel es texto', '> > > c', '<blockquote><blockquote><p>&gt; c</p></blockquote></blockquote>'],
    ['cita con título y lista', '> # T\n> - x', '<blockquote><h1>T</h1><ul><li>x</li></ul></blockquote>'],
    ['la cita termina en una línea sin >', '> a\nb', '<blockquote><p>a</p></blockquote><p>b</p>'],
    ['la cita interrumpe un párrafo', 'a\n> b', '<p>a</p><blockquote><p>b</p></blockquote>'],
    ['código dentro de una cita', `> ${F}\n> x\n> ${F}`, '<blockquote><pre><code>x</code></pre></blockquote>'],
    // listas
    ['viñetas', '- a\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['marcadores mezclados forman una lista', '- a\n* b\n+ c', '<ul><li>a</li><li>b</li><li>c</li></ul>'],
    ['numerada', '1. a\n2. b', '<ol><li>a</li><li>b</li></ol>'],
    ['numerada con paréntesis', '1) a\n2) b', '<ol><li>a</li><li>b</li></ol>'],
    ['numerada que empieza en 3', '3. a\n4. b', '<ol start="3"><li>a</li><li>b</li></ol>'],
    ['anidada con 2 espacios', '- a\n  - b', '<ul><li>a<ul><li>b</li></ul></li></ul>'],
    ['anidada con 4 espacios', '- a\n    - b', '<ul><li>a<ul><li>b</li></ul></li></ul>'],
    ['anidada con tabulación', '- a\n\t- b', '<ul><li>a<ul><li>b</li></ul></li></ul>'],
    ['anidada con 3 espacios bajo numerada', '1. a\n   - b', '<ol><li>a<ul><li>b</li></ul></li></ol>'],
    ['anidada con 2 espacios bajo numerada', '1. a\n  - b', '<ol><li>a<ul><li>b</li></ul></li></ol>'],
    ['tres niveles y regreso', '- a\n  - b\n    - c\n  - d\n- e', '<ul><li>a<ul><li>b<ul><li>c</li></ul></li><li>d</li></ul></li><li>e</li></ul>'],
    ['numerada con viñetas dentro', '1. a\n   - b\n   - c\n2. d', '<ol><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ol>'],
    ['cambiar de tipo abre otra lista', '- a\n1. b', '<ul><li>a</li></ul><ol><li>b</li></ol>'],
    ['una línea en blanco entre elementos no parte la lista', '- a\n\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['párrafo tras la lista', '- a\ntexto', '<ul><li>a</li></ul><p>texto</p>'],
    ['lista tras un párrafo', 'intro\n- a', '<p>intro</p><ul><li>a</li></ul>'],
    ['lista, párrafo y otra lista', '- a\n\ntexto\n\n- b', '<ul><li>a</li></ul><p>texto</p><ul><li>b</li></ul>'],
    ['continuación del elemento', '- a\n  más', '<ul><li>a<br>más</li></ul>'],
    ['segundo párrafo dentro del elemento', '- a\n\n  otro', '<ul><li>a<p>otro</p></li></ul>'],
    ['código dentro de un elemento', `1. Instalar\n   ${F}sh\n   npm i\n   ${F}\n2. Listo`, '<ol><li>Instalar<pre><code class="language-sh">npm i</code></pre></li><li>Listo</li></ol>'],
    ['cita dentro de un elemento', '- a\n  > b', '<ul><li>a<blockquote><p>b</p></blockquote></li></ul>'],
    ['lista dentro de una cita', '> - a\n> - b', '<blockquote><ul><li>a</li><li>b</li></ul></blockquote>'],
    ['énfasis en elementos', '- **a** y *b*', '<ul><li><strong>a</strong> y <em>b</em></li></ul>'],
    ['sin espacio tras el marcador no es lista', '-a\n1.b', '<p>-a<br>1.b</p>'],
    ['primer elemento sangrado y hermano sin sangría', '  - a\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['una numerada que no empieza en 1 no interrumpe un párrafo', 'año\n2. mayo', '<p>año<br>2. mayo</p>'],
    ['una numerada que empieza en 1 sí interrumpe', 'pasos\n1. abrir', '<p>pasos</p><ol><li>abrir</li></ol>'],
    ['título dentro de un elemento', '- # T', '<ul><li><h1>T</h1></li></ul>'],
    // tareas (los atributos exactos se comprueban con el DOM más abajo)
    ['corchetes pegados al texto no son tarea', '- [ ]sin espacio', '<ul><li>[ ]sin espacio</li></ul>'],
    ['letra distinta de x no es tarea', '- [y] otra', '<ul><li>[y] otra</li></ul>'],
    ['un marcador sin contenido es un elemento vacío', '-', '<ul><li></li></ul>'],
    ['un número con punto sin contenido es un elemento vacío', '1.', '<ol><li></li></ol>'],
    // enlaces
    ['enlace', '[texto](https://example.com)', `<p>${A('https://example.com', 'texto')}</p>`],
    ['enlace con título', '[t](https://e.com "Mi título")', `<p>${A('https://e.com', 't', ' title="Mi título"')}</p>`],
    ['ancla interna sin target', '[ir](#seccion)', '<p><a href="#seccion">ir</a></p>'],
    ['mailto sin target', '[correo](mailto:hola@example.com)', '<p><a href="mailto:hola@example.com">correo</a></p>'],
    ['énfasis dentro del texto del enlace', '[**fuerte**](https://e.com)', `<p>${A('https://e.com', '<strong>fuerte</strong>')}</p>`],
    ['paréntesis equilibrados en la URL', '[w](https://es.wikipedia.org/wiki/Ceiba_(árbol))', `<p>${A('https://es.wikipedia.org/wiki/Ceiba_(árbol)', 'w')}</p>`],
    ['paréntesis escapado en la URL', '[a](https://e.com/a\\)b)', `<p>${A('https://e.com/a)b', 'a')}</p>`],
    ['comillas en la URL no rompen el atributo', '[a](https://e.com/"x)', `<p>${A('https://e.com/&quot;x', 'a')}</p>`],
    ['enlace sin cerrar', '[sin cierre](https://e.com', '<p>[sin cierre](https://e.com</p>'],
    ['espacio entre ] y (', '[a] (https://e.com)', '<p>[a] (https://e.com)</p>'],
    ['texto vacío muestra la URL', '[](https://example.com)', `<p>${A('https://example.com', 'https://example.com')}</p>`],
    ['sin enlaces anidados', '[a [b](https://x.com) c](https://y.com)', `<p>[a ${A('https://x.com', 'b')} c](https://y.com)</p>`],
    ['enlace dentro de énfasis', '*[a](https://e.com)*', `<p><em>${A('https://e.com', 'a')}</em></p>`],
    ['corchetes sueltos', 'a [b] c', '<p>a [b] c</p>'],
    ['autoenlace', '<https://example.com/x?y=1>', `<p>${A('https://example.com/x?y=1', 'https://example.com/x?y=1')}</p>`],
    ['autoenlace mailto', '<mailto:a@b.co>', '<p><a href="mailto:a@b.co">mailto:a@b.co</a></p>'],
    ['autoenlace dentro de un enlace no se anida', '[<https://a.com>](https://b.com)', `<p>${A('https://b.com', 'https://a.com')}</p>`],
    ['autoenlace sin cerrar', '<https://sin-cerrar', '<p>&lt;https://sin-cerrar</p>'],
    ['menor y mayor sueltos', 'a < b > c', '<p>a &lt; b &gt; c</p>'],
    // imágenes
    ['imagen convertida en enlace', '![logo](https://example.com/a.png)', `<p>${A('https://example.com/a.png', 'logo', ' class="imagen"')}</p>`],
    ['imagen sin alternativa muestra la URL', '![](https://example.com/a.png)', `<p>${A('https://example.com/a.png', 'https://example.com/a.png', ' class="imagen"')}</p>`],
    ['imagen con esquema inseguro queda como texto', '![x](javascript:alert(1))', '<p>![x](javascript:alert(1))</p>'],
    ['exclamación suelta', '!sin corchete y ¡hola!', '<p>!sin corchete y ¡hola!</p>'],
    ['imagen sin cerrar', '![img sin cerrar', '<p>![img sin cerrar</p>'],
    // reglas
    ['regla con guiones', '---', '<hr>'],
    ['regla con asteriscos', '***', '<hr>'],
    ['regla con guiones bajos', '___', '<hr>'],
    ['regla con espacios', '- - -', '<hr>'],
    ['regla con asteriscos y espacios', '* * *', '<hr>'],
    ['regla larga', '----------', '<hr>'],
    ['dos guiones no son regla', '--', '<p>--</p>'],
    ['regla entre párrafos', 'a\n---\nb', '<p>a</p><hr><p>b</p>'],
    ['negrita cursiva pegada no es regla', '***texto***', '<p><em><strong>texto</strong></em></p>'],
    // tablas
    ['tabla básica', '| a | b |\n|---|---|\n| 1 | 2 |', '<div class="tabla"><table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'],
    ['tabla sin barras exteriores', 'a | b\n--- | ---\n1 | 2', '<div class="tabla"><table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'],
    ['tabla de una columna', '| a |\n|---|\n| 1 |', '<div class="tabla"><table><thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>'],
    ['tabla solo con cabecera', '| a |\n|---|', '<div class="tabla"><table><thead><tr><th scope="col">a</th></tr></thead></table></div>'],
    ['tabla seguida de párrafo tras línea en blanco', '| a |\n|---|\n| 1 |\n\ntexto', '<div class="tabla"><table><thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div><p>texto</p>'],
    ['tabla seguida de línea sin barra', '| a |\n|---|\n| 1 |\ntexto', '<div class="tabla"><table><thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div><p>texto</p>'],
    ['la tabla interrumpe un párrafo', 'antes\n| a |\n|---|\n| 1 |', '<p>antes</p><div class="tabla"><table><thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>'],
    ['delimitador con otro número de columnas no es tabla', '| a | b |\n|---|', '<p>| a | b |<br>|---|</p>'],
    ['barras en un párrafo normal', 'a | b', '<p>a | b</p>'],
    ['línea de guiones sin barras no es delimitador', 'a | b\n---', '<p>a | b</p><hr>'],
    ['barra escapada dentro de la celda', '| a |\n|---|\n| x \\| y |', '<div class="tabla"><table><thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>x | y</td></tr></tbody></table></div>'],
    ['markdown en celdas', '| **a** | `b` |\n|---|---|\n| [c](#d) | ~~e~~ |', '<div class="tabla"><table><thead><tr><th scope="col"><strong>a</strong></th><th scope="col"><code>b</code></th></tr></thead><tbody><tr><td><a href="#d">c</a></td><td><del>e</del></td></tr></tbody></table></div>'],
  ];
  for (const [nombre, entrada, esperado] of MD) await prueba(`markdown: ${nombre}`, async () => igual(await R(entrada), esperado));

  // ------------------------------------------------------------------ renderMarkdown: comprobaciones con el DOM
  console.log('\n[renderMarkdown: estructura del DOM]');
  await prueba('markdown: devuelve un div HTMLElement nuevo en cada llamada', async () => {
    const r = await pagina.evaluate(() => {
      const a = window.Ceiba.renderMarkdown('x'), b = window.Ceiba.renderMarkdown('x');
      return { esElemento: a instanceof HTMLElement, tag: a.tagName, distintos: a !== b, vacioTag: window.Ceiba.renderMarkdown('').tagName };
    });
    igual(r, { esElemento: true, tag: 'DIV', distintos: true, vacioTag: 'DIV' });
  });
  await prueba('markdown: entradas que no son cadena dan un contenedor vacío', async () => {
    const r = await pagina.evaluate(() => [null, undefined, {}, []].map(x => window.Ceiba.renderMarkdown(x).innerHTML));
    igual(r, ['', '', '', '']);
  });
  await prueba('markdown: listas de tareas con casillas deshabilitadas y de solo lectura', async () => {
    const r = await pagina.evaluate(() => {
      const el = window.Ceiba.renderMarkdown('- [ ] pendiente\n- [x] hecha\n- [X] mayúscula\n- normal');
      return {
        inputs: [...el.querySelectorAll('input')].map(i => ({ tipo: i.type, desactivada: i.disabled, marcada: i.checked, nombre: i.getAttribute('aria-label') })),
        clases: [...el.querySelectorAll('li')].map(li => li.className),
        textos: [...el.querySelectorAll('li')].map(li => li.textContent),
        primerHijo: el.querySelector('li').firstChild.tagName,
      };
    });
    igual(r.inputs, [
      { tipo: 'checkbox', desactivada: true, marcada: false, nombre: 'Tarea pendiente' },
      { tipo: 'checkbox', desactivada: true, marcada: true, nombre: 'Tarea completada' },
      { tipo: 'checkbox', desactivada: true, marcada: true, nombre: 'Tarea completada' },
    ]);
    igual(r.clases, ['tarea', 'tarea', 'tarea', '']);
    igual(r.textos, ['pendiente', 'hecha', 'mayúscula', 'normal']);
    igual(r.primerHijo, 'INPUT');
  });
  await prueba('markdown: tarea anidada y tarea con énfasis', async () => {
    const r = await pagina.evaluate(() => {
      const el = window.Ceiba.renderMarkdown('- [x] **a**\n  - [ ] b');
      return [el.querySelectorAll('input').length, el.querySelector('li li input').checked, el.querySelector('li > strong')?.textContent];
    });
    igual(r, [2, false, 'a']);
  });
  await prueba('markdown: alineación de columnas en las tablas', async () => {
    const r = await pagina.evaluate(() => {
      const el = window.Ceiba.renderMarkdown('| Nombre | Edad | Ciudad | Nota |\n|:-------|-----:|:------:|------|\n| Ana | 31 | Lima | x |\n| Luis | 28 | Quito | y |');
      const fila = tr => [...tr.children].map(c => c.style.textAlign);
      return { cab: fila(el.querySelector('thead tr')), filas: [...el.querySelectorAll('tbody tr')].map(fila), tablas: el.querySelectorAll('table').length, envoltura: el.firstChild.className };
    });
    igual(r.cab, ['left', 'right', 'center', '']);
    igual(r.filas, [['left', 'right', 'center', ''], ['left', 'right', 'center', '']]);
    igual(r.tablas, 1);
    igual(r.envoltura, 'tabla');
  });
  await prueba('markdown: filas con menos celdas se completan y con más se recortan', async () => {
    const r = await pagina.evaluate(() => {
      const el = window.Ceiba.renderMarkdown('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |');
      return [...el.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent));
    });
    igual(r, [['1', '', ''], ['1', '2', '3']]);
  });
  await prueba('markdown: enlaces externos llevan target y rel; internos y mailto no', async () => {
    const r = await pagina.evaluate(() => {
      const el = window.Ceiba.renderMarkdown('[a](https://e.com) [b](http://e.com) [c](#x) [d](mailto:a@b.co) <https://f.com> ![i](https://e.com/i.png)');
      return [...el.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.target, a.rel]);
    });
    igual(r, [
      ['https://e.com', '_blank', 'noopener noreferrer'], ['http://e.com', '_blank', 'noopener noreferrer'], ['#x', '', ''],
      ['mailto:a@b.co', '', ''], ['https://f.com', '_blank', 'noopener noreferrer'], ['https://e.com/i.png', '_blank', 'noopener noreferrer'],
    ]);
  });
  await prueba('markdown: nunca se crea un elemento img, ni hay recursos que cargar', async () => {
    const r = await pagina.evaluate(() => {
      const el = window.Ceiba.renderMarkdown('![a](https://e.com/a.png) ![b](data:image/png;base64,AAAA) <img src="https://e.com/x.png">');
      return [el.querySelectorAll('img,picture,video,audio,source,iframe,object,embed,link,script,style,svg').length, el.querySelectorAll('[src]').length];
    });
    igual(r, [0, 0]);
  });
  await prueba('markdown: la salida es estable al volver a analizarla como HTML (sin anidaciones inválidas)', async () => {
    const doc = ['# Título', 'Texto con **negrita**, *cursiva*, ~~tachado~~, `código` y [enlace](https://e.com "t").', '', '> cita', '> > interna', '',
      '- a', '  - b', '    - c', '- [ ] tarea', '- [x] hecha', '', '1. uno', '   ```sh', '   npm i', '   ```', '2. dos', '',
      '| a | b |', '|:--|--:|', '| 1 | 2 |', '', '---', '', '![alt](https://e.com/i.png) <https://auto.com>', '', '```', 'x < y && z', '```'].join('\n');
    const r = await pagina.evaluate(d => {
      const el = window.Ceiba.renderMarkdown(d);
      const html = el.innerHTML; const otro = document.createElement('div'); otro.innerHTML = html;
      return { igual: otro.innerHTML === html, problemas: window.__escanear(el), n: el.querySelectorAll('*').length };
    }, doc);
    verdadero(r.n > 30, 'el documento de ejemplo debería generar muchos elementos');
    igual(r.igual, true);
    igual(r.problemas, []);
  });

  // ------------------------------------------------------------------ seguridad
  console.log('\n[renderMarkdown: seguridad]');
  const HOSTILES = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<IMG SRC=x ONERROR=alert(1)>', '<svg onload=alert(1)>', '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a>', '<style>*{display:none}</style>', '<link rel=stylesheet href=//e.com/x.css>', '<meta http-equiv=refresh content="0;url=//e.com">',
    '<form action=//e.com><input name=x></form>', '<object data="data:text/html,<script>alert(1)</script>">', '<details open ontoggle=alert(1)>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>', '<base href="//e.com/">', '<input autofocus onfocus=alert(1)>', '</p><script>alert(1)</script>',
    '[x](JaVaScRiPt:alert(1))', '[x](&#106;avascript:alert(1))', '[x](&#x6A;avascript:alert(1))', '[x]( javascript:alert(1))', '[x](java\tscript:alert(1))',
    '[x](\u0001javascript:alert(1))', '[x](vbscript:msgbox(1))', '[x](data:text/html,<script>alert(1)</script>)', '[x](javascript&colon;alert(1))',
    '[x](//evil.com)', '[x](/relativa)', '[x](file:///etc/passwd)', '[x](<javascript:alert(1)>)', '[x]("javascript:alert(1)")', '[x](javascript:alert(1) "t")',
    '[x][1]\n\n[1]: javascript:alert(1)', '[x]: javascript:alert(1)\n\n[x]', '<javascript:alert(1)>', '<JAVASCRIPT:alert(1)>', '<data:text/html,x>',
    '![x](javascript:alert(1))', '![x](data:image/svg+xml,<svg onload=alert(1)>)', '![<script>alert(1)</script>](https://e.com/x.png)',
    '[a](https://e.com "x\\" onmouseover=\\"alert(1)")', '[a](https://e.com \'x" onmouseover="alert(1)\')', '<https://a.com"onclick="alert(1)>', '[a](https://a.com"onclick="alert(1))',
    '# <img src=x onerror=alert(1)>', '> <script>alert(1)</script>', '- <img src=x onerror=alert(1)>', '- [ ] <script>alert(1)</script>',
    '| <img src=x onerror=alert(1)> | <script> |\n|---|---|\n| <svg onload=alert(1)> | [x](javascript:alert(1)) |',
    '**<img src=x onerror=alert(1)>**', '*<script>*</script>', '`<script>alert(1)</script>`', '[`<img src=x onerror=alert(1)>`](https://e.com)',
    '~~<img src=x onerror=alert(1)>~~', '[a](https://e.com)<script>alert(1)</script>', 'texto &lt;script&gt;alert(1)&lt;/script&gt;',
    '\\<script\\>alert(1)\\</script\\>', `${F}"><script>alert(1)</script>\n<script>alert(1)</script>\n${F}`, '<!-- --><script>alert(1)</script>', '<![CDATA[<script>alert(1)</script>]]>',
  ];
  await prueba(`seguridad: ${HOSTILES.length} entradas hostiles solo producen etiquetas y atributos permitidos`, async () => {
    const r = await pagina.evaluate(lista => lista.map(s => ({ s, p: window.__escanear(window.Ceiba.renderMarkdown(s)) })).filter(x => x.p.length), HOSTILES);
    igual(r, []);
  });
  await prueba('seguridad: ninguna entrada hostil crea script, ni atributos de eventos, ni enlaces con esquema peligroso', async () => {
    const r = await pagina.evaluate(lista => {
      const malas = [];
      for (const s of lista) {
        const el = window.Ceiba.renderMarkdown(s);
        if (el.querySelector('script,iframe,object,embed,style,link,meta,base,form,svg,math,img')) malas.push([s, 'etiqueta']);
        for (const e of el.querySelectorAll('*')) for (const a of e.attributes) if (/^on/i.test(a.name)) malas.push([s, a.name]);
        for (const a of el.querySelectorAll('a')) if (!/^(https?:\/\/|mailto:|#)/i.test(a.getAttribute('href'))) malas.push([s, a.getAttribute('href')]);
      }
      return malas;
    }, HOSTILES);
    igual(r, []);
  });
  await prueba('seguridad: al insertar la salida en el documento no se ejecuta nada', async () => {
    const r = await pagina.evaluate(async lista => {
      window.__pwned = false;
      const marca = lista.map(s => s.replace(/alert\(1\)/g, 'window.__pwned=true'));
      const caja = document.createElement('div');
      for (const s of marca) caja.appendChild(window.Ceiba.renderMarkdown(s));
      document.body.appendChild(caja);
      for (const a of caja.querySelectorAll('a')) a.addEventListener('click', e => e.preventDefault());
      await new Promise(ok => setTimeout(ok, 300));
      const antes = window.__pwned;
      caja.remove();
      return { antes };
    }, HOSTILES);
    igual(r.antes, false);
  });
  const DANGER = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
    '\u0001javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,x', 'javascript&colon;alert(1)', '//evil.com', '/relativa', 'file:///etc/passwd', 'ftp://x.com', 'www.example.com'];
  for (const u of DANGER) {
    await prueba(`seguridad: [x](${JSON.stringify(u)}) queda como texto sin enlace`, async () => {
      const r = await pagina.evaluate(s => { const el = window.Ceiba.renderMarkdown(`[x](${s})`); return { enlaces: el.querySelectorAll('a').length, texto: el.textContent }; }, u);
      igual(r.enlaces, 0);
      verdadero(r.texto.includes('x'), 'debe conservar el texto visible');
    });
  }
  await prueba('seguridad: "comillas en atributos" no inyectan atributos nuevos', async () => {
    const r = await pagina.evaluate(() => {
      const el = window.Ceiba.renderMarkdown('[a](https://e.com/x" onmouseover="alert(1) "t\\" onfocus=\\"1")');
      const el2 = window.Ceiba.renderMarkdown('<https://a.com"onclick="alert(1)>');
      return [el, el2].map(x => [...x.querySelectorAll('a')].map(a => [...a.attributes].map(t => t.name)));
    });
    for (const grupo of r) for (const nombres of grupo) verdadero(nombres.every(n => ['href', 'target', 'rel', 'title'].includes(n)), JSON.stringify(nombres));
  });
  await prueba('seguridad: el HTML crudo se muestra como texto', async () => {
    const r = await pagina.evaluate(() => { const el = window.Ceiba.renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'); return [el.textContent, el.innerHTML]; });
    igual(r[0], '<script>alert(1)</script><img src=x onerror=alert(1)>');
    igual(r[1], '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  // ------------------------------------------------------------------ robustez
  console.log('\n[renderMarkdown: robustez y rendimiento]');
  const SIN_CERRAR = ['```\ncódigo sin cerrar', '> cita\n> sin fin', '| a | b |', '[enlace sin cerrar', '![img sin cerrar', '<https://sin-cerrar', '**', '`', '~~', '\\', '- [ ', '-', '*', '>', '> >', '|', '||', '|---|', ' ', '\t', '[', ']', '[]', '[]()', '[](', '![', '![]()', '<', '<>', '_', '__', '___', '****', '~', '#', '######', '`\n`', '\\\n', '[a](<b']
  await prueba(`robustez: ${SIN_CERRAR.length} construcciones incompletas no lanzan y conservan el texto`, async () => {
    const r = await pagina.evaluate(lista => {
      const malas = [];
      for (const s of lista) {
        try {
          const el = window.Ceiba.renderMarkdown(s);
          if (!(el instanceof HTMLElement)) malas.push([s, 'no es elemento']);
          const p = window.__escanear(el); if (p.length) malas.push([s, p]);
          // Todo carácter visible escrito debe aparecer en la salida (salvo marcadores de bloque consumidos).
          const limpiar = x => x.replace(/[\s`*_~#>|\-\\[\]()!<]/g, '');
          const letras = limpiar(s);
          if (letras && !limpiar(el.textContent).includes(letras)) malas.push([s, 'texto perdido']);
        } catch (e) { malas.push([s, String(e)]); }
      }
      return malas;
    }, SIN_CERRAR);
    igual(r, []);
  });
  const corpus = () => {
    const rep = (s, n) => s.repeat(n);
    const mezcla = (semilla, n) => {
      let x = semilla; const al = '*_~`[]()!<>\\#-+|\n 0123456789.:"\'ab';
      const out = new Array(n);
      for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = al[x % al.length]; }
      return out.join('');
    };
    const creciente = (f, tope) => { let s = ''; for (let k = 0; s.length < tope; k++) s += f(k); return s; };
    window.__hostiles = {
      'asteriscos': () => rep('*', 1e6),
      'asterisco y letra': () => rep('*a', 5e5),
      'asteriscos que abren sin cerrar': () => rep('*a ', 3e5),
      'asteriscos dobles anidados': () => rep('**a *b ', 1.5e5),
      'guiones bajos y letra': () => rep('_a', 5e5),
      'guiones bajos separados': () => rep('_ a ', 2.5e5),
      'tildes': () => rep('~~a', 3e5),
      'corchetes abiertos': () => rep('[', 1e6),
      'corchetes cerrados': () => rep(']', 1e6),
      'corchetes con texto': () => rep('[a', 5e5),
      'enlaces sin cerrar': () => rep('[a](b', 2e5),
      'enlaces vacíos sin cerrar': () => rep('[](', 3e5),
      'enlaces con paréntesis crecientes': () => rep('[a](((((((((((((((((((((((((((((((((((((', 3e4),
      'imágenes sin cerrar': () => rep('![a](', 2e5),
      'exclamaciones y corchete': () => rep('![', 5e5),
      'enlaces válidos': () => rep('[a](https://e.com) ', 5e4),
      'enlaces con título sin cerrar': () => rep('[a](b "', 1.4e5),
      'regla de 3 (a)': () => rep('**a*', 2.5e5),
      'regla de 3 (b)': () => rep('*a**', 2.5e5),
      'asterisco dentro de palabra': () => rep('a*b*', 2.5e5),
      'guion bajo y asterisco': () => rep('_*a*_ ', 1.7e5),
      'triples': () => rep('***a** ', 1.5e5),
      'código y énfasis': () => rep('*`a`* ', 1.7e5),
      'enlaces con énfasis': () => rep('[*a](https://e.com) ', 5e4),
      'corchetes anidados con destino': () => rep(rep('[', 60) + 'x' + rep('](https://e.com)', 60) + ' ', 1000),
      'imágenes y enlaces válidos': () => rep('![a](https://e.com) [b](#c) ', 3.5e4),
      'acentos graves': () => rep('`', 1e6),
      'acentos graves alternados': () => rep('`a', 5e5),
      'acentos graves de longitud creciente': () => creciente(k => rep('`', k + 1) + 'a', 1e6),
      'acentos graves pares': () => rep('``a`', 2.5e5),
      'menores': () => rep('<', 1e6),
      'autoenlaces sin cerrar': () => rep('<https://a.b', 8e4),
      'autoenlaces válidos': () => rep('<https://a.b> ', 7e4),
      'barras invertidas': () => rep('\\', 1e6),
      'barras con saltos': () => rep('\\\n', 5e5),
      'citas en una línea': () => rep('> ', 5e5),
      'citas por línea': () => rep('> x\n', 2.5e5),
      'citas anidadas por línea': () => rep(rep('> ', 200) + 'x\n', 2500),
      'viñetas por línea': () => rep('- x\n', 2.5e5),
      'viñetas en una línea': () => rep('- ', 5e5),
      'numeradas por línea': () => rep('1. x\n', 2e5),
      'sangría creciente de listas': () => creciente(k => rep(' ', k) + '- x\n', 1e6),
      'listas anidadas profundas': () => creciente(k => rep('  ', k % 400) + '- x\n', 1e6),
      'listas con líneas en blanco': () => rep('- a\n\n\n\n', 2.5e5),
      'tubería': () => rep('|', 1e6),
      'fila de tabla enorme': () => '|' + rep('a|', 4e5) + '\n|' + rep('-|', 4e5) + '\n|1|',
      'tabla con muchas filas': () => '|a|b|\n|-|-|\n' + rep('|1|2|\n', 1.6e5),
      'tablas repetidas': () => rep('|a|b|\n|-|-|\n|1|2|\n\n', 6e4),
      'cabeceras de tabla sin delimitador': () => rep('a|b|c|d\n', 1.2e5),
      'saltos de línea': () => rep('\n', 1e6),
      'espacios': () => rep(' ', 1e6) + 'x',
      'espacios internos': () => 'a' + rep(' ', 1e6) + 'b',
      'tabulaciones': () => rep('\t', 1e6) + 'x',
      'cercas': () => rep('```\n', 2.5e5),
      'cercas de 1 MB de acentos': () => rep('`', 1e6) + '\nx',
      'cercas con código largo': () => '```\n' + rep('linea de codigo\n', 6e4) + '```',
      'almohadillas': () => rep('#', 1e6),
      'títulos': () => rep('# a\n', 2.5e5),
      'títulos con cierre': () => rep('# a ' + rep('#', 20) + '\n', 4e4),
      'reglas': () => rep('---\n', 2.5e5),
      'reglas con espacios': () => rep('- - - - - -\n', 8e4),
      'texto plano': () => rep('palabra ', 1.25e5),
      'una sola palabra': () => rep('a', 1e6),
      'mezcla aleatoria 1': () => mezcla(1, 1e6),
      'mezcla aleatoria 2': () => mezcla(77, 1e6),
      'mezcla aleatoria 3': () => mezcla(2026, 1e6),
    };
  };
  await pagina.evaluate(corpus);
  const nombresHostiles = await pagina.evaluate(() => Object.keys(window.__hostiles));
  for (const nombre of nombresHostiles) {
    await prueba(`robustez: 1 MB hostil "${nombre}" en menos de 2 s, sin errores y con anidación acotada`, async () => {
      const r = await pagina.evaluate(n => {
        const s = window.__hostiles[n]();
        const t0 = performance.now();
        const el = window.Ceiba.renderMarkdown(s);
        const ms = performance.now() - t0;
        return { ms, len: s.length, prof: window.__profundidad(el), nodos: el.getElementsByTagName('*').length, problemas: window.__escanear(el).slice(0, 3) };
      }, nombre);
      tiempos.push([nombre, r.len, Math.round(r.ms), r.prof, r.nodos]);
      verdadero(r.len >= 900000, `entrada de solo ${r.len} caracteres`);
      verdadero(r.ms < 2000, `tardó ${Math.round(r.ms)} ms`);
      verdadero(r.prof <= 60, `profundidad del DOM ${r.prof}`);
      igual(r.problemas, []);
    });
  }
  await prueba('robustez: anidación patológica de énfasis, citas, listas y corchetes no desborda la pila', async () => {
    const r = await pagina.evaluate(() => {
      const casos = {
        enfasis: '*a '.repeat(50000) + 'x' + ' a*'.repeat(50000),
        enfasisDobles: '**a *b '.repeat(20000) + 'x' + ' b* a**'.repeat(20000),
        citas: '> '.repeat(10000) + 'x',
        listas: Array.from({ length: 3000 }, (_, k) => ' '.repeat(2 * (k % 300)) + '- n' + k).join('\n'),
        corchetes: '['.repeat(100000) + 'a' + '](https://e.com)'.repeat(100000),
        mixta: '> - '.repeat(5000) + 'x',
      };
      const out = {};
      for (const [k, s] of Object.entries(casos)) {
        const t0 = performance.now();
        try { const el = window.Ceiba.renderMarkdown(s); out[k] = { ms: Math.round(performance.now() - t0), prof: window.__profundidad(el) }; }
        catch (e) { out[k] = { error: String(e) }; }
      }
      return out;
    });
    for (const [k, v] of Object.entries(r)) {
      verdadero(!v.error, `${k}: ${v.error}`);
      verdadero(v.prof <= 60, `${k}: profundidad ${v.prof}`);
      verdadero(v.ms < 2000, `${k}: ${v.ms} ms`);
    }
  });
  await prueba('rendimiento: una nota realista de 200 KB se renderiza en menos de 300 ms (primera llamada, sin calentar)', async () => {
    const { contexto, pagina: p } = await abrir();
    const r = await p.evaluate(() => {
      const bloque = [
        '# Sección de ejemplo', '', 'Un párrafo con **negrita**, *cursiva*, ~~tachado~~, `código` y un [enlace](https://example.com/ruta?x=1 "título").',
        'Segunda línea con <https://auto.example.com> y una imagen ![alt](https://example.com/i.png).', '',
        '> Una cita que comenta algo', '> con dos líneas', '', '- elemento uno', '  - anidado a', '  - anidado b', '- [ ] tarea pendiente', '- [x] tarea hecha', '',
        '1. primero', '2. segundo', '', '| Nombre | Valor | Nota |', '|:--|--:|:-:|', '| uno | 1 | a |', '| dos | 2 | b |', '', '```js', 'const x = 1; // bloque de código', '```', '', '---', '',
      ].join('\n');
      let s = ''; let i = 0;
      while (s.length < 200000) s += bloque.replace('Sección', 'Sección ' + (i++)) + '\n';
      const t0 = performance.now();
      const el = window.Ceiba.renderMarkdown(s);
      const ms = performance.now() - t0;
      return { ms, len: s.length, nodos: el.getElementsByTagName('*').length };
    });
    await contexto.close();
    tiempos.push(['nota realista 200 KB (fría)', r.len, Math.round(r.ms), '-', r.nodos]);
    verdadero(r.len >= 200000);
    verdadero(r.ms < 300, `tardó ${Math.round(r.ms)} ms`);
  });
  await prueba('rendimiento: 200 KB en un solo párrafo con énfasis y enlaces en menos de 300 ms', async () => {
    const r = await pagina.evaluate(() => {
      const s = 'Texto con **negrita**, *cursiva*, `código` y [enlace](https://e.com) que no termina. '.repeat(2500);
      const t0 = performance.now(); const el = window.Ceiba.renderMarkdown(s); return { ms: performance.now() - t0, len: s.length, n: el.querySelectorAll('strong').length };
    });
    verdadero(r.len >= 200000);
    igual(r.n, 2500);
    verdadero(r.ms < 300, `tardó ${Math.round(r.ms)} ms`);
  });
  await prueba('rendimiento: título y extracto de una nota de 200 KB son inmediatos', async () => {
    const r = await pagina.evaluate(() => {
      const s = '# Título\n\n' + 'cuerpo '.repeat(30000);
      const t0 = performance.now(); const t = window.Ceiba.titulo(s); const e = window.Ceiba.extracto(s); return { ms: performance.now() - t0, t, e: e.length };
    });
    igual(r.t, 'Título');
    igual(r.e, 120);
    verdadero(r.ms < 20, `tardó ${r.ms} ms`);
  });

  // ------------------------------------------------------------------ validarImportacion
  console.log('\n[validarImportacion]');
  const V = json => pagina.evaluate(j => window.Ceiba.validarImportacion(JSON.parse(j)), JSON.stringify(json));
  const VT = texto => pagina.evaluate(t => window.Ceiba.validarImportacion(JSON.parse(t)), texto);
  const nota = (id, extra = {}) => ({ id, texto: `texto de ${id}`, creada: 1000, editada: 2000, ...extra });
  await prueba('importación válida devuelve las notas tal cual y cero omitidas', async () => {
    igual(await V({ version: 1, notas: [nota('a1'), nota('b-2', { texto: '', creada: 0 })] }),
      { notas: [nota('a1'), nota('b-2', { texto: '', creada: 0 })], omitidas: 0 });
  });
  await prueba('importación válida vacía', async () => igual(await V({ version: 1, notas: [] }), { notas: [], omitidas: 0 }));
  await prueba('campos extra del archivo y de las notas se descartan', async () => {
    const r = await V({ version: 1, activa: 'a1', exportado: 123, notas: [{ ...nota('a1'), color: 'rojo', __extra: [1] }] });
    igual(r, { notas: [nota('a1')], omitidas: 0 });
    igual(Object.keys(r.notas[0]), ['id', 'texto', 'creada', 'editada']);
  });
  const noObjetos = [['null', 'null'], ['número', '42'], ['cadena', '"texto"'], ['arreglo', '[]'], ['booleano', 'true'], ['arreglo de notas', '[{"id":"a","texto":"x","creada":1,"editada":1}]']];
  for (const [n, json] of noObjetos) {
    await prueba(`importación inválida: ${n}`, async () => {
      const r = await VT(json);
      igual(Object.keys(r), ['error']);
      verdadero(typeof r.error === 'string' && r.error.length > 10, 'el error debe ser un mensaje legible');
    });
  }
  await prueba('importación inválida: undefined', async () => {
    const r = await pagina.evaluate(() => window.Ceiba.validarImportacion(undefined));
    verdadero(typeof r.error === 'string' && r.error.length > 10);
  });
  const esquemas = [
    ['sin versión', { notas: [] }], ['versión 2', { version: 2, notas: [] }], ['versión 0', { version: 0, notas: [] }], ['versión como cadena', { version: '1', notas: [] }],
    ['sin notas', { version: 1 }], ['notas nulas', { version: 1, notas: null }], ['notas como objeto', { version: 1, notas: {} }], ['notas como cadena', { version: 1, notas: 'x' }],
  ];
  for (const [n, json] of esquemas) {
    await prueba(`importación inválida: ${n}`, async () => {
      const r = await V(json);
      igual(Object.keys(r), ['error']);
      verdadero(typeof r.error === 'string' && r.error.length > 10 && !/undefined|\[object/.test(r.error), r.error);
    });
  }
  await prueba('una versión más nueva da un mensaje que lo explica', async () => {
    verdadero(/versión/i.test((await V({ version: 2, notas: [] })).error), 'el mensaje debería mencionar la versión');
  });
  await prueba('límite: 5.000 notas se aceptan', async () => {
    const r = await pagina.evaluate(() => window.Ceiba.validarImportacion({ version: 1, notas: Array.from({ length: 5000 }, (_, i) => ({ id: 'n' + i, texto: 't' + i, creada: 1, editada: i })) }));
    igual(r.notas.length, 5000);
    igual(r.omitidas, 0);
  });
  await prueba('límite: 5.001 notas se rechazan y el mensaje menciona 5.000', async () => {
    const r = await pagina.evaluate(() => window.Ceiba.validarImportacion({ version: 1, notas: Array.from({ length: 5001 }, (_, i) => ({ id: 'n' + i, texto: 't', creada: 1, editada: 1 })) }));
    igual(Object.keys(r), ['error']);
    verdadero(r.error.includes('5.000'), r.error);
  });
  await prueba('5.000 notas se validan en menos de 150 ms', async () => {
    const r = await pagina.evaluate(() => {
      const json = { version: 1, notas: Array.from({ length: 5000 }, (_, i) => ({ id: 'id-' + i, texto: 'x'.repeat(200), creada: 1, editada: i })) };
      const t0 = performance.now(); window.Ceiba.validarImportacion(json); return performance.now() - t0;
    });
    verdadero(r < 150, `tardó ${r} ms`);
  });
  await prueba('notas inválidas se cuentan como omitidas (tipos, vacíos, fechas fuera de rango)', async () => {
    const r = await pagina.evaluate(() => {
      const ok = (id) => ({ id, texto: 't', creada: 1, editada: 2 });
      const notas = [ok('v1'), null, 5, 'x', [], { id: 'x' }, { id: 1, texto: 'a', creada: 1, editada: 1 }, { id: 'o2', texto: 5, creada: 1, editada: 1 },
        { id: 'o3', texto: 'a', creada: '1', editada: 1 }, { id: 'o4', texto: 'a', creada: NaN, editada: 1 }, { id: '', texto: 'a', creada: 1, editada: 1 },
        { id: 'o5', texto: 'a', creada: 1, editada: Infinity }, { id: 'o6', texto: 'a', creada: -1, editada: 1 }, { id: 'o7', texto: 'a', creada: 1, editada: 1e300 },
        { id: 'o8', texto: 'a', creada: 1, editada: 8.64e15 + 1 }, { id: 'o9', texto: null, creada: 1, editada: 1 }, undefined, ok('v2')];
      notas.length = 20; // huecos en el arreglo
      return window.Ceiba.validarImportacion({ version: 1, notas });
    });
    igual(r.notas.map(n => n.id), ['v1', 'o6', 'v2'], 'una fecha negativa dentro del rango de Date es válida (reloj anterior a 1970); ver ronda 1, SEG-02');
    igual(r.omitidas, 17);
  });
  await prueba('fechas límite: 0 y 8,64e15 son válidas', async () => {
    const r = await V({ version: 1, notas: [nota('a', { creada: 0, editada: 8.64e15 })] });
    igual(r.notas.length, 1);
    igual(r.omitidas, 0);
  });
  await prueba('fechas límite negativas: -8,64e15 es válida (mismo rango que Date) y un poco menos se omite', async () => {
    const r = await V({ version: 1, notas: [nota('a', { creada: -8.64e15, editada: -1 }), nota('b', { creada: -8.64e15 - 1, editada: 1 })] });
    igual(r.notas.map(n => n.id), ['a']);
    igual(r.omitidas, 1);
  });
  await prueba('ids hostiles se sanean: solo [A-Za-z0-9_-], máx. 64, sin colisionar con Object.prototype', async () => {
    const ids = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', '<script>alert(1)</script>', 'a b', 'ñandú', 'x'.repeat(200),
      '../../etc/passwd', 'id\nnuevo', '"onmouseover="x', "c'd", 'e\u0000f', 'g\ud83d\ude00h'];
    const r = await pagina.evaluate(lista => {
      const out = window.Ceiba.validarImportacion({ version: 1, notas: lista.map((id, i) => ({ id, texto: 'n' + i, creada: 1, editada: 1 })) });
      const mapa = {};
      for (const n of out.notas) mapa[n.id] = n.texto;
      return {
        total: out.notas.length, omitidas: out.omitidas,
        ids: out.notas.map(n => n.id),
        validos: out.notas.every(n => /^[A-Za-z0-9_-]{1,64}$/.test(n.id)),
        sinProto: out.notas.every(n => !(n.id in {})),
        unicos: new Set(out.notas.map(n => n.id)).size,
        protoIntacto: Object.getPrototypeOf(mapa) === Object.prototype,
        claves: Object.keys(mapa).length,
        contaminado: ({}).polluted,
      };
    }, ids);
    igual(r.omitidas, 0, `ids: ${JSON.stringify(r.ids)}`);
    igual(r.total, ids.length);
    verdadero(r.validos, `ids no válidos: ${JSON.stringify(r.ids)}`);
    verdadero(r.sinProto, 'algún id coincide con una clave de Object.prototype');
    igual(r.unicos, ids.length);
    verdadero(r.protoIntacto);
    igual(r.claves, ids.length);
    igual(r.contaminado, undefined);
  });
  await prueba('un __proto__ propio en el JSON no contamina nada ni se copia', async () => {
    const r = await pagina.evaluate(() => {
      const texto = '{"version":1,"notas":[{"id":"__proto__","texto":"x","creada":1,"editada":1,"__proto__":{"polluted":true}}],"__proto__":{"polluted2":true}}';
      const out = window.Ceiba.validarImportacion(JSON.parse(texto));
      const n = out.notas[0];
      return { id: n.id, claves: Object.keys(n), proto: Object.getPrototypeOf(n) === Object.prototype, p1: ({}).polluted, p2: ({}).polluted2, tienePolluted: 'polluted' in n };
    });
    igual(r.claves, ['id', 'texto', 'creada', 'editada']);
    verdadero(r.id !== '__proto__');
    verdadero(r.proto);
    igual(r.p1, undefined);
    igual(r.p2, undefined);
    igual(r.tienePolluted, false);
  });
  await prueba('un __proto__ como único contenido del archivo no cuenta como versión ni notas', async () => {
    const r = await pagina.evaluate(() => window.Ceiba.validarImportacion(JSON.parse('{"__proto__":{"version":1,"notas":[]}}')));
    igual(Object.keys(r), ['error']);
  });
  await prueba('solo cuentan las propiedades propias (no las heredadas)', async () => {
    const r = await pagina.evaluate(() => {
      const heredado = Object.create({ version: 1, notas: [] });
      const nota = Object.create({ id: 'h', texto: 'x', creada: 1, editada: 1 });
      return [window.Ceiba.validarImportacion(heredado), window.Ceiba.validarImportacion({ version: 1, notas: [nota] })];
    });
    igual(Object.keys(r[0]), ['error']);
    igual(r[1], { notas: [], omitidas: 1 });
  });
  await prueba('ids repetidos: gana la editada más reciente y el resto cuenta como omitida', async () => {
    const r = await V({ version: 1, notas: [nota('x', { texto: 'viejo', editada: 5 }), nota('y'), nota('x', { texto: 'nuevo', editada: 9 })] });
    igual(r.notas.map(n => [n.id, n.texto]), [['x', 'nuevo'], ['y', 'texto de y']]);
    igual(r.omitidas, 1);
  });
  await prueba('ids repetidos con la misma fecha: se conserva la primera', async () => {
    const r = await V({ version: 1, notas: [nota('x', { texto: 'primera', editada: 5 }), nota('x', { texto: 'segunda', editada: 5 })] });
    igual(r.notas.map(n => n.texto), ['primera']);
    igual(r.omitidas, 1);
  });
  await prueba('ids que colisionan tras sanear se tratan como repetidos', async () => {
    const r = await V({ version: 1, notas: [nota('a b', { texto: 'uno', editada: 5 }), nota('a_b', { texto: 'dos', editada: 9 })] });
    igual(r.notas.map(n => [n.id, n.texto]), [['a_b', 'dos']]);
    igual(r.omitidas, 1);
  });
  await prueba('no muta la entrada y devuelve objetos nuevos', async () => {
    const r = await pagina.evaluate(() => {
      const entrada = { version: 1, notas: [{ id: 'a b', texto: 'x', creada: 1, editada: 2, extra: 1 }] };
      const antes = JSON.stringify(entrada);
      const out = window.Ceiba.validarImportacion(entrada);
      return { igual: JSON.stringify(entrada) === antes, distinto: out.notas[0] !== entrada.notas[0] };
    });
    igual(r, { igual: true, distinto: true });
  });
  await prueba('el texto de las notas no se altera (saltos, tildes, nulos, HTML)', async () => {
    const texto = '# Título\r\n<script>alert(1)</script>\u0000 ñandú\n\n```\ncódigo\n```';
    const r = await pagina.evaluate(t => window.Ceiba.validarImportacion({ version: 1, notas: [{ id: 'a', texto: t, creada: 1, editada: 1 }] }).notas[0].texto, texto);
    igual(r, texto);
  });

  // ------------------------------------------------------------------ nombreArchivo
  console.log('\n[nombreArchivo]');
  const casosNombre = [
    ['título simple', 'Mi nota', 'Mi nota.md'],
    ['conserva tildes, eñes y mayúsculas', 'Canción de mañana', 'Canción de mañana.md'],
    ['caracteres prohibidos pasan a espacio', 'Reunión: acuerdos/pendientes?', 'Reunión acuerdos pendientes.md'],
    ['todos los prohibidos', 'a\\b/c:d*e?f"g<h>i|j', 'a b c d e f g h i j.md'],
    ['espacios repetidos', 'a    b\t\tc', 'a b c.md'],
    ['vacío', '', 'Sin título.md'],
    ['solo espacios', '   ', 'Sin título.md'],
    ['solo puntos', '...', 'Sin título.md'],
    ['solo prohibidos', '///', 'Sin título.md'],
    ['punto y espacio finales', 'Hola. ', 'Hola.md'],
    ['puntos finales', 'Hola...', 'Hola.md'],
    ['punto inicial', '.oculto', 'oculto.md'],
    ['recorrido de rutas', '../../etc/passwd', 'etc passwd.md'],
    ['nombre reservado de Windows', 'CON', 'nota-CON.md'],
    ['reservado en minúsculas con número', 'com1', 'nota-com1.md'],
    ['reservado LPT9', 'LPT9', 'nota-LPT9.md'],
    ['reservado con extensión', 'aux.log', 'nota-aux.log.md'],
    ['nul con espacio final', 'NUL ', 'nota-NUL.md'],
    ['parecido a reservado pero válido', 'Concierto', 'Concierto.md'],
    ['console no es reservado', 'console', 'console.md'],
    ['caracteres de control y de formato', 'a\u202Eb\u0000c\u200Bd\n', 'abcd.md'],
    ['normaliza a NFC', 'e\u0301', 'é.md'],
    ['título por defecto de la interfaz', 'Sin título', 'Sin título.md'],
  ];
  for (const [n, entrada, esperado] of casosNombre) await prueba(`nombreArchivo: ${n}`, async () => igual(await llamar('nombreArchivo', entrada), esperado));
  await prueba('nombreArchivo: limita la base a 80 caracteres y siempre termina en .md', async () => {
    const r = await llamar('nombreArchivo', 'x'.repeat(500));
    igual(r, 'x'.repeat(80) + '.md');
    verdadero((await llamar('nombreArchivo', 'a'.repeat(79) + ' . . b')).endsWith('.md'));
  });
  await prueba('nombreArchivo: no corta pares sustitutos', async () => {
    const r = await pagina.evaluate(() => window.Ceiba.nombreArchivo('x'.repeat(79) + '\u{1D400}\u{1D400}'));
    verdadero(!/[\ud800-\udbff]\.md$/.test(r), r);
  });
  await prueba('nombreArchivo: valores que no son cadena dan "Sin título.md"', async () => {
    for (const v of [null, undefined, 42, {}, []]) igual(await pagina.evaluate(x => window.Ceiba.nombreArchivo(x), v), v === 42 ? '42.md' : 'Sin título.md');
  });
  await prueba('nombreArchivo: ninguna entrada hostil produce separadores, ni empieza con punto o espacio', async () => {
    const r = await pagina.evaluate(() => {
      const xs = ['../a', '..\\a', '/etc/passwd', 'C:\\Windows\\x', 'a/../b', '  ..  ', '~', '$(rm -rf)', '`x`', '%00', 'a\u0000.md', '\u202Egnp.md', ' . . . ', '.git', '-rf', 'con.', 'x'.repeat(1e6)];
      return xs.map(x => window.Ceiba.nombreArchivo(x)).filter(n => /[\\/:*?"<>|\u0000-\u001f\u202e]/.test(n) || /^[.\s]/.test(n) || /[.\s]\.md$/.test(n) || !n.endsWith('.md') || n.length > 83);
    });
    igual(r, []);
  });
  await prueba('nombreArchivo: una cadena de 1 MB de puntos y espacios se resuelve rápido', async () => {
    const r = await pagina.evaluate(() => { const s = '. '.repeat(5e5) + 'x'; const t0 = performance.now(); const n = window.Ceiba.nombreArchivo(s); return { ms: performance.now() - t0, n }; });
    verdadero(r.ms < 500, `tardó ${r.ms} ms`);
    verdadero(r.n.endsWith('.md'));
  });

  // ------------------------------------------------------------------ pureza y estado global
  console.log('\n[pureza]');
  await prueba('las funciones no dejan globales nuevos ni tocan localStorage ni la red', async () => {
    const r = await pagina.evaluate(() => {
      const C = window.Ceiba;
      const antes = Object.getOwnPropertyNames(window).length;
      let almacenamiento = 'sin acceso';
      try { almacenamiento = localStorage.length; } catch (e) { almacenamiento = 'bloqueado'; }
      C.renderMarkdown('# x'); C.titulo('x'); C.extracto('x\ny'); C.normalizar('x'); C.coincide({ texto: 'x' }, 'x'); C.tiempoRelativo(1, 2); C.fechaCompleta(1);
      C.urlSegura('https://e.com'); C.validarImportacion({ version: 1, notas: [] }); C.nombreArchivo('x'); C.escapar('x');
      let despues = Object.getOwnPropertyNames(window).length;
      let almacenamiento2 = 'sin acceso';
      try { almacenamiento2 = localStorage.length; } catch (e) { almacenamiento2 = 'bloqueado'; }
      return { globales: despues - antes, almacenamiento: almacenamiento === almacenamiento2 };
    });
    igual(r, { globales: 0, almacenamiento: true });
  });
  await prueba('la salida final de consola sigue limpia tras todas las pruebas', async () => {
    igual(registro, []);
  });

  console.log('\n[tiempos de las entradas hostiles y de la nota de 200 KB]');
  console.log('  caso | caracteres | ms | profundidad DOM | elementos');
  for (const t of tiempos) console.log(`  ${t.join(' | ')}`);
} finally {
  await cerrar();
  await srv.cerrar();
}
process.exitCode = resumen('unit');
