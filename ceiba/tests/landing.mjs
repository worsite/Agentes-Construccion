// Pruebas de la landing (ceiba/index.html). Ejecutar: node ceiba/tests/landing.mjs
// Cubre: selector Mensual/Anual con ratón y teclado, importes de los seis paneles,
// enlaces CTA exactos, sin scroll horizontal, noscript, FAQ, tema, contraste y robustez.
import fs from 'node:fs';
import path from 'node:path';
import { servir, lanzar, prueba, resumen, igual, verdadero, RAIZ } from './helpers.mjs';

const srv = await servir();
const { navegador, cerrar } = await lanzar();
const PAGINA = srv.url + '/index.html';
const HTML = fs.existsSync(path.join(RAIZ, 'index.html')) ? fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8') : '';

// ---- Datos esperados (escritos a mano a propósito: la página debe derivarlos de su objeto PLANES) ----
const PLANES = [
  { id: 'semilla', nombre: 'Semilla', para: 'Quien empieza un cuaderno propio', mensual: '5', anual: '50', equiv: '4,17', ahorro: '10' },
  { id: 'brote', nombre: 'Brote', para: 'Quien escribe a diario y quiere respaldo', mensual: '9', anual: '90', equiv: '7,50', ahorro: '18' },
  { id: 'bosque', nombre: 'Bosque', para: 'Equipos pequeños', mensual: '18', anual: '180', equiv: '15,00', ahorro: '36' },
];
const AVISO = 'Demostración: los planes y precios son ficticios y no se realiza ningún cobro.';
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'";
const norm = s => String(s).replace(/\s+/g, ' ').trim();

/** Abre la página en un contexto nuevo, ejecuta fn y siempre cierra. */
async function con(opciones, fn) {
  const { ancho = 1440, alto = 900, init, ...resto } = opciones || {};
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, ...resto });
  if (init) await ctx.addInitScript(init.fn, init.arg);
  ctx.setDefaultTimeout(6000);
  const page = await ctx.newPage();
  const registro = { consola: [], errores: [], peticiones: [] };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') registro.consola.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => registro.errores.push(e.message));
  page.on('request', r => registro.peticiones.push(r.url()));
  try {
    await page.goto(PAGINA);
    return await fn(page, registro, ctx);
  } finally { await ctx.close(); }
}
const tarjeta = (page, id) => page.locator(`#planes .plan[data-plan="${id}"]`);
const texto = async loc => norm(await loc.textContent());

// ------------------------------------------------------------------ Estructura básica
await prueba('documento: idioma, título, viewport, CSP exacta, descripción y esquema de color', async () => {
  await con({}, async page => {
    igual(await page.locator('html').getAttribute('lang'), 'es');
    verdadero(/Ceiba/.test(await page.title()), 'el título debe nombrar Ceiba');
    verdadero(await page.locator('meta[name="viewport"]').count() === 1, 'falta meta viewport');
    igual(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), CSP);
    verdadero((await page.locator('meta[name="description"]').getAttribute('content') || '').length > 40, 'meta description corta o ausente');
    verdadero(/light dark/.test(await page.locator('meta[name="color-scheme"]').getAttribute('content') || ''), 'falta meta color-scheme');
  });
});

await prueba('cabecera: marca, anclas Principios/Planes/Preguntas, "Abrir la app" y botón de tema', async () => {
  await con({}, async page => {
    const cab = page.locator('header.cabecera');
    verdadero(await cab.getByText('Ceiba', { exact: true }).first().isVisible(), 'falta la marca Ceiba');
    const enlaces = await cab.locator('nav[aria-label="Secciones"] a').evaluateAll(a => a.map(x => [x.textContent.trim(), x.getAttribute('href')]));
    igual(enlaces, [['Principios', '#principios'], ['Planes', '#planes'], ['Preguntas', '#preguntas']]);
    const abrir = cab.getByRole('link', { name: 'Abrir la app', exact: true });
    igual(await abrir.getAttribute('href'), 'app.html');
    verdadero(await cab.getByRole('button', { name: /Tema oscuro/ }).count() === 1, 'falta botón de tema');
  });
});

await prueba('enlace "Saltar al contenido" es el primer foco y lleva a main', async () => {
  await con({}, async page => {
    await page.keyboard.press('Tab');
    const primero = await page.evaluate(() => ({ txt: document.activeElement.textContent.trim(), href: document.activeElement.getAttribute('href') }));
    igual(primero, { txt: 'Saltar al contenido', href: '#contenido' });
    verdadero(await page.locator('main#contenido').count() === 1, 'falta main#contenido');
    await page.keyboard.press('Enter');
    verdadero(page.url().endsWith('#contenido'), 'el salto no navega a #contenido');
  });
});

// ------------------------------------------------------------------ Héroe y maqueta
await prueba('héroe: titular editorial, lema, CTA "Probar 14 días" -> #planes y "Ver cómo se escribe" -> app.html', async () => {
  await con({}, async page => {
    const h1 = page.locator('h1');
    igual(await h1.count(), 1);
    const t = await texto(h1);
    verdadero(t.includes('Escribe.') && t.includes('Lo demás puede esperar.'), `titular inesperado: ${t}`);
    verdadero((await texto(page.locator('.heroe'))).includes('Un cuaderno quieto para escribir'), 'falta el lema');
    igual(await page.getByRole('link', { name: 'Probar 14 días', exact: true }).getAttribute('href'), '#planes');
    igual(await page.getByRole('link', { name: 'Ver cómo se escribe', exact: true }).getAttribute('href'), 'app.html');
    const tam = await h1.evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    verdadero(tam >= 64, `el titular en 1440 debe ser grande (>= 64 px), es ${tam}`);
    verdadero(/serif|Palatino|Georgia|Iowan/i.test(await h1.evaluate(e => getComputedStyle(e).fontFamily)), 'el titular debe ser serif');
  });
});

