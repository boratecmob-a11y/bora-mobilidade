# BORA Backend v1.7

Backend Node.js + TypeScript + Express + Prisma + SQLite para desenvolvimento.

## Instalação
```bash
npm install
cp .env.example .env
npx prisma migrate dev --name init
npm run dev
```

## Endpoints principais
- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/drivers/online`
- `POST /api/drivers/location`
- `GET /api/rides/available`
- `POST /api/rides`
- `GET /api/rides/:id`
- `POST /api/rides/:id/accept`
- `POST /api/rides/:id/start`
- `POST /api/rides/:id/finish`
- `POST /api/rides/:id/cancel`

A aceitação usa uma atualização condicional para reduzir o risco de dois motoristas aceitarem a mesma corrida.


### Pagamentos v2.1
Configure `MP_APP_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` e `MP_NOTIFICATION_URL` no `.env`. O webhook deve apontar para uma URL HTTPS pública. Para testes, use as contas de teste do Mercado Pago.


## Regras iniciais da BORA
- Tipos de veículo: `CAR` e `MOTO`.
- O passageiro escolhe o tipo ao solicitar a corrida.
- Motoristas recebem apenas corridas compatíveis com seu veículo.
- Comissão BORA: R$ 1,00 fixo por corrida.
