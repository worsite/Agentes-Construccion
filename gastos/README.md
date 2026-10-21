# Cuentas Claras

Panel de gastos compartidos y pagos mensuales. Sitio estático (HTML + JS, sin build) con Supabase como backend (Auth + Postgres + RLS). Nivel constructor: **PRO**.

## Qué hace

- **Panel general (público, sin iniciar sesión):** meta de aportes del mes, gastos generales (gas, agua...) con estado Pagado/Pendiente y avance por persona (nombre, monto pagado, cuota y porcentaje). Selector de mes.
- **Perfil privado (usuario aprobado):**
  - **Pagos:** monto, método (efectivo/transferencia) y fecha (por defecto hoy, editable). Muestra acumulado del mes, método principal e historial. Los pagos suben al panel general (solo monto total; el método no se expone).
  - **Ahorros:** cuentas con nombre y meta opcional, con aportes. Solo las ve su dueño.
  - **Deudas:** nombre, valor y fecha del valor; nuevos valores por intereses, pagos a la deuda, barra de avance y proyección (por mes y por semana) para todas las deudas o una en concreto. Solo las ve su dueño.
- **Registro:** nombre, usuario y contraseña; la solicitud queda *pendiente* hasta que el admin la aprueba.
- **Admin (usuario `miguel`):** aprueba/rechaza solicitudes (ve solo el nombre), marca gastos como pagados, edita montos, agrega/elimina gastos, copia los gastos del mes anterior y define la cuota mensual de cada usuario. También usa su perfil privado como cualquiera.

Reglas de negocio: la cuota mensual la fija el admin por usuario; un pago cuenta para el mes de su fecha; el saldo de una deuda es el último valor registrado menos los pagos hechos desde ese registro (los anteriores ya están reflejados en el valor nuevo). Moneda: COP, solo enteros.

## Puesta en marcha

1. **Supabase > Authentication > Providers > Email:** desactiva **Confirm email** (los usuarios usan un correo interno ficticio `usuario@mailinator.com`, no reciben correos). Opcional: sube el largo mínimo de contraseña a 8.
2. **Supabase > SQL Editor:** pega todo `supabase/schema.sql` y ejecuta (se puede repetir sin romper nada).
3. Abre la app, entra a **Crear perfil** y regístrate como usuario `miguel`. Después, en el SQL Editor:
   ```sql
   update public.profiles set is_admin = true, status = 'approved' where username = 'miguel';
   ```
   Hazlo **antes** de compartir el enlace: el primero que registre `miguel` será el único candidato a admin, y el admin solo se concede con este SQL, nunca desde el navegador.
4. Como Miguel: en **Admin** define la cuota de cada usuario y los gastos del mes.
5. **Publicar en Netlify:** arrastra la carpeta `gastos/` (debe incluir `index.html` y `vendor/`; `supabase/` y `tests/` no son necesarios para el sitio).

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

- `node gastos/tests/e2e.mjs`: 20 pruebas en Chromium con un Supabase **simulado** (`tests/mock-supabase.js`). Requiere `playwright` global.
- `tests/rls-stub.sql` + `tests/rls-test.sql`: pruebas de permisos contra un Postgres local con un esquema `auth` simulado (ver orden: stub, `supabase/schema.sql`, test).

**Pendiente de verificar contra el proyecto real** (el entorno de desarrollo no tenía acceso a Supabase): registro/inicio de sesión con Supabase Auth real, que el dominio del correo interno sea aceptado, y la ejecución del SQL en el editor de Supabase.

## Límites conocidos

- La cuota nueva aplica a todos los meses (no hay historial de cuotas).
- Si Supabase rechaza el correo interno ("email address is invalid"), cambia `DOMINIO_CORREO` en `index.html` por un dominio con MX real.
- No hay recuperación de contraseña (no hay correo real). El admin puede restablecerla desde Supabase > Authentication > Users.
- Los montos son enteros en pesos; no se admiten centavos.
