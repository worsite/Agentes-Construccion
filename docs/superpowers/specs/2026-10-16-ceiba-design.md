# Ceiba: diseño de la aplicación de notas y su landing de precios

Fecha: 2026-10-16. Nivel (constructor): BLAST. Estado: aprobado por delegación explícita del alumno ("todo lo inventas tú").

## 1. Intención

Una aplicación de notas en markdown pensada para escribir sin ruido, que se vende por suscripción mensual o anual. El alumno entrega dos archivos:

1. `ceiba/index.html`: landing page que presenta el producto y muestra los precios. Selector Mensual/Anual y, en cada ciclo, tres paquetes.
2. `ceiba/app.html`: la aplicación completa.

`index.html` es la landing porque en Netlify la raíz debe servir `index.html`. Más `ceiba/README.md` con pruebas, límites y pasos de Netlify.

Primera victoria: abrir la app, ver una nota de bienvenida real, empezar a escribir y ver el resultado renderizado con un solo atajo.

### Metas
- Escribir sin distracciones: un panel de texto, una lista discreta, cero adornos.
- Todo funciona con teclado.
- Los datos no se pierden: guardado automático, copia de seguridad en archivo.
- Estética orgánica, cálida y editorial; reconocible como hecha por una persona.

### No metas
- Cuentas, sincronización, pagos, servidor. Nada de eso existe en esta versión (ver sección 9).
- Editor WYSIWYG. Es edición de texto plano con vista previa.
- Soporte completo de CommonMark. Se renderiza un subconjunto documentado.

### Antimetas (aunque técnicamente funcione, es un fracaso)
- Emojis en cualquier parte (interfaz, copy, README, datos de ejemplo, commits).
- Look genérico de IA: degradados morados, tarjetas de vidrio, rejilla de tres iconos con círculo de color, texto "revolucionario", "potencia tu productividad".
- Botones o enlaces sin acción real.
- Prometer como existente algo que la app no hace.

## 2. Decisiones de cómo se hace (son decisiones mías, no del alumno)

- HTML, CSS y JavaScript vanilla, sin build ni dependencias. Cada página es un archivo autocontenido (CSS y JS en línea). Sin fuentes ni recursos externos: funciona sin conexión.
- Tipografía con pilas del sistema (no se descarga nada): serif `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif` para títulos y texto de escritura; sans `"Avenir Next", "Segoe UI", system-ui, -apple-system, sans-serif` para interfaz; mono `ui-monospace, "SF Mono", Menlo, Consolas, monospace` para código.
- Idioma: español neutro. Moneda de los precios: USD. Todos los nombres y precios son inventados.
- CSP por `<meta http-equiv="Content-Security-Policy">`: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'`. Se verifica que no rompa nada. (`connect-src` queda en `'none'` por el `default-src`; `app.html` descarga archivos con `Blob`/`URL.createObjectURL` y esto debe seguir funcionando; si la CSP lo impide, añadir solo `blob:` a la directiva mínima necesaria.)
- Prueba automática con Playwright (Chromium ya instalado en `/opt/pw-browsers`, paquete `playwright` global de npm) en `ceiba/tests/`.

## 3. Marca y sistema visual

Nombre: **Ceiba**. Descriptor: "cuaderno de notas en markdown". Lema: "Un cuaderno quieto para escribir".

Familia visual (de las seis del constructor): wellness minimalista con matiz editorial pastel. Elegida porque la herramienta es personal y de foco. La base de datos de UI/UX Pro Max recomienda para "Notes & Writing App" tinta cálida, ámbar y crema; se adopta la idea (papel crema, tinta cálida) y se desvía a propósito a verde musgo + terracota para evitar el ámbar genérico.

### Tokens (CSS custom properties, en `:root`; modo oscuro bajo `@media (prefers-color-scheme: dark)` guardado por `:root:not([data-theme="light"])` y también `:root[data-theme="dark"]`)