await prueba('maqueta de papel: markdown real a un lado y su render al otro (columnas en escritorio)', async () => {
  await con({}, async page => {
    const fuente = page.locator('figure.maqueta .maqueta__fuente');
    const render = page.locator('figure.maqueta .maqueta__render');
    const ft = await fuente.textContent();
    verdadero(ft.includes('# Cuaderno de campo') && ft.includes('*río*') && ft.includes('**sonido**') && ft.includes('- [ ] Llamar a Inés') && ft.includes('> Escribir es mirar despacio.'), 'el markdown de la maqueta no es el esperado');
    igual(await texto(render.locator('em')), 'río');
    igual(await texto(render.locator('strong')), 'sonido');
    verdadero(await render.locator('blockquote').count() === 1, 'falta la cita renderizada');
    verdadero(await render.locator('ul li').count() === 3, 'la lista renderizada debe tener 3 elementos');
    verdadero(!(await render.textContent()).includes('**'), 'el render no debe mostrar marcas de markdown');
    const a = await fuente.boundingBox(), b = await render.boundingBox();
    verdadero(b.x > a.x + a.width - 2, 'en escritorio el render va a la derecha del texto');
    const leyenda = await texto(page.locator('figure.maqueta figcaption'));
    verdadero(/una vista a la vez/.test(leyenda) && /Alt/.test(leyenda), `la leyenda debe aclarar que la app muestra una vista a la vez: ${leyenda}`);
  });
  await con({ ancho: 360 }, async page => {
    const a = await page.locator('.maqueta__fuente').boundingBox(), b = await page.locator('.maqueta__render').boundingBox();
    verdadero(b.y >= a.y + a.height - 2, 'en móvil el render va debajo del texto');
  });
});

await prueba('rama de ceiba: SVG en línea decorativo con trazo de 1.5 px', async () => {
  await con({}, async page => {
    const ramas = page.locator('svg.rama');
    verdadero(await ramas.count() >= 2, 'se esperan al menos 2 ramas (sello y héroe)');
    for (const r of await ramas.all()) igual(await r.getAttribute('aria-hidden'), 'true');
    const grande = page.locator('.heroe svg.rama');
    verdadero(await grande.count() === 1, 'una rama grande en el héroe');
    const info = await grande.evaluate(svg => {
      const hijos = svg.querySelectorAll('path, use');
      const p = svg.querySelector('path');
      const cs = getComputedStyle(p);
      return { n: hijos.length, ancho: cs.strokeWidth, trazo: cs.stroke, relleno: cs.fill };
    });
    verdadero(info.n >= 12, `la rama debe tener hojas y espinas (elementos: ${info.n})`);
    igual(info.ancho, '1.5px');
    verdadero(info.trazo !== 'none', 'la rama debe tener trazo');
  });
});

// ------------------------------------------------------------------ Principios
await prueba('principios: tres bloques con los títulos de la spec, en disposición asimétrica', async () => {
  await con({}, async page => {
    const arts = page.locator('#principios article');
    igual(await arts.count(), 3);
    const titulos = await arts.locator('h3').allTextContents();
    igual(titulos.map(norm), ['Un solo panel', 'Tus notas se quedan contigo', 'Teclado primero']);
    const cajas = [];
    for (const a of await arts.all()) cajas.push(await a.boundingBox());
    const izqs = new Set(cajas.map(c => Math.round(c.x)));
    const anchos = new Set(cajas.map(c => Math.round(c.width)));
    verdadero(izqs.size >= 2, 'los tres bloques no deben compartir el mismo borde izquierdo');
    verdadero(anchos.size >= 2, 'los tres bloques no deben tener el mismo ancho');
    const honesto = norm(await arts.nth(1).textContent());
    verdadero(/navegador/.test(honesto) && /sin cuentas|no hay cuentas/i.test(honesto), 'el bloque 2 debe decir que se guarda en el navegador y que no hay cuentas');
  });
  await con({ ancho: 360 }, async page => {
    const cajas = [];
    for (const a of await page.locator('#principios article').all()) cajas.push(await a.boundingBox());
    verdadero(cajas[1].y >= cajas[0].y + cajas[0].height - 2 && cajas[2].y >= cajas[1].y + cajas[1].height - 2, 'en móvil los bloques se apilan');
  });
});

// ------------------------------------------------------------------ Selector y precios
await prueba('selector: radiogrupo accesible con Mensual y Anual, Anual por defecto', async () => {
  await con({}, async page => {
    const grupo = page.getByRole('radiogroup');
    igual(await grupo.count(), 1);
    const nombre = await grupo.evaluate(e => e.getAttribute('aria-label') || (e.querySelector('legend') || {}).textContent || '');
    verdadero(norm(nombre).length > 3, 'el radiogrupo debe tener nombre accesible');
    igual(await page.getByRole('radio').count(), 2);
    verdadero(await page.getByRole('radio', { name: 'Anual', exact: true }).isChecked(), 'Anual debe venir marcado');
    verdadero(!(await page.getByRole('radio', { name: 'Mensual', exact: true }).isChecked()), 'Mensual no debe venir marcado');
  });
});

