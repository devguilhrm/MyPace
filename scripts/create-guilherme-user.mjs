const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const user = {
  username: process.env.SEED_USERNAME ?? 'guilherme',
  email: process.env.SEED_USER_EMAIL,
  password: process.env.SEED_USER_PASSWORD,
};

if (!supabaseUrl || !serviceRoleKey || !user.email || !user.password) {
  console.error('Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_USER_EMAIL e SEED_USER_PASSWORD antes de rodar este script.');
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
      display_name: 'Guilherme',
    },
  }),
});

const payload = await response.json().catch(() => ({}));

if (response.ok) {
  console.log(`Usuario criado: ${user.username} (${user.email})`);
  process.exit(0);
}

const message = payload.msg ?? payload.message ?? JSON.stringify(payload);
if (response.status === 422 && /already|exists|registered/i.test(message)) {
  console.log(`Usuario ja existe: ${user.username} (${user.email})`);
  process.exit(0);
}

console.error(`Falha ao criar usuario (${response.status}): ${message}`);
process.exit(1);
