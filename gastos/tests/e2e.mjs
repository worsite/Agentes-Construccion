// Pruebas de extremo a extremo con Supabase simulado. Uso: node gastos/tests/e2e.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = fs.readFileSync(path.join(RAIZ, 'tests/mock-supabase.js'), 'utf8');

const srv = http.createServer((req, res) => {
  const rel = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  const abs = path.join(RAIZ, rel);
  if (!abs.startsWith(RAIZ) || rel.startsWith('tests') || !fs.existsSync(abs)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': abs.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' });
  fs.createReadStream(abs).pipe(res);
});
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
const URL_ = `http://127.0.0.1:${srv.address().port}/`;

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => { try { await fn(); ok++; console.log('  ok   ' + nombre); } catch (e) { fallos++; console.log('  FALLA ' + nombre + '\n       ' + (e.message || e).split('\n')[0]); } };

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 390, height: 800 } });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', e => errores.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
await page.route('**/@supabase/supabase-js@*/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await page.goto(URL_);
const txt = () => page.locator('#app').innerText();
const ir = async h => { await page.evaluate(h => (location.hash = h), h); await page.waitForTimeout(150); };
const login = async (u, c = 'clave1234') => { await ir('#/ingresar'); await page.fill('input[name=usuario]', u); await page.fill('input[name=clave]', c); await page.click('button[type=submit]'); await page.waitForTimeout(250); };
const salir = async () => { await page.click('button[data-action=salir]'); await page.waitForTimeout(200); };
const hoyLocal = await page.evaluate(() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });

console.log('Panel general (sin sesion)');
await prueba('muestra gastos, reparto, minimo diario y porcentajes sin iniciar sesion', async () => {
  const t = await txt();
  assert.match(t, /Panel general/); assert.match(t, /Gas/); assert.match(t, /Pagado/); assert.match(t, /Agua/); assert.match(t, /Pendiente/);
  assert.match(t, /Falta por pagar este mes\s*\$\s?100\.000/);
  assert.match(t, /Cada usuario paga\s*\$\s?50\.000/);           // 100.000 / 2 usuarios aprobados
  assert.match(t, /Mínimo por día \(25 días\)\s*\$\s?2\.000/);   // 50.000 / 25
  assert.match(t, /Ana/); assert.match(t, /Miguel/); assert.match(t, /Ingresar a mi perfil/); assert.match(t, /Crear perfil/);
});
await prueba('sin scroll horizontal a 390 px', async () => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
await prueba('/perfil sin sesion redirige a ingresar', async () => { await ir('#/perfil'); assert.match(await txt(), /Ingresar a mi perfil/); });

console.log('Tema claro/oscuro');
await prueba('el interruptor cambia el tema y se recuerda tras recargar', async () => {
  const antes = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#tema');
  const ahora = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  assert.ok(ahora === 'dark' || ahora === 'light'); assert.notEqual(ahora, antes);
  await page.reload(); await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), ahora);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.ok(bg); await page.click('#tema');
});