/** Clic de ratón real en el centro del botón visible del selector (el input transparente lo cubre a propósito). */
async function clicSelector(page, texto) {
  const objetivo = page.locator('.ciclo__texto', { hasText: texto });
  await objetivo.scrollIntoViewIfNeeded();
  const caja = await objetivo.boundingBox();
  await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
}

await prueba('selector con ratón: Mensual y de vuelta a Anual cambian los importes y avisan en la región de estado', async () => {
  await con({}, async page => {
    await clicSelector(page, 'Mensual');
    verdadero(await page.getByRole('radio', { name: 'Mensual', exact: true }).isChecked());
    igual(await texto(tarjeta(page, 'brote').locator('.plan__importe')), 'US$ 9 al mes');
    verdadero(/mensual/i.test(await texto(page.locator('#aviso-ciclo'))), 'la región de estado debe anunciar el ciclo mensual');
    igual(await page.locator('#aviso-ciclo').getAttribute('role'), 'status');
    await clicSelector(page, 'Anual');
    verdadero(await page.getByRole('radio', { name: 'Anual', exact: true }).isChecked());
    igual(await texto(tarjeta(page, 'brote').locator('.plan__importe')), 'US$ 7,50 al mes');
    verdadero(/anual/i.test(await texto(page.locator('#aviso-ciclo'))));
  });
});

await prueba('selector con teclado: flechas cambian de opción (con vuelta), Inicio/Fin y Tab sale del grupo', async () => {
  await con({}, async page => {
    const anual = page.getByRole('radio', { name: 'Anual', exact: true });
    const mensual = page.getByRole('radio', { name: 'Mensual', exact: true });
    await anual.focus();
    await page.keyboard.press('ArrowLeft');
    verdadero(await mensual.isChecked() && await mensual.evaluate(e => e === document.activeElement), 'ArrowLeft debe pasar a Mensual y mover el foco');
    igual(await texto(tarjeta(page, 'semilla').locator('.plan__importe')), 'US$ 5 al mes');
    await page.keyboard.press('ArrowRight');
    verdadero(await anual.isChecked(), 'ArrowRight vuelve a Anual');
    await page.keyboard.press('ArrowRight');
    verdadero(await mensual.isChecked(), 'ArrowRight desde el último da la vuelta al primero');
    await page.keyboard.press('ArrowDown');
    verdadero(await anual.isChecked(), 'ArrowDown también avanza');
    await page.keyboard.press('ArrowUp');
    verdadero(await mensual.isChecked(), 'ArrowUp también retrocede');
    // una sola parada de tabulación dentro del grupo
    await page.keyboard.press('Tab');
    const fuera = await page.evaluate(() => !document.activeElement.closest('[role="radiogroup"]'));
    verdadero(fuera, 'Tab debe salir del radiogrupo (una sola parada)');
  });
});

for (const ciclo of ['anual', 'mensual']) {
  await prueba(`importes del ciclo ${ciclo}: las tres tarjetas muestran los valores exactos`, async () => {
    await con({}, async page => {
      if (ciclo === 'mensual') await page.getByRole('radio', { name: 'Mensual', exact: true }).check({ force: true });
      igual(await page.locator('#planes .plan').count(), 3);
      for (const p of PLANES) {
        const t = tarjeta(page, p.id);
        igual(await texto(t.locator('h3')), p.nombre);
        igual(await texto(t.locator('.plan__para')), p.para);
        if (ciclo === 'anual') {
          igual(await texto(t.locator('.plan__importe')), `US$ ${p.equiv} al mes`, `${p.nombre} importe`);
          igual(await texto(t.locator('.plan__detalle')), `US$ ${p.anual} cobrados una vez al año`, `${p.nombre} total`);
          igual(await texto(t.locator('.plan__ahorro')), `Ahorras US$ ${p.ahorro} frente a pagar 12 meses`, `${p.nombre} ahorro`);
        } else {
          igual(await texto(t.locator('.plan__importe')), `US$ ${p.mensual} al mes`, `${p.nombre} importe`);
          igual(await texto(t.locator('.plan__detalle')), 'Cancela cuando quieras', `${p.nombre} nota`);
          verdadero(!(await t.locator('.plan__ahorro').isVisible()), `${p.nombre}: en mensual no hay ahorro`);
        }
      }
    });
  });

  await prueba(`CTA del ciclo ${ciclo}: href exacto app.html?plan=<id>&ciclo=${ciclo} y texto "Elegir <Plan>"`, async () => {
    await con({}, async page => {
      if (ciclo === 'mensual') await page.getByRole('radio', { name: 'Mensual', exact: true }).check({ force: true });
      for (const p of PLANES) {
        const a = tarjeta(page, p.id).getByRole('link', { name: `Elegir ${p.nombre}`, exact: true });
        igual(await a.count(), 1, `un enlace Elegir ${p.nombre}`);
        igual(await a.getAttribute('href'), `app.html?plan=${p.id}&ciclo=${ciclo}`);
      }
    });
  });
}