Claro:
- `--papel: #FBF6EA` fondo de página
- `--hoja: #FFFDF7` superficies (editor, tarjetas)
- `--tinta: #2B2620` texto principal
- `--tinta-suave: #5E554A` texto secundario (contraste >= 4.5:1 sobre `--papel`)
- `--linea: #E3D9C4` bordes y reglas
- `--musgo: #4B5A35` acción primaria (texto blanco encima, >= 4.5:1)
- `--musgo-oscuro: #3A4728` hover primario
- `--terracota: #9C4A27` énfasis de texto (>= 4.5:1 sobre `--papel`)
- `--arcilla: #E7C9A5` decoración (nunca texto)
- `--peligro: #A3281E` eliminar
- `--foco: #1F5FBF` anillo de foco (doble anillo: 2px + 2px de separación con `--papel`)

Oscuro: `--papel: #1B1915`, `--hoja: #24211C`, `--tinta: #EEE6D4`, `--tinta-suave: #B9AE9B`, `--linea: #3A352C`, `--musgo: #A9BC87` (texto oscuro `#1B1915` encima), `--musgo-oscuro: #BFD0A0`, `--terracota: #E5987A`, `--arcilla: #5A4631`, `--peligro: #F08A7E`, `--foco: #8DB8FF`.

Los pares texto/fondo reales se verifican con un script de contraste (WCAG 2.x) en las pruebas, para ambos temas.

### Forma y ritmo
- Espaciado: 4, 8, 12, 16, 24, 32, 48, 72. Cuerpo 17-18 px en escritura, 16 px en interfaz, interlineado 1.6-1.7. Ancho de columna de lectura 62-70 caracteres (`max-width: 68ch`).
- Formas orgánicas: radios asimétricos (por ejemplo `28px 20px 26px 22px`) en tarjetas grandes y botones tipo píldora irregular solo donde aporte; nada de rejillas perfectamente simétricas. Sombras casi inexistentes: bordes finos y fondos distintos.
- Textura: grano de papel muy sutil con SVG `feTurbulence` en un `data:` URI como fondo, opacidad baja. Debe respetar `prefers-reduced-motion` (es estática) y no afectar al contraste.
- Ilustración: una rama de ceiba dibujada como SVG lineal en línea (hojas, espinas del tronco, trazo de 1.5 px, color `--musgo`/`--terracota`), hecha a mano en el código, usada en la cabecera de la landing y en estados vacíos de la app. Sin iconos de librerías: los iconos de interfaz (nueva nota, buscar, eliminar, vista previa, tema, ayuda) son SVG en línea propios, trazo 1.75 px, con `aria-hidden` y siempre con texto o `aria-label`.
- Movimiento: transiciones de 150-220 ms solo en color/opacidad/transform; nada animado al cargar salvo un fundido corto; todo desactivado con `prefers-reduced-motion: reduce`.
- Sin emojis en ningún lugar. Tampoco caracteres decorativos tipo estrella, flecha emoji o símbolos con presentación emoji (por ejemplo U+2728, U+2B50, U+2705). Flechas y viñetas tipográficas normales (U+2192, U+2022) están permitidas.

## 4. Landing (`ceiba/index.html`)

Secciones, en este orden:
1. Cabecera: marca "Ceiba" con la rama como sello; enlaces ancla: Principios, Planes, Preguntas; botón secundario "Abrir la app" (`app.html`); botón de tema claro/oscuro.
2. Héroe: titular editorial grande en serif (idea: "Escribe. Lo demás puede esperar."), subtítulo de dos líneas, CTA primario "Probar 14 días" (-> `#planes`) y enlace secundario "Ver cómo se escribe" (-> `app.html`). A la derecha (o debajo en móvil) una maqueta de papel hecha en HTML/CSS que muestra un fragmento de markdown a la izquierda y su render a la derecha, con contenido real de ejemplo (no un marco de teléfono).
3. Principios: tres bloques en una disposición asimétrica y editorial (no tres tarjetas iguales): "Un solo panel", "Tus notas se quedan contigo", "Teclado primero". Cada uno con un párrafo corto honesto (la app guarda en el navegador).
4. Planes: selector segmentado Mensual | Anual (radiogrupo accesible, flechas del teclado cambian de opción, por defecto Anual) y tres tarjetas. La tarjeta central lleva la etiqueta de texto "La más elegida".
5. Comparativa: tabla accesible con las funciones por plan (`<table>`, `<caption>`, `scope`).
6. Preguntas frecuentes: `<details>/<summary>`, 6 preguntas (cobro, cancelar, dónde se guardan las notas, exportar, cambiar de plan, qué es markdown).
7. Cierre: llamada a la acción final y pie con aviso de demostración.