console.log('Registro y aprobacion');
await prueba('registro valida, envia solicitud y mantiene la sesion', async () => {
  await ir('#/registro');
  await page.fill('input[name=nombre]', 'Luis <b>X</b>'); await page.fill('input[name=usuario]', 'Luis Z'); await page.fill('input[name=clave]', '12345678'); await page.fill('input[name=clave2]', '12345678');
  await page.click('button[type=submit]'); assert.match(await txt(), /Usuario: 3 a 20/);
  await page.fill('input[name=usuario]', 'luis'); await page.fill('input[name=clave2]', 'otra');
  await page.click('button[type=submit]'); assert.match(await txt(), /no coinciden/);
  await page.fill('input[name=clave2]', '12345678'); await page.click('button[type=submit]'); await page.waitForTimeout(300);
  assert.match(await txt(), /Pendiente de aprobación/);           // quedo dentro, sin pedir la clave otra vez
  assert.equal(await page.locator('button[data-action=salir]').count(), 1);
});
await prueba('la sesion sobrevive a recargar la pagina (no pide contraseña)', async () => {
  await page.reload(); await page.waitForTimeout(300); await ir('#/perfil');
  assert.match(await txt(), /Hola, Luis/); assert.equal(await page.locator('input[name=clave]').count(), 0);
  await salir();
});
await prueba('usuario duplicado se informa', async () => {
  await ir('#/registro');
  await page.fill('input[name=nombre]', 'Otra'); await page.fill('input[name=usuario]', 'ana'); await page.fill('input[name=clave]', '12345678'); await page.fill('input[name=clave2]', '12345678');
  await page.click('button[type=submit]'); await page.waitForTimeout(200); assert.match(await txt(), /ya existe/);
});
await prueba('clave incorrecta muestra error', async () => { await login('ana', 'mala'); assert.match(await txt(), /incorrectos/); });
await prueba('usuario normal no accede a /admin', async () => { await login('ana'); await ir('#/admin'); assert.doesNotMatch(await txt(), /Solicitudes de perfil/); await salir(); });
await prueba('admin ve solo el nombre de la solicitud y aprueba; la cuota se reparte entre 3', async () => {
  await login('miguel'); await ir('#/admin'); const t = await txt();
  assert.match(t, /Solicitudes de perfil \(1\)/); assert.match(t, /Luis <b>X<\/b>/);
  assert.equal(await page.locator('#app b').count(), 0); assert.doesNotMatch(t, /@luis/);
  assert.doesNotMatch(t, /Cuota mensual por usuario/);          // el admin ya no fija cuotas
  await page.click('button[data-action=estado][data-s=approved]'); await page.waitForTimeout(250);
  const t2 = await txt(); assert.match(t2, /Solicitudes de perfil \(0\)/);
  assert.match(t2, /Cada uno paga\s*\$\s?33\.334/);              // ceil(100.000 / 3)
});
await prueba('admin agrega gasto, marca pagado y lo escapa; el reparto se recalcula', async () => {
  await page.fill('form[data-form=gasto] input[name=nombre]', '<img src=x onerror=window.__xss=1>'); await page.fill('form[data-form=gasto] input[name=monto]', '20000');
  await page.click('form[data-form=gasto] button[type=submit]'); await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.match(await txt(), /Cada uno paga\s*\$\s?40\.000/);     // 120.000 / 3
  await page.check('input[data-change=gasto-pagado] >> nth=1'); await page.waitForTimeout(250);
  await ir('#/'); const t = await txt(); assert.match(t, /<img src=x/); assert.match(t, /Servicios ya pagados: \$\s?100\.000 de \$\s?120\.000/);
  assert.match(t, /Mínimo por día \(25 días\)\s*\$\s?1\.600/);   // 40.000 / 25
});
await prueba('admin copia gastos del mes anterior', async () => {
  await ir('#/admin'); await page.click('button[data-action=mes][data-n="1"]'); await page.waitForTimeout(150);
  await page.click('button[data-action=copiar]'); await page.waitForTimeout(250);
  assert.match(await txt(), /Gas/); assert.match(await txt(), /Pendiente/);
  await page.click('button[data-action=mes][data-n="-1"]');
});
await salir();