await prueba('CTA funciona aunque app.html no exista: el clic navega a la URL exacta (respuesta simulada)', async () => {
  await con({}, async (page, _r, ctx) => {
    await ctx.route('**/app.html**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>app</title>' }));
    await tarjeta(page, 'brote').getByRole('link', { name: 'Elegir Brote', exact: true }).click();
    await page.waitForURL(/app\.html/);
    const u = new URL(page.url());
    igual([u.pathname, u.searchParams.get('plan'), u.searchParams.get('ciclo')], ['/app.html', 'brote', 'anual']);
  });
});

await prueba('"La más elegida": etiqueta de texto solo en la tarjeta central (Brote)', async () => {
  await con({}, async page => {
    const etiquetas = page.locator('#planes .plan__etiqueta');
    igual(await etiquetas.count(), 1);
    igual(await texto(etiquetas), 'La más elegida');
    verdadero(await tarjeta(page, 'brote').locator('.plan__etiqueta').count() === 1);
    const xs = [];
    for (const p of PLANES) xs.push((await tarjeta(page, p.id).boundingBox()).x);
    verdadero(xs[0] < xs[1] && xs[1] < xs[2], 'orden visual Semilla, Brote, Bosque en escritorio');
  });
});

await prueba('importes derivados: la fuente no contiene a mano 4,17 / 7,50 / 15,00 y define un único objeto PLANES', async () => {
  verdadero(HTML.length > 0, 'ceiba/index.html no existe');
  for (const v of ['4,17', '7,50', '15,00']) verdadero(!HTML.includes(v), `"${v}" está escrito a mano en el HTML`);
  verdadero(/const PLANES\s*=/.test(HTML), 'falta const PLANES');
  igual((HTML.match(/const PLANES\s*=/g) || []).length, 1);
});

await prueba('aviso de demostración exacto junto al selector y en el pie', async () => {
  await con({}, async page => {
    igual(await texto(page.locator('#planes .aviso-demo')), AVISO);
    igual(await texto(page.locator('footer .aviso-demo')), AVISO);
    const nota = norm(await page.locator('#planes').textContent());
    verdadero(/no limita/.test(nota), 'debe aclarar que la app no limita funciones por plan en la demostración');
  });
});

await prueba('funciones por tarjeta: lo que no existe aparece como "En preparación"', async () => {
  await con({}, async page => {
    const bosque = tarjeta(page, 'bosque');
    const prep = bosque.locator('.plan__prep');
    verdadero(/En preparación/.test(await texto(prep)), 'Bosque debe rotular su bloque como En preparación');
    for (const f of ['Espacios compartidos para equipos', 'Sincronización entre dispositivos', 'Soporte por correo en 24 h'])
      verdadero((await texto(prep)).includes(f), `${f} debe estar bajo En preparación`);
    igual(await tarjeta(page, 'semilla').locator('.plan__prep').count(), 0);
    igual(await tarjeta(page, 'brote').locator('.plan__prep').count(), 0);
    verdadero((await texto(tarjeta(page, 'brote'))).includes('Todo lo de Semilla'));
    verdadero((await texto(bosque)).includes('Todo lo de Brote'));
    verdadero((await texto(tarjeta(page, 'brote'))).includes('Copia de seguridad completa en JSON'));
  });
});

// ------------------------------------------------------------------ Comparativa
await prueba('tabla comparativa accesible: caption, scope, matriz de funciones y de estados', async () => {
  await con({}, async page => {
    const tabla = page.locator('table.comparativa');
    igual(await tabla.count(), 1);
    verdadero((await texto(tabla.locator('caption'))).length > 8, 'falta caption');
    const cols = await tabla.locator('thead th').evaluateAll(t => t.map(x => [x.textContent.trim(), x.getAttribute('scope')]));
    igual(cols.slice(1), [['Semilla', 'col'], ['Brote', 'col'], ['Bosque', 'col']]);
    const filas = await tabla.locator('tbody tr').evaluateAll(trs => trs.map(tr => ({
      fun: tr.querySelector('th').textContent.trim(), scope: tr.querySelector('th').getAttribute('scope'),
      celdas: [...tr.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\s+/g, ' ')),
    })));
    igual(filas.map(f => f.scope), Array(10).fill('row'));
    const esperado = [
      ['Notas guardadas en este navegador', 'Sí', 'Sí', 'Sí'],
      ['Markdown con vista previa', 'Sí', 'Sí', 'Sí'],
      ['Búsqueda instantánea', 'Sí', 'Sí', 'Sí'],
      ['Exportar una nota a .md', 'Sí', 'Sí', 'Sí'],
      ['Copia de seguridad completa en JSON (exportar e importar)', 'No', 'Sí', 'Sí'],
      ['Temas de papel claro y oscuro', 'No', 'Sí', 'Sí'],
      ['Atajos de teclado completos', 'No', 'Sí', 'Sí'],
      ['Espacios compartidos para equipos', 'No', 'No', 'En preparación'],
      ['Sincronización entre dispositivos', 'No', 'No', 'En preparación'],
      ['Soporte por correo en 24 h', 'No', 'No', 'En preparación'],
    ];
    igual(filas.map(f => [f.fun, ...f.celdas]), esperado);
    verdadero(/versión comercial/.test(norm(await page.locator('#comparativa').textContent())), 'debe aclarar que describe una versión comercial');
  });
});