### Planes (fuente única de verdad en un objeto JS; todos los importes derivados se calculan, no se escriben a mano)

| Plan | Mensual (US$/mes) | Anual (US$/año) | Para quién |
|---|---|---|---|
| Semilla | 5 | 50 | Quien empieza un cuaderno propio |
| Brote | 9 | 90 | Quien escribe a diario y quiere respaldo |
| Bosque | 18 | 180 | Equipos pequeños |

El plan anual equivale a dos meses sin costo (10 meses pagados). En ciclo anual cada tarjeta muestra: equivalente mensual (`anual / 12`, con coma decimal española y como máximo 2 decimales: 4,17 / 7,50 / 15,00), el total anual cobrado, y el ahorro frente a pagar 12 meses (US$ 10 / 18 / 36). En ciclo mensual muestra el precio mensual y la nota "Cancela cuando quieras". Redondeo: se redondea solo la presentación; el cálculo usa números exactos; el total anual mostrado es siempre el exacto.

Funciones (el texto debe separar lo que existe de lo que está en preparación):

- Semilla: notas en este navegador; markdown con vista previa; búsqueda instantánea; exportar nota a .md.
- Brote: todo lo de Semilla; copia de seguridad completa en JSON (exportar e importar); temas de papel claro y oscuro; atajos de teclado completos.
- Bosque: todo lo de Brote; espacios compartidos para equipos (en preparación); sincronización entre dispositivos (en preparación); soporte por correo en 24 h (en preparación).

CTA de cada tarjeta: texto "Elegir Semilla", "Elegir Brote", "Elegir Bosque". Enlace a `app.html?plan=<semilla|brote|bosque>&ciclo=<mensual|anual>`. La app lo guarda (`localStorage`) y lo muestra como "Plan: Brote, anual (demostración, sin cobro)".

Aviso obligatorio visible en el pie y junto al selector: "Demostración: los planes y precios son ficticios y no se realiza ningún cobro."

Sin JS: un bloque `<noscript>` con una tabla simple de precios mensual y anual. Con JS: tarjetas generadas desde el objeto de planes.

## 5. Aplicación (`ceiba/app.html`)

### Estructura
- Disposición escritorio (>= 900 px): barra lateral izquierda de ancho fijo (`clamp(280px, 26vw, 340px)`, no redimensionable), panel principal a la derecha. Entre 600 y 899 px: barra lateral colapsable (botón). Menos de 600 px: vista única; la lista ocupa toda la pantalla y al abrir una nota se pasa al editor con botón "Volver a la lista" (y tecla Esc desde el editor no hace nada destructivo).
- Barra lateral: marca "Ceiba" + botón "Nueva nota"; campo de búsqueda; contador de resultados; lista de notas; pie con botones Tema, Copia de seguridad (menú: exportar todo, importar), Atajos (?), indicador de plan.
- Panel principal: barra superior mínima con: botón de modo (Escribir / Vista previa) como alternador (`aria-pressed` o `role="switch"`, con texto visible), botón Eliminar, botón Exportar nota (.md); lienzo de escritura; barra de estado inferior con "Guardado", palabras, caracteres y "Última edición: ...".
- Modo enfoque: oculta barra lateral y barra superior hasta mover el ratón al borde o pulsar la tecla; la barra de estado se atenúa.

