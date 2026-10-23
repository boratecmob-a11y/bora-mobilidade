# BORA v2.2 — implantação em nuvem

## Render
1. Crie um Web Service usando este projeto.
2. O `render.yaml` já define o serviço Node e o PostgreSQL.
3. O build usa `npm install` porque o projeto ainda não inclui `package-lock.json`.
4. Antes de produção, é necessário criar e revisar as migrations do Prisma para preparar o banco com segurança; não execute migrações automaticamente até essa etapa estar pronta.


- Webhook: `https://SEU-DOMINIO/api/payments/webhook`

## Banco
A produção usa PostgreSQL. SQLite fica apenas para versões locais antigas.