// ------------------------------------------------------------------ noscript
await prueba('sin JavaScript: noscript con tabla simple de precios mensual y anual; el selector no aparece', async () => {
  await con({ javaScriptEnabled: false }, async page => {
    const tabla = page.locator('noscript table.precios-simple');
    igual(await tabla.count(), 1);
    verdadero((await texto(tabla.locator('caption'))).length > 8, 'falta caption en la tabla noscript');
    const filas = await tabla.locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(c => c.textContent.trim().replace(/\s+/g, ' '))));
    igual(filas, PLANES.map(p => [p.nombre, `US$ ${p.mensual}`, `US$ ${p.anual}`]));
    verdadero(await tabla.isVisible(), 'la tabla noscript debe verse');
    verdadero(!(await page.locator('#planes-app').isVisible()), 'el selector y las tarjetas requieren JavaScript');
    igual(norm(await page.locator('#planes noscript .aviso-demo, #planes .aviso-demo:visible').first().textContent()), AVISO);
    verdadero(await page.locator('#planes .aviso-demo:visible').count() === 1, 'el aviso de demostración debe verse sin JavaScript');
    // los enlaces a la app siguen disponibles sin JS
    const enlaces = await tabla.locator('a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    igual(enlaces, PLANES.map(p => `app.html?plan=${p.id}&ciclo=anual`));
  });
});

await prueba('noscript coincide con las tarjetas: mismos importes mensuales y totales anuales', async () => {
  await con({}, async page => {
    const filas = await page.evaluate(() => {
      const ns = document.querySelector('noscript');
      const doc = new DOMParser().parseFromString(ns.textContent, 'text/html');
      return [...doc.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent.trim().replace(/\s+/g, ' ')));
    });
    const mensual = [], anual = [];
    for (const p of PLANES) anual.push(await texto(tarjeta(page, p.id).locator('.plan__detalle')));
    await page.getByRole('radio', { name: 'Mensual', exact: true }).check({ force: true });
    for (const p of PLANES) mensual.push(await texto(tarjeta(page, p.id).locator('.plan__importe')));
    igual(filas.map(f => f[1] + ' al mes'), mensual.map(m => m.replace(/^US\$ (\d+) al mes$/, 'US$ $1') + ' al mes'));
    igual(filas.map(f => `${f[2]} cobrados una vez al año`), anual);
  });
});

// ------------------------------------------------------------------ FAQ
await prueba('FAQ: seis details cerrados que abren y cierran con ratón y con teclado', async () => {
  await con({}, async page => {
    const det = page.locator('#preguntas details');
    igual(await det.count(), 6);
    const resumenes = (await det.locator('summary').allTextContents()).map(norm);
    for (const k of [/cobr/i, /cancel/i, /guardan/i, /export/i, /cambiar/i, /markdown/i])
      verdadero(resumenes.some(r => k.test(r)), `falta una pregunta sobre ${k}`);
    for (let i = 0; i < 6; i++) verdadero(!(await det.nth(i).evaluate(e => e.open)), `la pregunta ${i} debe venir cerrada`);
    await det.nth(0).locator('summary').click();
    verdadero(await det.nth(0).evaluate(e => e.open), 'clic abre');
    await det.nth(0).locator('summary').click();
    verdadero(!(await det.nth(0).evaluate(e => e.open)), 'clic cierra');
    await det.nth(2).locator('summary').focus();
    await page.keyboard.press('Enter');
    verdadero(await det.nth(2).evaluate(e => e.open), 'Enter abre');
    await page.keyboard.press('Space');
    verdadero(!(await det.nth(2).evaluate(e => e.open)), 'Espacio cierra');
    // contenido honesto
    await det.nth(0).locator('summary').click();
    verdadero(/no se (cobra|realiza)/i.test(norm(await det.nth(0).textContent())), 'la respuesta de cobro debe decir que no se cobra nada');
    await det.nth(2).locator('summary').click();
    verdadero(/navegador/.test(norm(await det.nth(2).textContent())), 'dónde se guardan: en el navegador');
    // cada summary tiene área táctil de al menos 44 px
    for (const s of await det.locator('summary').all()) verdadero((await s.boundingBox()).height >= 44, 'summary < 44 px');
  });
});

// ------------------------------------------------------------------ Cierre y pie
await prueba('cierre y pie: llamada final con enlaces reales y pie con aviso', async () => {
  await con({}, async page => {
    const cierre = page.locator('section.cierre');
    igual(await cierre.getByRole('link', { name: 'Abrir la app', exact: true }).getAttribute('href'), 'app.html');
    igual(await cierre.getByRole('link', { name: 'Ver los planes', exact: true }).getAttribute('href'), '#planes');
    const pie = await page.locator('footer a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    for (const h of pie) verdadero(h === 'app.html' || /^#/.test(h), `enlace de pie inesperado: ${h}`);
  });
});

// ------------------------------------------------------------------ Tema
await prueba('tema: el botón alterna claro/oscuro, persiste en ceiba:prefs:v1 (campo tema) y conserva otros campos', async () => {
  await con({ colorScheme: 'light', init: { fn: () => { if (!localStorage.getItem('sembrado')) { localStorage.setItem('sembrado', '1'); localStorage.setItem('ceiba:prefs:v1', JSON.stringify({ tema: 'sistema', plan: 'brote', ciclo: 'anual', foco: true })); } } } }, async page => {
    const boton = page.getByRole('button', { name: /Tema oscuro/ });
    igual(await boton.getAttribute('aria-pressed'), 'false');
    igual((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)), 'rgb(251, 246, 234)');
    await boton.click();
    igual(await page.locator('html').getAttribute('data-theme'), 'dark');
    igual(await boton.getAttribute('aria-pressed'), 'true');
    igual((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)), 'rgb(27, 25, 21)');
    let prefs = JSON.parse(await page.evaluate(() => localStorage.getItem('ceiba:prefs:v1')));
    igual(prefs, { tema: 'oscuro', plan: 'brote', ciclo: 'anual', foco: true });
    await page.reload();
    igual(await page.locator('html').getAttribute('data-theme'), 'dark', 'el tema oscuro debe sobrevivir a la recarga');
    await page.getByRole('button', { name: /Tema oscuro/ }).click();
    igual(await page.locator('html').getAttribute('data-theme'), 'light');
    prefs = JSON.parse(await page.evaluate(() => localStorage.getItem('ceiba:prefs:v1')));
    igual(prefs.tema, 'claro');
  });
});

