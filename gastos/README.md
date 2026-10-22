# Cuentas Claras

Panel de gastos compartidos y pagos mensuales. Sitio estático (HTML + JS, sin build) con Supabase como backend (Auth + Postgres + RLS). Nivel constructor: **PRO**.

## Qué hace

- **Panel general (público):** lo que **falta por pagar** del mes (gastos menos aportes de todos), la cuota de cada usuario, el mínimo por día y el avance por persona (ha pagado / debe / %). Cada pago registrado reduce lo que falta. Selector de mes.
- **Reparto automático:** cuota = gastos del mes ÷ usuarios aprobados (redondeada hacia arriba); mínimo diario = cuota ÷ 25 días. El admin ya no fija cuotas.
- **Perfil privado:**
  - **Pagos:** monto, método y fecha (hoy por defecto, editable), acumulado del mes, método principal e historial.
  - **Ingreso necesario:** cuánto generar al día (gastos compartidos + lo que elijas pagar cada día a cada deuda), si hoy cumpliste el mínimo y si vas al día (día N de 25).
  - **Ahorros** y **Deudas** (privados; ni el admin los ve). Las deudas se ven plegadas: toca el nombre para el detalle.
- **Sesión:** queda guardada en el dispositivo; no se vuelve a pedir la contraseña. Tras registrarse se conserva la sesión, así que al ser aprobado se entra directo.
- **Tema:** interruptor claro/oscuro en la cabecera (recuerda tu elección; por defecto sigue al sistema).
- **Admin (usuario `miguel`):** aprueba/rechaza solicitudes (ve solo el nombre), gestiona los gastos del mes (agregar, editar, marcar pagado, eliminar, copiar del mes anterior).

Reglas: un pago cuenta para el mes de su fecha; el saldo de una deuda es el último valor registrado menos los pagos hechos desde ese registro. Moneda: COP, solo enteros.

## Puesta en marcha

1. **Supabase > Authentication > Providers > Email:** desactiva **Confirm email** (recomendado; aunque quede activo, `schema.sql` confirma los correos solos con un trigger). Los usuarios usan un correo interno ficticio `usuario@mailinator.com`, no reciben correos). Opcional: sube el largo mínimo de contraseña a 8.
2. **Supabase > SQL Editor:** pega todo `supabase/schema.sql` y ejecuta (se puede repetir sin romper nada).
3. Abre la app, entra a **Crear perfil** y regístrate como usuario `miguel`. Después, en el SQL Editor:
   ```sql
   update public.profiles set is_admin = true, status = 'approved' where username = 'miguel';
   ```
   Hazlo **antes** de compartir el enlace: el primero que registre `miguel` será el único candidato a admin, y el admin solo se concede con este SQL, nunca desde el navegador.
4. Como Miguel: en **Admin** registra los gastos del mes; la cuota de cada usuario se calcula sola.
5. **Publicar en Netlify:** arrastra la carpeta `gastos/` (solo `index.html` es necesario; carga supabase-js desde jsdelivr).

`index.html` ya trae la URL del proyecto y la clave **anon** (pública por diseño). Nunca pongas la clave `service_role` en el frontend.

## Seguridad (lo que impone la base de datos, no el navegador)

| Dato | Anónimo | Usuario | Admin |
|---|---|---|---|
| Gastos generales | leer | leer | leer/escribir |
| Panel por persona (`panel_usuarios`) | nombre, cuota, total pagado | igual | igual |
| Pagos individuales (método, fecha) | no | solo los suyos | solo los suyos |
| Ahorros y deudas | no | solo los suyos | **no** |
| Perfiles | no | el suyo | todos (para aprobar) |

El rol `is_admin` y el estado `status` no se pueden modificar desde el cliente; aprobar y fijar cuotas pasa por funciones `security definer` que verifican al admin.

## Pruebas

- `node gastos/tests/e2e.mjs`: 24 pruebas en Chromium con un Supabase **simulado** (`tests/mock-supabase.js`). Requiere `playwright` global.
- `tests/rls-stub.sql` + `tests/rls-test.sql`: pruebas de permisos contra un Postgres local con un esquema `auth` simulado (ver orden: stub, `supabase/schema.sql`, test).

**Pendiente de verificar contra el proyecto real** (el entorno de desarrollo no tenía acceso a Supabase): registro/inicio de sesión con Supabase Auth real, que el dominio del correo interno sea aceptado, y la ejecución del SQL en el editor de Supabase.

## Límites conocidos

- La cuota de un mes pasado se recalcula con los usuarios aprobados de hoy (no hay historial de cuotas).
- Si Supabase rechaza el correo interno ("email address is invalid"), cambia `DOMINIO_CORREO` en `index.html` por un dominio con MX real.
- No hay recuperación de contraseña (no hay correo real). El admin puede restablecerla desde Supabase > Authentication > Users.
- Los montos son enteros en pesos; no se admiten centavos.

## Actualizar desde la versión anterior

Vuelve a ejecutar `supabase/schema.sql` completo: agrega la columna `daily_plan`, reemplaza `panel_usuarios` (cuota calculada) y elimina `admin_set_quota`.
