CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'SUPERVISOR', 'SUPPORT', 'ANALYST');

CREATE TABLE "AdminAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUPPORT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminAccount_email_key" ON "AdminAccount"("email");

CREATE TABLE "AdminActivationToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminActivationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminActivationToken_email_key" ON "AdminActivationToken"("email");
CREATE INDEX "AdminActivationToken_expiresAt_idx" ON "AdminActivationToken"("expiresAt");

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousData" JSONB,
    "newData" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");
CREATE INDEX "AdminAuditLog_entityType_entityId_idx" ON "AdminAuditLog"("entityType", "entityId");

ALTER TABLE "AdminAuditLog"
ADD CONSTRAINT "AdminAuditLog_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "AdminAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AdminAccount_single_owner_key" ON "AdminAccount" ("role") WHERE "role" = 'OWNER';

CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Registros de auditoria são imutáveis';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminAuditLog_no_update_delete"
BEFORE UPDATE OR DELETE ON "AdminAuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();

CREATE TRIGGER "AdminAuditLog_no_truncate"
BEFORE TRUNCATE ON "AdminAuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_admin_audit_mutation();
