# Deploy do BORA no Render

1. Suba este diretório como projeto do backend.
2. Use o `render.yaml` incluído para criar a API e o PostgreSQL.
3. Configure `CORS_ORIGIN`, `MP_APP_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` e `MP_NOTIFICATION_URL`.
4. O deploy gera o Prisma Client, compila TypeScript e aplica as migrações.
5. Valide `GET /health` antes de conectar os aplicativos.

Nunca publique `.env` ou tokens do Mercado Pago no Git.