### Notas
Modelo: `{ id: string, texto: string, creada: number (ms), editada: number (ms) }`. El título se deriva de la primera línea no vacía (sin `#` ni espacios iniciales, máx. 80 caracteres); vacío -> "Sin título". Orden de la lista: `editada` descendente (la nota que se está editando sube al editar; para que la lista no salte mientras se escribe, el reordenado se aplica con debounce o al cambiar de nota, pero la nota activa siempre se mantiene visible y seleccionada).

Cada elemento de la lista muestra título, extracto de una línea (el primer texto tras el título) y marca de tiempo relativa corta ("hace 3 min", "ayer", "12 oct"), con el valor absoluto en `title` y en un `<time datetime>`.

Primera ejecución: se crea una nota "Bienvenida a Ceiba" con una guía breve de markdown y atajos, escrita con contenido real (no datos falsos). Si el usuario elimina todas las notas, se muestra un estado vacío con la rama ilustrada y el botón "Escribir la primera nota"; no se recrea la bienvenida.

### Funciones
- Crear (`Alt+N`, botón): nueva nota vacía, activa y con el cursor en el editor.
- Eliminar (`Alt+Retroceso`, botón): elimina de inmediato y muestra aviso con "Deshacer" durante 8 s (accesible, `role="status"`; el botón de deshacer es alcanzable por teclado y además `Alt+Z` lo activa mientras el aviso está visible). Tras eliminar se selecciona la nota vecina. El deshacer restaura la nota en su posición con sus fechas originales. Si el usuario recarga antes de que acabe, la eliminación queda confirmada (la persistencia se escribe sin esperar).
- Búsqueda instantánea (`Ctrl/Cmd+K` o `/` desde fuera de campos de texto; `Esc` borra y devuelve el foco a la lista): filtra en cada pulsación por título y cuerpo, sin distinguir mayúsculas ni tildes (normalización NFD), todas las palabras deben aparecer (AND). Resalta coincidencias con `<mark>` en título y extracto (construyendo nodos, nunca `innerHTML` con entrada del usuario). Muestra "n resultados" (aviso en región `aria-live="polite"`). Sin resultados: mensaje con sugerencia y botón "Borrar búsqueda". Mientras hay filtro activo, "Nueva nota" limpia el filtro.
- Alternador de vista previa (`Alt+P`, botón): alterna entre el área de texto y el markdown renderizado en el mismo panel. Al volver a escribir se conserva posición del cursor y desplazamiento. Solo dos estados (Escribir / Vista previa); no hay vista dividida en la versión 1.
- Navegación con teclado:
  - Lista: patrón de lista seleccionable con una sola parada de tabulación (`role="listbox"`, `aria-activedescendant` o roving tabindex): Flecha arriba/abajo mueve la selección y abre la nota, `Inicio`/`Fin`, `Enter` o `Flecha derecha` pasa el foco al editor.
  - `Ctrl/Cmd+K` o `/`: buscar. `Esc` en el editor: vuelve el foco a la lista (nunca se pierde texto). `Alt+\`: modo enfoque / ocultar barra lateral. `?`: ayuda de atajos (diálogo modal accesible con captura de foco y `Esc`).
  - `Tab` en el editor mueve el foco (no se inserta tabulación: no hay trampa de teclado).
  - Enlace "Saltar al contenido" al inicio.
  - Se usan `event.code` y no `event.key` para atajos con Alt, y los atajos no se disparan con `Ctrl/Cmd` ya reservados del navegador (N, W, T, P, R).
  - Continuación de listas con `Enter` en el editor (`- `, `* `, `1. `, `- [ ] `): una línea vacía de lista termina la lista. Debe conservar el historial de deshacer del navegador (insertar con `document.execCommand('insertText')`; si no está disponible, `setRangeText`).
- Marcas de tiempo: la fecha de edición cambia solo cuando el texto cambia de verdad (no al abrir, ni al cambiar de modo, ni al enfocar). Barra de estado: "Última edición: 16 oct 2026, 10:32" (`Intl.DateTimeFormat('es', ...)`). Lista: relativa; se refresca cada 60 s y al volver a la pestaña.
- Persistencia: clave `ceiba:notas:v1` (JSON `{ version: 1, notas: [...], activa: id }`) y `ceiba:prefs:v1` (`tema`, `plan`, `ciclo`, `foco`). Guardado con debounce de 300 ms durante la escritura, inmediato al crear/eliminar/cambiar de nota, y en `visibilitychange` (oculta) y `pagehide`. Toda lectura/escritura dentro de `try/catch`; JSON inválido o con esquema roto -> no se pisa: se copia el valor roto a `ceiba:notas:v1:corrupto:<ts>`, se informa en un aviso y se arranca con datos limpios. `localStorage` no disponible o cuota llena -> aviso persistente claro ("Los cambios no se están guardando") y la app sigue funcionando en memoria; la barra de estado dice "Sin guardar". Evento `storage`: si otra pestaña modificó las notas, se muestra un aviso con "Recargar" (sin sobrescribir lo que se está escribiendo).
- Copia de seguridad: "Exportar todo" descarga `ceiba-notas-AAAA-MM-DD.json`; "Importar" lee un `.json` con validación estricta de esquema, límite de tamaño (5 MB), máximo 5.000 notas, ids saneados; las notas importadas se combinan por `id` (gana la de `editada` más reciente) y se informa cuántas se añadieron/actualizaron/omitieron; error comprensible si el archivo no es válido. "Exportar nota" descarga `<titulo-saneado>.md` en UTF-8.
- Plan de demostración: si la URL trae `?plan=&ciclo=` válidos, se guardan en prefs, se limpia la URL con `history.replaceState` y se muestra el indicador en el pie de la barra lateral ("Plan Brote, anual · demostración"). Valores no válidos se ignoran. No restringe ninguna función.
- Tema: claro/oscuro/sistema (botón que rota), persistido.

### Renderizado de markdown (propio, sin dependencias, seguro por construcción)

Subconjunto soportado: títulos `#`-`######`; párrafos y saltos de línea; **negrita**, *cursiva*, ~~tachado~~; `código en línea`; bloques de código con cercas (```` ``` ````) con lenguaje opcional (sin resaltado); citas `>` (anidables una vez); listas con viñetas y numeradas, con anidación por sangría de 2-4 espacios; listas de tareas `- [ ]`/`- [x]` (casillas deshabilitadas, solo lectura); enlaces `[texto](url)` y autoenlaces `<https://...>`; regla horizontal; tablas GFM con alineación; escapes con barra invertida.