console.log('Pagar (movil)');
await prueba('barra inferior con 5 accesos, boton Pagar destacado y areas tactiles de 44 px', async () => {
  await login('ana'); await ir('#/perfil?t=pagar');
  assert.equal(await page.locator('#bnav a').count(), 5);
  assert.equal(await page.locator('#bnav a.cta').count(), 1);
  const tops = await page.$$eval('#bnav a', els => els.map(e => Math.round(e.getBoundingClientRect().bottom)));
  assert.equal(new Set(tops).size, 1, 'los 5 accesos deben quedar en una sola fila: ' + tops);
  assert.equal(await page.evaluate(() => { const r = document.getElementById('bnav').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.height < 100; }), true);
  const cajas = await page.$$eval('#bnav a, #app .btn, #app .chips2 button', els => els.filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 20), Math.round(r.width), Math.round(r.height)]; }));
  const chicos = cajas.filter(([, w, h]) => h < 44 || w < 44);
  assert.deepEqual(chicos, []);
});
await prueba('la pantalla Pagar muestra debes a la fecha / hoy / falta y atajos', async () => {
  const t = await txt();
  assert.match(t, /Debes a la fecha/); assert.match(t, /Hoy llevas/); assert.match(t, /Falta del mes/);
  assert.match(t, /Mínimo de hoy/); assert.match(t, /\$\s?10\.000/); assert.match(t, /\$\s?50\.000/);
  assert.equal(await page.locator('#fechaIn').isVisible(), false);          // la fecha de hoy va por defecto, oculta
  assert.match(await page.locator('#fechaTxt').innerText(), /^Hoy/);
});
await prueba('un atajo rellena el monto con puntos de miles; el teclado es numerico', async () => {
  assert.equal(await page.getAttribute('#monto', 'inputmode'), 'numeric');
  await page.click('.chips2 button >> nth=-1'); assert.equal(await page.inputValue('#monto'), '50.000');
  await page.fill('#monto', ''); await page.type('#monto', '1234567'); assert.equal(await page.inputValue('#monto'), '1.234.567');
  await page.fill('#monto', '');
});
await prueba('registrar pago: hoy por defecto, fecha modificable, aviso con lo que falta', async () => {
  assert.equal(await page.inputValue('#fechaIn input'), hoyLocal);
  await page.fill('#monto', '30.000'); await page.check('form[data-form=pago] input[value=transferencia]');
  await page.click('form[data-form=pago] button[type=submit]'); await page.waitForTimeout(300);
  let t = await txt(); assert.match(t, /Pago de \$\s?30\.000 registrado/); assert.match(t, /Te faltan \$\s?10\.000 del mes/);
  await page.fill('#monto', '10000'); await page.click('button[data-action=fecha]'); assert.equal(await page.locator('#fechaIn').isVisible(), true);
  await page.fill('#fechaIn input', hoyLocal.slice(0, 8) + '01'); assert.doesNotMatch(await page.locator('#fechaTxt').innerText(), /^Hoy/);
  await page.click('form[data-form=pago] button[type=submit]'); await page.waitForTimeout(300);
  t = await txt(); assert.match(t, /Pago de \$\s?10\.000 registrado/); assert.match(t, /Cuota del mes completa/);
});
await prueba('monto invalido muestra error y no guarda', async () => {
  const antes = await page.evaluate(() => window.__db.payments.length);
  await page.fill('#monto', 'abc'); await page.click('form[data-form=pago] button[type=submit]');
  assert.match(await txt(), /monto válido/); assert.equal(await page.evaluate(() => window.__db.payments.length), antes);
});
await prueba('cada pago reduce lo que falta en el panel general (sin exponer el metodo)', async () => {
  await ir('#/'); const t = await txt();
  assert.match(t, /Falta por pagar este mes\s*\$\s?80\.000/);     // 120.000 - 40.000
  assert.match(t, /Pagó \$\s?40\.000 de \$\s?40\.000/); assert.doesNotMatch(t, /Transferencia|Efectivo/);
});
await prueba('el panel marca quien esta al dia y quien debe a la fecha', async () => {
  const t = await txt(); assert.match(t, /Al día/); assert.match(t, /Debe \$\s?[\d.]+ a la fecha/);
});

