# BORA v2.2 — implantação em nuvem

## Render
1. Crie um Web Service usando este projeto.
2. O `render.yaml` já define o serviço Node e o PostgreSQL.
3. O build usa `npm install` porque o projeto ainda não inclui `package-lock.json`.
4. Antes de produção, é necessário criar e revisar as migrations do Prisma para preparar o banco com segurança; não execute migrações automaticamente até essa etapa estar pronta.
5. Configure as variáveis `MP_APP_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` e `MP_NOTIFICATION_URL` depois de conhecer o domínio HTTPS.


## Mercado Pago
- Redirect URI: `https://SEU-DOMINIO/api/mercadopago/callback`
- Webhook: `https://SEU-DOMINIO/api/payments/webhook`
- Nunca coloque `MP_CLIENT_SECRET` no aplicativo Android.

## Banco
A produção usa PostgreSQL. SQLite fica apenas para versões locais antigas.