await prueba('tema: sin preferencia sigue al sistema (oscuro) y una preferencia explícita gana sobre el sistema', async () => {
  await con({ colorScheme: 'dark' }, async page => {
    igual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(27, 25, 21)');
    igual(await page.getByRole('button', { name: /Tema oscuro/ }).getAttribute('aria-pressed'), 'true');
    for (const [token, valor] of [['--papel', '#1b1915'], ['--hoja', '#24211c'], ['--tinta', '#eee6d4'], ['--musgo', '#a9bc87'], ['--terracota', '#e5987a']])
      igual((await page.evaluate(t => getComputedStyle(document.documentElement).getPropertyValue(t).trim().toLowerCase(), token)), valor, token);
  });
  await con({ colorScheme: 'dark', init: { fn: () => localStorage.setItem('ceiba:prefs:v1', JSON.stringify({ tema: 'claro' })) } }, async page => {
    igual(await page.locator('html').getAttribute('data-theme'), 'light');
    igual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(251, 246, 234)');
  });
  await con({ colorScheme: 'light' }, async page => {
    for (const [token, valor] of [['--papel', '#fbf6ea'], ['--hoja', '#fffdf7'], ['--tinta', '#2b2620'], ['--tinta-suave', '#5e554a'], ['--linea', '#e3d9c4'], ['--musgo', '#4b5a35'], ['--terracota', '#9c4a27'], ['--arcilla', '#e7c9a5'], ['--peligro', '#a3281e'], ['--foco', '#1f5fbf']])
      igual((await page.evaluate(t => getComputedStyle(document.documentElement).getPropertyValue(t).trim().toLowerCase(), token)), valor, token);
  });
});

