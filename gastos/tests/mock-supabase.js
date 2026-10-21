// Supabase simulado en memoria SOLO para pruebas. Imita lo justo de supabase-js y de las politicas RLS.
(function () {
  const uuid = () => 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const hoy = new Date(); const pad = n => String(n).padStart(2, '0');
  const mes = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-01`;
  const db0 = {
    users: [{ id: 'u-miguel', username: 'miguel', password: 'clave1234' }, { id: 'u-ana', username: 'ana', password: 'clave1234' }],
    profiles: [
      { id: 'u-miguel', username: 'miguel', display_name: 'Miguel', status: 'approved', is_admin: true, monthly_quota: 100000, created_at: '2026-01-01T00:00:00Z' },
      { id: 'u-ana', username: 'ana', display_name: 'Ana', status: 'approved', is_admin: false, monthly_quota: 100000, created_at: '2026-01-02T00:00:00Z' },
    ],
    general_expenses: [
      { id: 'g1', month: mes, name: 'Gas', amount: 60000, paid: true, created_at: '2026-01-01T00:00:01Z' },
      { id: 'g2', month: mes, name: 'Agua', amount: 40000, paid: false, created_at: '2026-01-01T00:00:02Z' },
    ],
    payments: [], savings_accounts: [], savings_entries: [], debts: [], debt_balances: [], debt_payments: [],
  };
  let db = db0;
  try { const g = localStorage.getItem('mock-db'); if (g) db = JSON.parse(g); } catch (e) {}
  const guardar = () => { try { localStorage.setItem('mock-db', JSON.stringify(db)); } catch (e) {} };
  Object.defineProperty(window, '__db', { get: () => db });
  window.__calls = [];
  let session = null; try { session = JSON.parse(localStorage.getItem('mock-session') || 'null'); } catch (e) {}
  const setSes = x => { session = x; try { localStorage.setItem('mock-session', JSON.stringify(x)); } catch (e) {} };
  const listeners = [];
  const priv = ['payments', 'savings_accounts', 'savings_entries', 'debts', 'debt_balances', 'debt_payments'];
  const me = () => session && session.user.id;
  const meProfile = () => db.profiles.find(p => p.id === me());
  const visible = t => {
    if (priv.includes(t)) return db[t].filter(r => r.user_id === me());
    if (t === 'profiles') return !me() ? [] : (meProfile() && meProfile().is_admin ? db.profiles : db.profiles.filter(p => p.id === me()));
    return db[t];
  };
  function builder(t) {
    const st = { op: 'select', filters: [], orders: [], rows: null, patch: null, ret: false };
    const b = {
      select() { st.ret = true; return b; },
      insert(rows) { st.op = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b; },
      update(p) { st.op = 'update'; st.patch = p; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      order(c, o) { st.orders.push([c, !(o && o.ascending === false)]); return b; },
      then(ok, bad) { return run().then(ok, bad); },
    };
    async function run() {
      window.__calls.push({ t, op: st.op }); setTimeout(guardar, 0);
      const err = m => ({ data: null, error: { message: m } });
      const match = r => st.filters.every(([c, v]) => r[c] === v);
      if (st.op === 'select') {
        let rows = visible(t).filter(match).map(r => ({ ...r }));
        for (const [c, asc] of st.orders.slice().reverse()) rows.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
        return { data: rows, error: null };
      }
      if (!me()) return err('new row violates row-level security policy');
      if (st.op === 'insert') {
        const out = [];
        for (const r of st.rows) {
          if (priv.includes(t) && (r.user_id !== me() || !meProfile() || meProfile().status !== 'approved')) return err('new row violates row-level security policy for table "' + t + '"');
          if (t === 'general_expenses' && !(meProfile() && meProfile().is_admin)) return err('new row violates row-level security policy');
          const row = { id: uuid(), created_at: new Date().toISOString(), ...r }; db[t].push(row); out.push({ ...row });
        }
        return { data: st.ret ? out : null, error: null };
      }
      const objetivo = db[t].filter(r => visible(t).includes(r) && match(r));
      if (st.op === 'update') {
        if (t === 'general_expenses' && !(meProfile() && meProfile().is_admin)) return { data: [], error: null };
        objetivo.forEach(r => Object.assign(r, st.patch)); return { data: null, error: null };
      }
      if (st.op === 'delete') {
        if (t === 'general_expenses' && !(meProfile() && meProfile().is_admin)) return { data: null, error: null };
        db[t] = db[t].filter(r => !objetivo.includes(r)); return { data: null, error: null };
      }
    }
    return b;
  }
  const isAdmin = () => meProfile() && meProfile().is_admin && meProfile().status === 'approved';
  const api = {
    from: builder,
    async rpc(name, a) {
      window.__calls.push({ rpc: name }); setTimeout(guardar, 0);
      if (name === 'panel_usuarios') {
        const m = a.p_month.slice(0, 7);
        const tot = db.general_expenses.filter(g => g.month.slice(0, 7) === m).reduce((x, g) => x + g.amount, 0);
        const ap = db.profiles.filter(p => p.status === 'approved');
        return { data: ap.map(p => ({ username: p.username, display_name: p.display_name, quota: Math.ceil(tot / ap.length),
          paid: db.payments.filter(x => x.user_id === p.id && x.paid_on.slice(0, 7) === m).reduce((s, x) => s + x.amount, 0) })), error: null };
      }
      if (!isAdmin()) return { data: null, error: { message: 'No autorizado' } };
      if (name === 'admin_set_status') { db.profiles.find(p => p.id === a.p_user).status = a.p_status; return { data: null, error: null }; }
      if (name === 'admin_copy_expenses') {
        const src = db.general_expenses.filter(g => g.month === a.p_from);
        src.forEach(g => db.general_expenses.push({ id: uuid(), month: a.p_to, name: g.name, amount: g.amount, paid: false, created_at: new Date().toISOString() }));
        return { data: src.length, error: null };
      }
    },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      async signInWithPassword({ email, password }) {
        const u = db.users.find(x => x.username + '@mailinator.com' === email);
        if (!u || u.password !== password) return { data: null, error: { message: 'Invalid login credentials' } };
        setSes({ user: { id: u.id } }); return { data: { session }, error: null };
      },
      async signUp({ email, password, options }) {
        const un = options.data.username;
        if (db.users.some(x => x.username === un)) return { data: null, error: { message: 'User already registered' } };
        const id = uuid(); db.users.push({ id, username: un, password });
        db.profiles.push({ id, username: un, display_name: options.data.display_name, status: 'pending', is_admin: false, monthly_quota: 0, created_at: new Date().toISOString() });
        setSes({ user: { id } }); return { data: { session }, error: null };
      },
      async signOut() { setSes(null); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  window.supabase = { createClient: () => api };
})();
