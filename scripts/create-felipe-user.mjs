import { existsSync, readFileSync } from 'node:fs';

loadDotEnv();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const user = {
  username: 'felipe',
  email: process.env.FELIPE_USER_EMAIL ?? 'felipe@run.local',
  password: process.env.FELIPE_USER_PASSWORD ?? 'felipe123',
  displayName: 'Felipe',
};

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente ou no .env antes de rodar este script.');
  process.exit(1);
}

const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      username: user.username,
      display_name: user.displayName,
    },
  }),
});

const payload = await response.json().catch(() => ({}));

if (response.ok) {
  console.log(`Usuario criado: ${user.username} (${user.email})`);
  process.exit(0);
}

const message = payload.msg ?? payload.message ?? JSON.stringify(payload);
if (response.status === 422 && /already|exists|registered|User already registered/i.test(message)) {
  console.log(`Usuario ja existe: ${user.username} (${user.email})`);
  process.exit(0);
}

console.error(`Falha ao criar usuario (${response.status}): ${message}`);
process.exit(1);

function loadDotEnv() {
  if (!existsSync('.env')) return;

  const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}
