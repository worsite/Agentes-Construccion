// Genera los iconos PNG/SVG de la app a partir de un SVG. Uso: node gastos/tools/generar-iconos.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const SALIDA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../icons');

const glifo = `<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2"/><circle cx="16.5" cy="14" r="1.1" fill="#fff"/>`;
// Fondo a sangre (sin esquinas): sirve para "maskable" (Android) y para apple-touch-icon (iOS redondea solo).
const svg = (redondeo = 0, escala = 12) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A7D70"/><stop offset="1" stop-color="#1D5FD6"/></linearGradient></defs>
<rect width="512" height="512" rx="${redondeo}" fill="url(#g)"/>
<g transform="translate(256 256) scale(${escala}) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${glifo}</g></svg>`;

fs.mkdirSync(SALIDA, { recursive: true });
fs.writeFileSync(path.join(SALIDA, 'favicon.svg'), svg(112, 12));
const nav = await chromium.launch();
const pag = await nav.newPage();
for (const [archivo, tam] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  await pag.setViewportSize({ width: tam, height: tam });
  await pag.setContent(`<body style="margin:0">${svg(0, 12).replace('<svg ', `<svg width="${tam}" height="${tam}" `)}</body>`);
  await pag.screenshot({ path: path.join(SALIDA, archivo), clip: { x: 0, y: 0, width: tam, height: tam } });
}
await nav.close();
console.log('Iconos generados en', SALIDA);
