# API MyPace

Base URL local:

```text
http://localhost:3000/api
```

Em producao, use:

```text
https://seu-dominio.vercel.app/api
```

## GET /health

Verifica se a API esta online.

Resposta:

```json
{
  "status": "ok",
  "app": "mypace",
  "timestamp": "2026-06-14T23:31:45.123Z"
}
```

## GET /config

Retorna as configuracoes publicas necessarias para o login no navegador.

Resposta:

```json
{
  "authEnabled": true,
  "supabaseUrl": "https://xxxxx.supabase.co",
  "supabaseAnonKey": "public-anon-key",
  "persistenceEnabled": true
}
```

Notas:

- `supabaseAnonKey` e publica.
- `SUPABASE_SERVICE_ROLE_KEY` nunca e enviada ao navegador.
- `persistenceEnabled` so fica `true` quando a API tem a service role configurada.

## GET /plan

Retorna a periodizacao inicial adaptada do arquivo `Markdown(8).md colado`, recalibrada para 21,1 km abaixo de 2h.

Resposta resumida:

```json
{
  "schemaVersion": "6.1.0",
  "planMeta": {
    "startDate": "2026-06-15",
    "weeks": 20,
    "targetRaceDistanceKm": 21.1
  },
  "weeks": [
    {
      "week": 1,
      "workouts": [
        {
          "id": "w1-1-corrida-facil-z2-",
          "week": 1,
          "order": 1,
          "status": "pendente",
          "type": "Corrida facil (Z2)",
          "zone": "Z2",
          "durationMinutes": 20,
          "distanceKm": 3,
          "paceTarget": "6:35-7:05/km"
        }
      ]
    }
  ]
}
```

## GET /user-plan

Busca o plano salvo do usuario autenticado.

Headers:

```text
Authorization: Bearer <supabase_access_token>
```

Resposta quando existe plano salvo:

```json
{
  "plan": {
    "schemaVersion": "6.1.0"
  },
  "updated_at": "2026-06-14T23:31:45.123Z"
}
```

Resposta quando nao existe plano salvo:

```json
null
```

Erros:

- `401`: token ausente ou invalido.

## PUT /user-plan

Salva o progresso do usuario autenticado.

Headers:

```text
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

Body:

```json
{
  "schemaVersion": "6.1.0",
  "weeks": []
}
```

Resposta:

```json
{
  "saved": true
}
```

Erros:

- `401`: token ausente ou invalido.
- `500`: erro de comunicacao com Supabase.
