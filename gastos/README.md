# Cuentas Claras

Panel de gastos compartidos y pagos mensuales. Sitio estático (HTML + JS, sin build) con Supabase como backend (Auth + Postgres + RLS). Nivel constructor: **PRO**.

## Qué hace

- **Panel general (público):** lo que **falta por pagar** del mes (gastos menos aportes de todos), la cuota de cada usuario, el mínimo por día y el avance por persona (ha pagado / debe / %). Cada pago registrado reduce lo que falta. Selector de mes.
- **Reparto automático:** cuota = gastos del mes ÷ usuarios aprobados (redondeada hacia arriba); mínimo diario = cuota ÷ 25 días. El admin ya no fija cuotas.
- **Pensado para el celular:** barra inferior fija con 5 accesos (Panel, Cuenta, **Pagar**, Ahorros, Deudas); en pantallas grandes pasa al menú superior.
  - **Pagar:** una sola pantalla con monto grande (teclado numérico y puntos de miles automáticos), atajos (mínimo de hoy, lo que debo a la fecha, 10.000/20.000/50.000), método y fecha de hoy por defecto (botón para cambiarla). Al confirmar muestra cuánto falta del mes.
  - **Cuenta:** *Debes a la fecha* (o "Estás al día"), cuota del mes, lo que has pagado y lo que falta; cumplimiento de hoy; **ingreso necesario** por día (gastos compartidos + el pago diario que elijas para cada deuda) e historial de pagos.
  - **Ahorros** y **Deudas** (privados; ni el admin los ve). Las deudas se ven plegadas: toca el nombre para el detalle.
- **Panel general:** cada persona aparece con su avance y una etiqueta "Al día" o "Debe $X a la fecha".
- **WhatsApp:** se pide al registrarse (con o sin +57; se guarda con el indicativo). Quien ya tenía cuenta sin número ve una pantalla obligatoria al entrar y no puede seguir hasta registrarlo. Se puede cambiar en Cuenta. Solo lo ven Miguel y el supervisor.
- **Supervisor:** Miguel lo asigna en Admin entre los usuarios aprobados. Ve todos los pagos, quién debe a la fecha y los WhatsApp, pero **no paga ni cuenta en el reparto** (la cuota de los demás se calcula sin él) y sus ahorros/deudas personales no se usan. En su pantalla *Supervisión*, cada persona atrasada tiene un botón que abre WhatsApp con un mensaje ya escrito (pregunta por el pago no reportado, cuánto debería llevar, cuánto aparece y el atraso). **No se envía solo:** la persona que supervisa revisa el mensaje y toca enviar. Los ahorros y deudas de cada usuario siguen siendo privados, incluso para el supervisor.
- **Sesión:** queda guardada en el dispositivo; no se vuelve a pedir la contraseña. Tras registrarse se conserva la sesión, así que al ser aprobado se entra directo.
- **Tema:** interruptor claro/oscuro en la cabecera (recuerda tu elección; por defecto sigue al sistema).
- **Admin (usuario `miguel`):** resumen del mes (total, cuota por usuario, mínimo diario) y un formulario único para **agregar un gasto del mes** o una **deuda general**. La deuda general (p. ej. una reparación) **no suma al total del mes ni a la cuota**: en el panel aparece aparte, junto a *Usuarios*, como **Deuda general -$ X en rojo**, y queda en $ 0 cuando se salda. El admin la abona (o la marca como pagada) desde Admin. También: aprobar/rechazar solicitudes (ve solo el nombre), asignar al supervisor, marcar gastos como pagados, editar montos y copiar los gastos del mes anterior.

"A la fecha": deberías llevar pagado (mínimo diario × día del mes, hasta 25) y se compara con lo que llevas pagado.

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

- `node gastos/tests/e2e.mjs`: 50 pruebas en Chromium con un Supabase **simulado** (`tests/mock-supabase.js`). Requiere `playwright` global.
- `tests/rls-stub.sql` + `tests/rls-test.sql`: pruebas de permisos contra un Postgres local con un esquema `auth` simulado (ver orden: stub, `supabase/schema.sql`, test).

**Pendiente de verificar contra el proyecto real** (el entorno de desarrollo no tenía acceso a Supabase): registro/inicio de sesión con Supabase Auth real, que el dominio del correo interno sea aceptado, y la ejecución del SQL en el editor de Supabase.

## Límites conocidos

- La cuota de un mes pasado se recalcula con los usuarios aprobados de hoy (no hay historial de cuotas).
- Si Supabase rechaza el correo interno ("email address is invalid"), cambia `DOMINIO_CORREO` en `index.html` por un dominio con MX real.
- No hay recuperación de contraseña (no hay correo real). El admin puede restablecerla desde Supabase > Authentication > Users.
- Los montos son enteros en pesos; no se admiten centavos.

## Actualizar desde la versión anterior

Vuelve a ejecutar `supabase/schema.sql` completo: agrega la columna `daily_plan`, reemplaza `panel_usuarios` (cuota calculada) y elimina `admin_set_quota`.

La actualización con supervisor y WhatsApp también se aplica volviendo a ejecutar `supabase/schema.sql` (agrega las columnas `whatsapp` e `is_supervisor`, las funciones `set_my_whatsapp` y `admin_set_supervisor`, y ajusta el reparto y los permisos).

Las deudas generales de la versión anterior (con cuotas mensuales) se migran solas al volver a ejecutar `schema.sql`: lo ya pagado pasa a "abonado" y las cuotas dejan de contar en los gastos del mes.