console.log('Mi cuenta: cuanto debo, cuanto he pagado, cuanto falta');
await prueba('resumen claro: cuota, pagado, falta y estado a la fecha', async () => {
  await ir('#/perfil'); const t = await txt();
  assert.match(t, /Estás al día/); assert.match(t, /Cuota del mes\s*\$\s?40\.000/); assert.match(t, /Has pagado\s*\$\s?40\.000/); assert.match(t, /Falta del mes\s*\$\s?0/);
  assert.match(t, /Método principal del mes\s*Transferencia/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
await prueba('ingreso necesario: minimo diario, hoy cumplido y desglose', async () => {
  const t = await txt();
  assert.match(t, /Debes generar al día\s*\$\s?1\.600/); assert.match(t, /Cumpliste el mínimo de hoy/);
  assert.match(t, /Gastos compartidos[\s\S]*\$\s?1\.600/);
});
await prueba('crear deuda y elegir cuanto pagar al dia suma al ingreso necesario', async () => {
  await ir('#/perfil?t=deudas');
  await page.fill('form[data-form=deuda] input[name=nombre]', 'Tarjeta'); await page.fill('form[data-form=deuda] input[name=monto]', '1.000.000'); await page.click('form[data-form=deuda] button[type=submit]'); await page.waitForTimeout(250);
  await ir('#/perfil');
  await page.fill('form[data-form=plan] input[name=monto]', '20.000'); await page.click('form[data-form=plan] button[type=submit]'); await page.waitForTimeout(250);
  const t = await txt();
  assert.match(t, /Debes generar al día\s*\$\s?21\.600/); assert.match(t, /Mis deudas\s*\$\s?20\.000/); assert.match(t, /~50 días/);
  await page.fill('form[data-form=plan] input[name=monto]', '0'); await page.click('form[data-form=plan] button[type=submit]'); await page.waitForTimeout(250);
  assert.match(await txt(), /Debes generar al día\s*\$\s?1\.600/);
});
await prueba('usuario atrasado ve cuanto debe a la fecha', async () => {
  await salir(); await login('miguel'); await ir('#/perfil'); const t = await txt();
  assert.match(t, /Debes a la fecha\s*\$\s?[\d.]+/); assert.doesNotMatch(t, /Estás al día/);
  assert.match(t, /Aún no cumples el mínimo de hoy/);
  await salir(); await login('ana');
});
await prueba('barra inferior oculta en escritorio y menu superior visible', async () => {
  await page.setViewportSize({ width: 1000, height: 800 });
  assert.equal(await page.locator('#bnav').isVisible(), false); assert.equal(await page.locator('#nav a.dsk >> text=Pagar').isVisible(), true);
  await page.setViewportSize({ width: 390, height: 800 });
});

console.log('Perfil privado: ahorros y deudas');
await prueba('ahorros: crear cuenta con meta y registrar aporte', async () => {
  await ir('#/perfil?t=ahorros');
  await page.fill('form[data-form=cuenta] input[name=nombre]', 'Viaje'); await page.fill('form[data-form=cuenta] input[name=meta]', '200000'); await page.click('form[data-form=cuenta] button[type=submit]'); await page.waitForTimeout(250);
  await page.fill('form[data-form=ahorro] input[name=monto]', '50000'); await page.click('form[data-form=ahorro] button[type=submit]'); await page.waitForTimeout(250);
  const t = await txt(); assert.match(t, /Viaje/); assert.match(t, /25%/);
});
await prueba('deudas: vienen plegadas y se despliegan al tocar el nombre', async () => {
  await ir('#/perfil?t=deudas');
  assert.equal(await page.locator('details.debt[open]').count(), 0);
  assert.equal(await page.locator('details.debt form[data-form=pago-deuda]').isVisible(), false);
  assert.match(await txt(), /Tarjeta/);                            // el nombre y el resumen si se ven
  await page.click('details.debt > summary'); await page.waitForTimeout(100);
  assert.equal(await page.locator('details.debt form[data-form=pago-deuda]').isVisible(), true);
});
await prueba('deudas: pagar, actualizar valor y proyectar (el detalle sigue abierto)', async () => {
  await page.fill('form[data-form=pago-deuda] input[name=monto]', '250000'); await page.click('form[data-form=pago-deuda] button[type=submit]'); await page.waitForTimeout(250);
  assert.equal(await page.locator('details.debt[open]').count(), 1);
  let t = await txt(); assert.match(t, /25% pagado/); assert.match(t, /\$\s?750\.000/);
  await page.fill('form[data-form=saldo-deuda] input[name=monto]', '800000'); await page.click('form[data-form=saldo-deuda] button[type=submit]'); await page.waitForTimeout(250);
  t = await txt(); assert.match(t, /\$\s?800\.000/);
  const fut = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 70); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  await page.fill('#df', fut); await page.dispatchEvent('#df', 'change'); await page.waitForTimeout(250);
  t = await txt(); assert.match(t, /Por mes/); assert.match(t, /Por semana/); assert.match(t, /70 días/);
});
await prueba('eliminar una deuda pide confirmacion', async () => {
  page.once('dialog', d => d.dismiss());
  await page.click('button[data-action=del][data-t=debts]'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__db.debts.length), 1);
});
await salir();
await prueba('ahorros y deudas de Ana NO son visibles para Miguel (admin)', async () => {
  await login('miguel'); await ir('#/perfil?t=ahorros'); assert.doesNotMatch(await txt(), /Viaje/);
  await ir('#/perfil?t=deudas'); assert.doesNotMatch(await txt(), /Tarjeta/);
});
await prueba('modo oscuro: sin scroll horizontal', async () => {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await ir('#/');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
console.log('Admin: gastos y deuda general');
await prueba('el formulario alterna entre gasto del mes y deuda general', async () => {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await ir('#/admin');
  assert.equal(await page.locator('#mesesBox').isVisible(), false); assert.match(await page.locator('#gBtn').innerText(), /Agregar gasto/);
  await page.check('input[name=tipo][value=deuda]');
  assert.equal(await page.locator('#mesesBox').isVisible(), true); assert.match(await page.locator('#gBtn').innerText(), /Agregar deuda general/);
});
await prueba('crear una deuda general la reparte en cuotas y sube la cuota de todos', async () => {
  await page.fill('#gn', 'Reparación'); await page.fill('#gm', '300.000'); await page.selectOption('#gme', '3');
  await page.click('#gBtn'); await page.waitForTimeout(300);
  const t = await txt();
  assert.match(t, /Total de gastos de[\s\S]*\$\s?220\.000/);          // 120.000 + 100.000 (primera cuota)
  assert.match(t, /Cada uno paga\s*\$\s?73\.334/);                     // ceil(220.000 / 3)
  assert.match(t, /Reparación \(1\/3\)/); assert.match(t, /0 de 3 cuotas pagadas/);
  assert.equal(await page.locator('form[data-form=gasto-monto]:has(input[aria-label*="Reparación"]) button[data-action=del]').count(), 0); // las cuotas no se borran sueltas
  assert.equal(await page.evaluate(() => window.__db.general_expenses.filter(g => g.debt_id).reduce((s, g) => s + g.amount, 0)), 300000);
});
await prueba('marcar una cuota como pagada avanza la deuda; se ve en el panel publico', async () => {
  await page.check('label:has-text("Reparación (1/3)") input[data-change=gasto-pagado]'); await page.waitForTimeout(250);
  assert.match(await txt(), /1 de 3 cuotas pagadas/); assert.match(await txt(), /Pagado \$\s?100\.000 · Falta \$\s?200\.000/);
  await salir(); await ir('#/'); const t = await txt();
  assert.match(t, /Deudas generales/); assert.match(t, /Reparación/); assert.match(t, /Deuda general/);
  assert.match(t, /Cada usuario paga\s*\$\s?73\.334/);
  await ir('#/'); await page.click('button[data-action=mes][data-n="1"]'); await page.waitForTimeout(250);
  assert.match(await txt(), /Reparación \(2\/3\)/);                    // sigue el mes siguiente hasta saldarse
  await page.click('button[data-action=mes][data-n="-1"]');
});
await prueba('copiar gastos del mes anterior no duplica las cuotas de la deuda', async () => {
  await login('miguel'); await ir('#/admin'); await page.click('button[data-action=mes][data-n="1"]'); await page.waitForTimeout(200);
  const antes = await page.evaluate(() => window.__db.general_expenses.length);
  await page.click('button[data-action=copiar]'); await page.waitForTimeout(250);
  const despues = await page.evaluate(() => window.__db.general_expenses.filter(g => g.name === 'Reparación (1/3)').length);
  assert.equal(despues, 1); await page.click('button[data-action=mes][data-n="-1"]');
});
await prueba('eliminar la deuda general borra todas sus cuotas (con confirmacion)', async () => {
  page.once('dialog', d => d.accept());
  await page.click('button[data-action=borrar-dg]'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__db.general_debts.length + window.__db.general_expenses.filter(g => g.debt_id).length), 0);
  assert.doesNotMatch(await txt(), /Reparación/); assert.match(await txt(), /Cada uno paga\s*\$\s?40\.000/);
});
await prueba('admin en celular: sin scroll horizontal y controles tactiles de 44 px', async () => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const chicos = await page.$$eval('#app .btn, #app select, #app input:not([type=checkbox]):not([type=radio])', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.outerHTML.slice(0, 60)));
  assert.deepEqual(chicos, []);
});
await prueba('sin errores de consola ni violaciones de CSP', async () => { assert.deepEqual(errores, []); });

console.log(`\n${ok} ok, ${fallos} fallas`);
await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
