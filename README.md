# MyPace

MyPace e um MVP pessoal para consultar a periodizacao de corrida do Guilherme em uma interface simples, privada e pronta para deploy.

O foco do projeto e direto: entrar, ver o treino de hoje, registrar execucao em poucos campos e acompanhar a evolucao real de pace ao longo da periodizacao.

## O Que O App Faz

- Login privado com Supabase Auth.
- Consulta da periodizacao gerada a partir do plano `periodizacao_meia_maratona_guilherme_com_ritmos.md`.
- Tela `Hoje` detecta automaticamente o treino pela data atual.
- Tela `Semana` lista os treinos da semana com status visual.
- Tela `Evolução` mostra progresso, cards tecnicos e grafico usando somente treinos finalizados.
- Registro rapido com km real, pace real, RPE e observacao opcional.

## Fluxo

```mermaid
flowchart LR
  Login[Login privado] --> Hoje[Hoje: proximo treino]
  Hoje --> Semana[Semana atual]
  Semana --> Registro[Registro rapido]
  Registro --> Evolucao[Evolucao real]
  Registro --> Supabase[(Supabase)]
  Evolucao --> Supabase
  Semana --> API[NestJS API]
  API --> PlanoBase[Periodizacao no backend]
```

## Stack

- Frontend: HTML, CSS e JavaScript puro em `public/`.
- Backend: NestJS + Express em `src/` e `api/`.
- Auth e persistencia: Supabase.
- Deploy: Vercel.
- Linguagem: TypeScript.

## Rodar Localmente

```bash
npm install
npm run dev
```

Acesse:

```text
http://localhost:3000
```

## Variaveis De Ambiente

Crie um `.env` local a partir do `.env.example`:

```bash
cp .env.example .env
```

Preencha:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SEED_USERNAME=
SEED_USER_EMAIL=
SEED_USER_PASSWORD=
```

Nunca versionar `.env`, chaves privadas ou guias pessoais de deploy.

## Scripts

```bash
npm run dev
npm run build
npm start
npm run typecheck
npm run seed:user
```

## API

Documentacao dos endpoints: [docs/API.md](docs/API.md).

## Supabase

Schema principal: [supabase/schema.sql](supabase/schema.sql).

## Deploy Na Vercel

```text
Framework preset: Other
Build command: npm run build
Output directory: public
Install command: npm install
Node.js: 22.x
```

Configure as variaveis de ambiente na Vercel antes de publicar.
