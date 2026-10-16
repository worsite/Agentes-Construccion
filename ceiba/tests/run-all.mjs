// Ejecuta todas las pruebas de Ceiba y devuelve código de salida distinto de 0 si alguna falla.
// Uso: node ceiba/tests/run-all.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const orden = ['unit.mjs', 'landing.mjs', 'e2e.mjs', 'calidad.mjs'];
const archivos = [...orden.filter(f => fs.existsSync(path.join(aqui, f))),
  ...fs.readdirSync(aqui).filter(f => /^reg-.*\.mjs$/.test(f)).sort()];
let fallas = 0;
for (const f of archivos) {
  console.log(`\n=== ${f}`);
  const r = spawnSync('node', [path.join(aqui, f)], { stdio: 'inherit' });
  if (r.status !== 0) { fallas++; console.log(`>>> ${f} terminó con código ${r.status}`); }
}
console.log(`\nResultado global: ${archivos.length - fallas}/${archivos.length} archivos de prueba sin fallas`);
process.exit(fallas ? 1 : 0);
