# BORA Mobilidade — Backend

Backend da plataforma BORA Mobilidade (Node.js + Express + Prisma + PostgreSQL).

## Rodar localmente

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
npm run dev
```

## Produção / Render

Build: `npm install && npx prisma generate && npm run build`

Start: `npx prisma migrate deploy && npm start`

Variáveis obrigatórias: `DATABASE_URL` e `JWT_SECRET`.

Para Mercado Pago, configure `MP_APP_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` e `MP_NOTIFICATION_URL`.

Health check: `/health`
