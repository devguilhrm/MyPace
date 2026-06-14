# MyPace

MyPace e uma aplicacao simples para consultar e registrar treinos de corrida para meia maratona.

O projeto entrega:

- frontend estatico em HTML/CSS/JS;
- API NestJS;
- autenticação com Supabase;
- persistencia de progresso por usuario;
- deploy pronto para Vercel.

## Stack

- NestJS
- Express
- Supabase Auth + Postgres
- Vercel
- TypeScript

## Rodar Localmente

```bash
npm install
npm run dev
```

Acesse:

```text
http://localhost:3000
```

Se a porta estiver ocupada:

```bash
PORT=3001 npm run dev
```

## Variaveis

Copie `.env.example` para `.env` e configure:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SEED_USERNAME=
SEED_USER_EMAIL=
SEED_USER_PASSWORD=
```

Nunca versionar `.env` ou chaves privadas.

## Scripts

```bash
npm run build
npm run dev
npm start
npm run typecheck
npm run seed:user
```

## API

Veja [docs/API.md](docs/API.md).

## Banco

O schema do Supabase fica em [supabase/schema.sql](supabase/schema.sql).

## Deploy

Este repositorio esta pronto para Vercel. Configure as variaveis de ambiente no painel da Vercel e use:

```text
Build command: npm run build
Framework preset: Other
Node: 22.x
```

Detalhes operacionais, credenciais de exemplo e checklist privado devem ficar fora do Git.