Seguridad (no negociable):
- Todo el texto se escapa; no se interpreta HTML crudo del usuario (se muestra como texto).
- Esquemas de URL permitidos en enlaces: `http:`, `https:`, `mailto:` y anclas `#...`. Cualquier otro (`javascript:`, `data:`, `vbscript:`, con mayúsculas, espacios, entidades o caracteres de control escondidos) se renderiza como texto sin enlace.
- Enlaces externos con `target="_blank"` y `rel="noopener noreferrer"`.
- Las imágenes `![alt](url)` no se cargan (privacidad y CSP): se muestran como enlace al recurso con el texto alternativo.
- El render construye el DOM con `createElement`/`textContent` o escapa de forma centralizada antes de `innerHTML`; hay una sola función de escape probada. Cubierto con casos adversarios (`<script>`, `<img onerror>`, `[x](JaVaScRiPt:alert(1))`, `[x](&#106;avascript:...)`, comillas en atributos, bloques sin cerrar, anidación patológica, texto de 1 MB con ReDoS potencial en 2 s o menos).
- Límite de rendimiento: renderizar una nota de 200 KB en menos de 300 ms; el render de vista previa se hace solo al estar visible y con `requestAnimationFrame`/debounce.

### Estados
Cargando (instantáneo; sin spinner), vacío (sin notas), sin resultados, error de almacenamiento, error de importación, éxito de guardado/exportación/importación, eliminación con deshacer.