await prueba('robustez: localStorage bloqueado o con JSON roto no rompe la página ni produce errores de consola', async () => {
  await con({ init: { fn: () => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError'); } }) } }, async (page, reg) => {
    verdadero(await page.locator('#planes .plan').count() === 3, 'las tarjetas deben generarse sin almacenamiento');
    await page.getByRole('button', { name: /Tema oscuro/ }).click();
    igual(await page.locator('html').getAttribute('data-theme'), 'dark', 'el tema cambia aunque no se pueda guardar');
    igual(reg.errores, []); igual(reg.consola, []);
  });
  await con({ init: { fn: () => localStorage.setItem('ceiba:prefs:v1', '{rota') } }, async (page, reg) => {
    verdadero(await page.locator('#planes .plan').count() === 3);
    igual(reg.errores, []); igual(reg.consola, []);
    await page.getByRole('button', { name: /Tema oscuro/ }).click();
    const prefs = JSON.parse(await page.evaluate(() => localStorage.getItem('ceiba:prefs:v1')));
    igual(prefs.tema, 'oscuro');
  });
});

// ------------------------------------------------------------------ Layout y responsive
for (const ancho of [360, 768, 1024, 1440]) {
  await prueba(`sin scroll horizontal a ${ancho} px (ambos ciclos, FAQ abierta) y contenido clave dentro del viewport`, async () => {
    await con({ ancho }, async page => {
      for (const ciclo of ['Anual', 'Mensual']) {
        await page.getByRole('radio', { name: ciclo, exact: true }).check({ force: true });
        for (const s of await page.locator('#preguntas summary').all()) { if (!(await s.evaluate(e => e.parentElement.open))) await s.click(); }
        const m = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth }));
        verdadero(m.sw <= m.vw && m.bw <= m.vw, `${ciclo}: scrollWidth ${m.sw}/${m.bw} > ancho ${m.vw}`);
        const fuera = await page.evaluate(() => {
          const malos = [];
          for (const sel of ['h1', '.maqueta', '.maqueta__hoja', '.ciclo', '.plan', 'table.comparativa', '#preguntas details', '.cierre .boton', 'footer', 'header.cabecera nav a', '.heroe .boton']) {
            for (const e of document.querySelectorAll(sel)) {
              const r = e.getBoundingClientRect();
              if (r.width > 0 && (r.left < -1 || r.right > document.documentElement.clientWidth + 1)) malos.push(`${sel} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
            }
          }
          return malos;
        });
        igual(fuera, [], `${ciclo}: elementos fuera del viewport`);
      }
    });
  });
}

await prueba('comparativa a 360 px: todas las celdas de la tabla caben sin desbordar el contenedor', async () => {
  await con({ ancho: 360 }, async page => {
    const r = await page.evaluate(() => {
      const t = document.querySelector('table.comparativa');
      const w = t.parentElement;
      return { tabla: t.scrollWidth, cont: w.clientWidth, sw: w.scrollWidth };
    });
    verdadero(r.tabla <= r.cont + 1 && r.sw <= r.cont + 1, `la tabla desborda su contenedor: ${JSON.stringify(r)}`);
    const celdas = await page.evaluate(() => [...document.querySelectorAll('table.comparativa th, table.comparativa td')]
      .filter(c => c.scrollWidth > c.clientWidth + 1).map(c => `${c.textContent.trim().slice(0, 20)} ${c.scrollWidth}>${c.clientWidth}`));
    igual(celdas, [], 'celdas con texto que no cabe');
  });
});

await prueba('áreas táctiles de al menos 44 px en móvil: botones, radios, tema y enlaces de navegación', async () => {
  await con({ ancho: 360 }, async page => {
    const cajas = await page.evaluate(() => {
      const sels = ['.boton', '.ciclo label', '#tema', 'header.cabecera nav a', '.salto'];
      const out = [];
      for (const s of sels) for (const e of document.querySelectorAll(s)) {
        const r = e.getBoundingClientRect();
        if (r.width > 0) out.push([s, e.textContent.trim().slice(0, 24), Math.round(r.width), Math.round(r.height)]);
      }
      return out;
    });
    verdadero(cajas.length >= 10, 'faltan controles que medir');
    const chicos = cajas.filter(c => c[2] < 44 || c[3] < 44);
    igual(chicos, [], 'controles menores de 44 px');
  });
});

await prueba('tamaño de letra en móvil: cuerpo >= 16 px y nada de texto menor a 12 px', async () => {
  await con({ ancho: 360 }, async page => {
    const prosa = await page.evaluate(() => ['.heroe__texto > p:nth-of-type(3)', '.principio--2 p:last-child', '.seccion-cab p:not(.eyebrow)', '.faq__resp p']
      .map(s => [s, parseFloat(getComputedStyle(document.querySelector(s)).fontSize)]));
    for (const [s, px] of prosa) verdadero(px >= 16, `texto de lectura ${s}: ${px}px`);
    const chicos = await page.evaluate(() => {
      const malos = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode; if (!n.textContent.trim()) continue;
        const el = n.parentElement; if (el.closest('noscript, script, style')) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) malos.push(`${el.tagName}.${el.className} ${fs}px`);
      }
      return malos;
    });
    igual(chicos, []);
  });
});

// ------------------------------------------------------------------ Contraste calculado
function pruebaContraste(esquema) {
  return prueba(`contraste WCAG >= 4.5:1 en textos reales (tema ${esquema})`, async () => {
    await con({ colorScheme: esquema }, async page => {
      await page.getByRole('radio', { name: 'Mensual', exact: true }).check({ force: true }); // fuerza otro estado y vuelve
      await page.getByRole('radio', { name: 'Anual', exact: true }).check({ force: true });
      for (const s of await page.locator('#preguntas summary').all()) await s.click();
      const bajos = await page.evaluate(() => {
        const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[ ,\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const mezcla = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const fondo = el => { const capas = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { capas.push(c); if (c.a === 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; if (!capas.length || capas[capas.length - 1].a < 1) base = parse(getComputedStyle(document.body).backgroundColor); for (let i = capas.length - 1; i >= 0; i--) base = mezcla(capas[i], base); return base; };
        const malos = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const vistos = new Set();
        while (w.nextNode()) {
          const n = w.currentNode; if (!n.textContent.trim()) continue;
          const el = n.parentElement; if (el.closest('noscript, script, style, [hidden]') || vistos.has(el)) continue;
          vistos.add(el);
          const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
          const f = fondo(el); const t = mezcla(parse(cs.color), f);
          const l1 = lum(t), l2 = lum(f); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 4.5) malos.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
        }
        return malos;
      });
      igual(bajos, [], 'textos con contraste insuficiente');
    });
  });
}
await pruebaContraste('light');
await pruebaContraste('dark');

// ------------------------------------------------------------------ Accesibilidad, calidad
await prueba('accesibilidad: una sola h1, jerarquía sin saltos, ids únicos, nombres accesibles y SVG decorativos ocultos', async () => {
  await con({}, async page => {
    const niveles = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => Number(h.tagName[1])));
    igual(niveles.filter(n => n === 1).length, 1);
    for (let i = 1; i < niveles.length; i++) verdadero(niveles[i] - niveles[i - 1] <= 1, `salto de encabezado ${niveles[i - 1]} -> ${niveles[i]}`);
    const dup = await page.evaluate(() => { const v = new Map(); for (const e of document.querySelectorAll('[id]')) v.set(e.id, (v.get(e.id) || 0) + 1); return [...v].filter(x => x[1] > 1).map(x => x[0]); });
    igual(dup, []);
    const sinNombre = await page.evaluate(() => {
      const nombre = e => {
        const l = e.getAttribute('aria-label'); if (l && l.trim()) return l.trim();
        const lb = e.getAttribute('aria-labelledby'); if (lb) return lb.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
        if (e.labels && e.labels.length) return [...e.labels].map(x => x.textContent).join(' ').trim();
        return e.textContent.trim();
      };
      return [...document.querySelectorAll('a[href], button, input, summary, select, textarea')].filter(e => !nombre(e)).map(e => e.outerHTML.slice(0, 80));
    });
    igual(sinNombre, []);
    const svgs = await page.evaluate(() => [...document.querySelectorAll('svg')].filter(s => s.getAttribute('aria-hidden') !== 'true' && !s.querySelector('title') && !s.getAttribute('aria-label')).map(s => s.outerHTML.slice(0, 60)));
    igual(svgs, [], 'SVG sin aria-hidden ni nombre');
    verdadero(await page.locator('header').count() >= 1 && await page.locator('main').count() === 1 && await page.locator('footer').count() === 1 && await page.locator('nav').count() >= 1, 'faltan puntos de referencia');
    igual(await page.locator('img').count(), 0, 'la landing no usa img sin alt');
  });
});

await prueba('anclas internas resuelven, enlaces solo a app.html o #, y ningún enlace vacío o muerto', async () => {
  await con({}, async page => {
    const r = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.textContent.trim()]));
    verdadero(r.length >= 12, 'faltan enlaces');
    for (const [href, t] of r) {
      verdadero(href && href !== '#' && !/^\s*javascript:/i.test(href), `enlace inútil: "${t}" -> ${href}`);
      verdadero(/^#[\w-]+$/.test(href) || /^app\.html(\?plan=(semilla|brote|bosque)&ciclo=(mensual|anual))?$/.test(href), `destino inesperado: ${href}`);
      if (href.startsWith('#')) verdadero(await page.locator(href).count() === 1, `ancla ${href} sin destino`);
    }
    const botones = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.id || b.textContent.trim()));
    verdadero(botones.length >= 1);
  });
});

await prueba('foco visible: cada parada de tabulación muestra anillo de foco (doble anillo)', async () => {
  await con({ ancho: 1440 }, async page => {
    const sinAnillo = [];
    let n = 0;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return null;
        const tiene = el => { const cs = getComputedStyle(el); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'; };
        let ok = tiene(e);
        if (!ok && e.matches('input[type=radio]')) { const l = e.closest('label'); ok = tiene(l) || [...l.querySelectorAll('*')].some(tiene); }
        const r = e.getBoundingClientRect();
        return { ok, etiqueta: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 30), enVista: r.width > 0 };
      });
      if (!info) break;
      n++;
      if (!info.ok) sinAnillo.push(info.etiqueta);
    }
    verdadero(n >= 20, `se esperaban >= 20 paradas de tabulación, hubo ${n}`);
    igual(sinAnillo, [], 'paradas sin anillo de foco');
  });
});

await prueba('movimiento reducido: con la preferencia no hay transiciones ni animaciones (y sin ella sí hay transiciones)', async () => {
  const medir = () => async page => page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 600));
    const largos = []; let total = 0;
    for (const e of document.querySelectorAll('a, button, label, summary, .plan, details')) {
      total++;
      const cs = getComputedStyle(e);
      for (const d of cs.transitionDuration.split(',')) if (parseFloat(d) > 0) { largos.push(e.className || e.tagName); break; }
    }
    return { total, anim: document.getAnimations().length, largos: [...new Set(largos)], scroll: getComputedStyle(document.documentElement).scrollBehavior };
  });
  const reducido = await con({ reducedMotion: 'reduce' }, medir());
  verdadero(reducido.total >= 20, `se esperaban >= 20 elementos interactivos, hubo ${reducido.total}`);
  igual(reducido.anim, 0); igual(reducido.largos, []); igual(reducido.scroll, 'auto');
  const normal = await con({ reducedMotion: 'no-preference' }, medir());
  verdadero(normal.largos.length > 0, 'control: sin la preferencia debe haber transiciones de 150-220 ms en algún elemento');
});

await prueba('sin recursos externos ni errores: todas las peticiones son locales o data:, consola limpia, sin emojis', async () => {
  await con({}, async (page, reg) => {
    for (const ciclo of ['Mensual', 'Anual']) await page.getByRole('radio', { name: ciclo, exact: true }).check({ force: true });
    await page.getByRole('button', { name: /Tema oscuro/ }).click();
    const externas = reg.peticiones.filter(u => !u.startsWith(srv.url) && !u.startsWith('data:'));
    igual(externas, []);
    igual(reg.errores, []); igual(reg.consola, []);
    verdadero(!/\p{Extended_Pictographic}|\uFE0F/u.test(HTML), 'el HTML contiene emojis o pictogramas');
    verdadero(!/(src|href)\s*=\s*["']\s*(https?:)?\/\//i.test(HTML) && !/url\(\s*["']?https?:/i.test(HTML), 'hay referencias externas en el HTML');
    verdadero(!/<(script|link)[^>]+(src|href)=["']https?:/i.test(HTML), 'script o link externo');
  });
});

await prueba('copy: sin frases de relleno de IA ni promesas fuera de la spec', async () => {
  verdadero(HTML.length > 0, 'ceiba/index.html no existe');
  const visible = HTML.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  for (const mala of [/revolucion/i, /potencia tu productividad/i, /inteligencia artificial/i, /\bIA\b/, /sincroniza(ción)? autom/i, /ilimitad/i, /nube/i])
    verdadero(!mala.test(visible), `copy prohibido: ${mala}`);
});

const codigo = resumen('landing');
await navegador.close();
await srv.cerrar();
process.exit(codigo);
