# BORA Mobilidade — Backend

Backend da plataforma BORA Mobilidade, com Node.js, TypeScript, Express, Prisma e PostgreSQL.

## Estrutura
- `src/server.ts` — API HTTP
- `prisma/schema.prisma` — modelo PostgreSQL
- `prisma/migrations/` — migrações de banco
- `render.yaml` — deploy no Render

## Local
```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

## Produção
O Render executa `prisma migrate deploy` antes de iniciar a API. Configure `CORS_ORIGIN` com as origens dos seus aplicativos/sites.

## Principais endpoints
- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/drivers/online`
- `POST /api/drivers/location`
- `GET /api/rides/available`
- `GET /api/rides/estimate`
- `POST /api/rides`
- `GET /api/rides/:id`
- `POST /api/rides/:id/accept`
- `POST /api/rides/:id/start`
- `POST /api/rides/:id/finish`
- `POST /api/rides/:id/cancel`
- Mercado Pago: `/api/mercadopago/*` e `/api/payments/*`

## Observação
A tarifa usa distância em linha reta (Haversine), não distância real de rota. Para produção, o cálculo pode ser conectado a um provedor de rotas.