### Accesibilidad
Reglas del constructor (teclado completo, etiquetas, foco visible, contraste, reduced-motion, 44 px táctiles) más: puntos de referencia (`header`, `nav`, `main`, `aside` donde corresponda), una sola región `aria-live="polite"` para estado, `lang="es"`, títulos de página, el diálogo de ayuda y el de importación con gestión de foco, el área de texto con `aria-label="Texto de la nota"`, y la vista previa como `article` con `tabindex="0"` y nombre accesible.

### Responsive
360, 768, 1024, 1440 px sin scroll horizontal. En móvil, el teclado virtual no debe tapar el cursor (usar `visualViewport` o `dvh`).

## 6. Pruebas (todas se ejecutan, no solo se escriben)

Archivos en `ceiba/tests/`:
- `unit.mjs`: pruebas con Playwright (`page.evaluate`) sobre `window.Ceiba`, un espacio de nombres que existe siempre y contiene solo funciones puras (render de markdown, derivar título, tiempo relativo, validación de importación, normalización de búsqueda, escape). No expone el estado ni la persistencia.
- `e2e.mjs`: flujos con Playwright en 360, 768 y 1440 px: crear, escribir, buscar, resaltar, eliminar y deshacer, recargar y comprobar persistencia, alternar vista previa, teclado completo sin ratón, tiempos (reloj falso con `page.clock`), almacenamiento no disponible (bloqueado), JSON corrupto, importación válida/ inválida, evento `storage`, parámetros de plan, tema.
- `landing.mjs`: selector con ratón y teclado, valores de precios y ahorros para los 6 paneles, enlaces CTA, ausencia de scroll horizontal, `noscript`.
- `calidad.mjs`: sin emojis ni caracteres decorativos en `index.html`, `app.html` y `README.md` (regex Unicode `\p{Extended_Pictographic}` y selectores de variación U+FE0F), contraste de los pares de tokens en ambos temas, consola sin errores ni avisos, ningún recurso de red externo, todas las anclas e hipervínculos internos resuelven, comprobación básica de accesibilidad (nombres accesibles de controles, `alt`, jerarquía de títulos, ids únicos).
- Capturas en 360, 768 y 1440 px, claro y oscuro, revisadas por un revisor visual.

## 7. Criterios de éxito
1. Todas las pruebas de la sección 6 pasan, con la salida real adjunta.
2. Cero hallazgos críticos o altos en revisiones de seguridad, accesibilidad y honestidad.
3. Un lector que abre `index.html` entiende el producto y los precios en cinco segundos.
4. Una persona con solo teclado puede completar el ciclo crear, escribir, buscar, previsualizar y eliminar.
5. Nada de lo publicado en la landing se presenta como disponible si la app no lo hace (lo que no existe aparece como "en preparación").

## 8. Entrega
Carpeta `ceiba/`: `index.html`, `app.html`, `README.md`, `tests/`. README con: qué es, cómo abrirlo (`npx http-server ceiba` o abrir el archivo), atajos, límites, tabla de pruebas ejecutadas y pendientes, pasos de Netlify (arrastrar la carpeta `ceiba/` sin `tests/`, o conectar con Git con directorio publicable `ceiba`), y riesgos.

## 9. Límites que el producto debe declarar con honestidad
- Sin cuentas ni sincronización: los datos viven en el `localStorage` del navegador y dispositivo. Borrar datos del sitio o usar otra ventana privada pierde las notas: por eso existe la copia de seguridad.
- No se procesa ningún pago. Los botones "Elegir ..." solo seleccionan un plan de demostración. Para cobrar de verdad haría falta una pasarela de pago y verificación en servidor (nivel PRO), fuera de esta entrega.
- El render de markdown es un subconjunto, no CommonMark completo.
- Funciones del plan Bosque marcadas "en preparación" no existen.
- No se ha publicado nada en Netlify; la publicación está pendiente de verificar.
