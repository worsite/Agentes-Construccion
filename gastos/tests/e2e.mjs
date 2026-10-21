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
await page.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await page.goto(URL_);
const txt = () => page.locator('#app').innerText();
const ir = async h => { await page.evaluate(h => (location.hash = h), h); await page.waitForTimeout(150); };
const login = async (u, c = 'clave1234') => { await ir('#/ingresar'); await page.fill('input[name=usuario]', u); await page.fill('input[name=clave]', c); await page.click('button[type=submit]'); await page.waitForTimeout(250); };
const salir = async () => { await page.click('button[data-action=salir]'); await page.waitForTimeout(200); };
const hoyLocal = await page.evaluate(() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });

console.log('Panel general (sin sesion)');
await prueba('muestra gastos, porcentajes y personas sin iniciar sesion', async () => {
  const t = await txt();
  assert.match(t, /Panel general/); assert.match(t, /Gas/); assert.match(t, /Pagado/); assert.match(t, /Agua/); assert.match(t, /Pendiente/);
  assert.match(t, /60%/);            // 60.000 de 100.000 en gastos
  assert.match(t, /Ana/); assert.match(t, /Miguel/);
  assert.match(t, /Ingresar a mi perfil/); assert.match(t, /Crear perfil/);
});
await prueba('sin scroll horizontal a 390 px', async () => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
await prueba('/perfil sin sesion redirige a ingresar', async () => { await ir('#/perfil'); assert.match(await txt(), /Ingresar a mi perfil/); });

console.log('Registro y aprobacion');
await prueba('registro valida y envia solicitud', async () => {
  await ir('#/registro');
  await page.fill('input[name=nombre]', 'Luis <b>X</b>'); await page.fill('input[name=usuario]', 'Luis Z'); await page.fill('input[name=clave]', '12345678'); await page.fill('input[name=clave2]', '12345678');
  await page.click('button[type=submit]'); assert.match(await txt(), /Usuario: 3 a 20/);
  await page.fill('input[name=usuario]', 'luis'); await page.fill('input[name=clave2]', 'otra');
  await page.click('button[type=submit]'); assert.match(await txt(), /no coinciden/);
  await page.fill('input[name=clave2]', '12345678'); await page.click('button[type=submit]'); await page.waitForTimeout(250);
  assert.match(await txt(), /Solicitud enviada/);
});
await prueba('usuario duplicado se informa', async () => {
  await ir('#/'); await ir('#/registro');
  await page.fill('input[name=nombre]', 'Otra'); await page.fill('input[name=usuario]', 'ana'); await page.fill('input[name=clave]', '12345678'); await page.fill('input[name=clave2]', '12345678');
  await page.click('button[type=submit]'); await page.waitForTimeout(200); assert.match(await txt(), /ya existe/);
});
await prueba('clave incorrecta muestra error', async () => { await login('ana', 'mala'); assert.match(await txt(), /incorrectos/); });
await prueba('usuario pendiente solo ve aviso de aprobacion', async () => {
  await login('luis', '12345678'); await ir('#/perfil'); const t = await txt();
  assert.match(t, /Pendiente de aprobación/); assert.doesNotMatch(t, /Registrar pago/); await salir();
});
await prueba('usuario normal no accede a /admin', async () => { await login('ana'); await ir('#/admin'); assert.doesNotMatch(await txt(), /Solicitudes de perfil/); await salir(); });
await prueba('admin ve solo el nombre de la solicitud y aprueba', async () => {
  await login('miguel'); await ir('#/admin'); const t = await txt();
  assert.match(t, /Solicitudes de perfil \(1\)/); assert.match(t, /Luis <b>X<\/b>/);       // texto literal, escapado
  assert.equal(await page.locator('#app b').count(), 0);                                    // sin HTML inyectado
  assert.doesNotMatch(t, /@luis/);
  await page.click('button[data-action=estado][data-s=approved]'); await page.waitForTimeout(200);
  assert.match(await txt(), /Solicitudes de perfil \(0\)/);
});
await prueba('admin cambia cuota y el panel lo refleja', async () => {
  await page.fill('form[data-form=cuota] >> nth=2 >> input[name=monto]', '50.000'); await page.click('form[data-form=cuota] >> nth=2 >> button'); await page.waitForTimeout(200);
  await ir('#/'); assert.match(await txt(), /Debe \$\s?50\.000/);
});
await prueba('admin agrega gasto, edita monto, marca pagado y lo escapa', async () => {
  await ir('#/admin');
  await page.fill('form[data-form=gasto] input[name=nombre]', '<img src=x onerror=window.__xss=1>'); await page.fill('form[data-form=gasto] input[name=monto]', '20000');
  await page.click('form[data-form=gasto] button[type=submit]'); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await page.check('input[data-change=gasto-pagado] >> nth=1'); await page.waitForTimeout(200);
  await ir('#/'); const t = await txt(); assert.match(t, /<img src=x/); assert.match(t, /83%/);   // pagados 60k + 40k de 120k
});
await prueba('admin copia gastos al mes anterior vacio (copia desde mes previo)', async () => {
  await ir('#/admin'); await page.click('button[data-action=mes][data-n="1"]'); await page.waitForTimeout(150);
  await page.click('button[data-action=copiar]'); await page.waitForTimeout(200);
  assert.match(await txt(), /Gas/); assert.match(await txt(), /Pendiente/);
  await page.click('button[data-action=mes][data-n="-1"]');
});
await salir();

console.log('Perfil privado: pagos');
await prueba('registrar pago con fecha de hoy por defecto, y fecha modificada', async () => {
  await login('ana'); await ir('#/perfil');
  assert.equal(await page.inputValue('form[data-form=pago] input[name=fecha]'), hoyLocal);
  await page.fill('form[data-form=pago] input[name=monto]', '30.000'); await page.check('form[data-form=pago] input[value=transferencia]');
  await page.click('form[data-form=pago] button[type=submit]'); await page.waitForTimeout(200);
  await page.fill('form[data-form=pago] input[name=monto]', '10000');
  await page.fill('form[data-form=pago] input[name=fecha]', hoyLocal.slice(0, 8) + '01'); await page.click('form[data-form=pago] button[type=submit]'); await page.waitForTimeout(200);
  const t = await txt();
  assert.match(t, /\$\s?40\.000/);                 // acumulado del mes
  assert.match(t, /Método principal del mes:\s*Transferencia/); assert.match(t, /40%/);   // 40k de la cuota de 100k
});
await prueba('monto invalido muestra error y no guarda', async () => {
  const antes = await page.evaluate(() => window.__db.payments.length);
  await page.fill('form[data-form=pago] input[name=monto]', 'abc'); await page.click('form[data-form=pago] button[type=submit]');
  assert.match(await txt(), /monto válido/); assert.equal(await page.evaluate(() => window.__db.payments.length), antes);
});
await prueba('el panel general refleja el pago pero no el metodo', async () => {
  await ir('#/'); const t = await txt(); assert.match(t, /Pagado \$\s?40\.000/); assert.doesNotMatch(t, /Transferencia|Efectivo/);
});

console.log('Perfil privado: ahorros y deudas');
await prueba('ahorros: crear cuenta con meta y registrar aporte', async () => {
  await ir('#/perfil?t=ahorros');
  await page.fill('form[data-form=cuenta] input[name=nombre]', 'Viaje'); await page.fill('form[data-form=cuenta] input[name=meta]', '200000'); await page.click('form[data-form=cuenta] button[type=submit]'); await page.waitForTimeout(200);
  await page.fill('form[data-form=ahorro] input[name=monto]', '50000'); await page.click('form[data-form=ahorro] button[type=submit]'); await page.waitForTimeout(200);
  const t = await txt(); assert.match(t, /Viaje/); assert.match(t, /25%/);
});
await prueba('deudas: registrar, pagar, actualizar valor y proyectar', async () => {
  await ir('#/perfil?t=deudas');
  await page.fill('form[data-form=deuda] input[name=nombre]', 'Tarjeta'); await page.fill('form[data-form=deuda] input[name=monto]', '1.000.000'); await page.click('form[data-form=deuda] button[type=submit]'); await page.waitForTimeout(200);
  await page.fill('form[data-form=pago-deuda] input[name=monto]', '250000'); await page.click('form[data-form=pago-deuda] button[type=submit]'); await page.waitForTimeout(200);
  let t = await txt(); assert.match(t, /25% pagado/); assert.match(t, /Falta por pagar\s*\$\s?750\.000/);
  await page.fill('form[data-form=saldo-deuda] input[name=monto]', '800000'); await page.click('form[data-form=saldo-deuda] button[type=submit]'); await page.waitForTimeout(200);
  t = await txt(); assert.match(t, /Falta por pagar\s*\$\s?800\.000/);        // el nuevo valor ya incluye intereses y pagos previos
  const fut = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 70); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  await page.fill('#df', fut); await page.dispatchEvent('#df', 'change'); await page.waitForTimeout(200);
  t = await txt(); assert.match(t, /Por mes/); assert.match(t, /Por semana/); assert.match(t, /70 días/);
  await page.selectOption('#ds', { index: 1 }); await page.waitForTimeout(200);
  await page.fill('#df', fut); await page.dispatchEvent('#df', 'change'); await page.waitForTimeout(150);
  await page.click('button[data-action=guardar-fecha]'); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__db.debts[0].target_date !== undefined), true);
});
await prueba('eliminar un pago pide confirmacion en borrados grandes', async () => {
  await ir('#/perfil'); page.once('dialog', d => d.dismiss());
  await ir('#/perfil?t=deudas'); await page.click('button[data-action=del][data-t=debts]'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__db.debts.length), 1);
});
await salir();
await prueba('ahorros y deudas de Ana NO son visibles para Miguel (admin)', async () => {
  await login('miguel'); await ir('#/perfil?t=ahorros'); assert.doesNotMatch(await txt(), /Viaje/);
  await ir('#/perfil?t=deudas'); assert.doesNotMatch(await txt(), /Tarjeta/);
});
await prueba('sin errores de consola ni violaciones de CSP', async () => { assert.deepEqual(errores, []); });

console.log(`\n${ok} ok, ${fallos} fallas`);
await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
