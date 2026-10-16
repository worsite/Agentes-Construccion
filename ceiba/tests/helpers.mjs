// Utilidades compartidas por las pruebas de Ceiba.
// Uso: import { servir, abrir, resumen } from './helpers.mjs'
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const raizGlobal = process.env.NPM_GLOBAL_ROOT || execSync('npm root -g').toString().trim();
export const { chromium } = require(path.join(raizGlobal, 'playwright'));

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // carpeta ceiba/
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };

/** Sirve ceiba/ (sin tests/) en un puerto libre. Devuelve { url, cerrar }. */
export async function servir() {
  const srv = http.createServer((req, res) => {
    const limpio = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = limpio === '/' ? 'index.html' : limpio.replace(/^\/+/, '');
    const abs = path.join(RAIZ, rel);
    if (!abs.startsWith(RAIZ) || rel.startsWith('tests') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404); return res.end('no encontrado');
    }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(abs)] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return { url, cerrar: () => new Promise(ok => srv.close(ok)) };
}

/** Lanza Chromium y devuelve { navegador, cerrar }. */
export async function lanzar() {
  const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  return { navegador, cerrar: () => navegador.close() };
}

/** Registro de pruebas muy simple: prueba(nombre, fn), al final resumen() devuelve código de salida. */
const resultados = [];
export async function prueba(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`  ok    ${nombre}`); }
  catch (e) { resultados.push({ nombre, ok: false, error: e }); console.log(`  FALLA ${nombre}\n        ${String(e && e.message || e).split('\n').join('\n        ')}`); }
}
export function resumen(titulo = 'pruebas') {
  const fallas = resultados.filter(r => !r.ok).length;
  console.log(`\n${titulo}: ${resultados.length - fallas} ok, ${fallas} con falla`);
  return fallas ? 1 : 0;
}

export function igual(real, esperado, msg = '') {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${msg}\n  esperado: ${b}\n  recibido: ${a}`);
}
export function verdadero(cond, msg = 'condición falsa') { if (!cond) throw new Error(msg); }
