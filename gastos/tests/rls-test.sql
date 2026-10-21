\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','miguel@x','{"username":"Miguel","display_name":"Miguel"}'),
 ('00000000-0000-0000-0000-00000000000b','ana@x','{"username":"ana","display_name":"Ana"}'),
 ('00000000-0000-0000-0000-00000000000c','luis@x','{"username":"luis","display_name":"Luis"}');
insert into auth.users(email,raw_user_meta_data) values ('bad@x','{"username":"a b","display_name":"X"}');   -- ERROR esperado
insert into auth.users(email,raw_user_meta_data) values ('dup@x','{"username":"ANA","display_name":"Dup"}'); -- ERROR esperado (unico)
update profiles set is_admin=true,status='approved' where username='miguel';
update profiles set status='approved' where username='ana';
select 'perfiles:'||count(*) from profiles;

set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c'; -- luis (pending)
select 'luis inserta pago (debe fallar):';
insert into payments(user_id,amount,method) values ('00000000-0000-0000-0000-00000000000c',5,'efectivo');
select 'luis intenta autoadmin (debe fallar):';
update profiles set is_admin=true where username='luis';
select 'luis llama admin_set_status (debe fallar):';
select admin_set_status('00000000-0000-0000-0000-00000000000c','approved');

set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b'; -- ana
insert into payments(user_id,amount,method,paid_on) values ('00000000-0000-0000-0000-00000000000b',40000,'efectivo',date_trunc('month',current_date));
insert into payments(user_id,amount,method) values ('00000000-0000-0000-0000-00000000000b',10000,'transferencia');
select 'ana suplanta a luis (debe fallar):';
insert into payments(user_id,amount,method) values ('00000000-0000-0000-0000-00000000000c',1,'efectivo');
insert into savings_accounts(id,user_id,name) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000b','Viaje');
insert into savings_entries(account_id,user_id,amount,method) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000b',20000,'efectivo');
insert into debts(id,user_id,name) values ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000b','Tarjeta');
insert into debt_balances(debt_id,user_id,amount) values ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000b',500000);
insert into debt_payments(debt_id,user_id,amount) values ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000b',100000);
select 'ana ve sus pagos: '||count(*) from payments;

set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; -- miguel admin
select 'admin ve pagos ajenos (esperado 0): '||count(*) from payments;
select 'admin ve ahorros ajenos (esperado 0): '||count(*) from savings_accounts;
select 'admin ve deudas ajenas (esperado 0): '||count(*) from debts;
select 'admin ve perfiles (esperado 3): '||count(*) from profiles;
insert into general_expenses(month,name,amount) values (date_trunc('month',current_date),'Gas',60000),(date_trunc('month',current_date),'Agua',40000);
update general_expenses set paid=true where name='Gas';
select 'gas paid_at set: '||(paid_at is not null) from general_expenses where name='Gas';
select admin_set_status('00000000-0000-0000-0000-00000000000c','approved');
select 'copiados: '||admin_copy_expenses(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month')::date);
select 'tras copiar, gas siguiente mes paid=false: '||(not paid) from general_expenses where name='Gas' and month>date_trunc('month',current_date);

set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'ana ve ahorros de otros (esperado solo 1): '||count(*) from savings_accounts;
select 'ana borra gasto (0 filas):'; delete from general_expenses;
select 'gastos aun: '||count(*) from general_expenses;
select 'ana cambia fecha objetivo deuda:'; update debts set target_date=current_date+90;
select 'ana intenta cambiar nombre deuda (debe fallar):'; update debts set name='x';

reset role; set role anon; reset request.jwt.claim.sub;
select 'anon gastos: '||count(*) from general_expenses;
select 'anon panel: '||username||' '||quota||' '||paid from panel_usuarios();
select 'anon perfiles (debe fallar):'; select count(*) from profiles;
select 'anon pagos (debe fallar):'; select count(*) from payments;
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'ana: gastos 120000 / 3 aprobados (miguel, ana, luis) => cuota esperada 40000: '||quota from panel_usuarios() where username='ana';
select 'ana fija daily_plan en su deuda: '; update debts set daily_plan=15000;
select 'ana intenta subir el plan de otro (0 filas): '; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c'; update debts set daily_plan=1;
