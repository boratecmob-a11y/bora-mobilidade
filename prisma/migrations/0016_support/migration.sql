CREATE TYPE "SupportTicketStatus" AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'CLOSED'
);

CREATE TYPE "SupportMessageSenderType" AS ENUM (
  'USER',
  'ADMIN'
);

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedAdminId" TEXT,
  "subject" TEXT NOT NULL,
  "category" TEXT,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),

  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportMessage" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "senderType" "SupportMessageSenderType" NOT NULL,
  "senderUserId" TEXT,
  "senderAdminId" TEXT,
  "senderName" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicket_userId_updatedAt_idx"
ON "SupportTicket"("userId", "updatedAt");

CREATE INDEX "SupportTicket_status_updatedAt_idx"
ON "SupportTicket"("status", "updatedAt");

CREATE INDEX "SupportTicket_assignedAdminId_status_idx"
ON "SupportTicket"("assignedAdminId", "status");

CREATE INDEX "SupportMessage_ticketId_createdAt_idx"
ON "SupportMessage"("ticketId", "createdAt");

CREATE INDEX "SupportMessage_senderUserId_createdAt_idx"
ON "SupportMessage"("senderUserId", "createdAt");

CREATE INDEX "SupportMessage_senderAdminId_createdAt_idx"
ON "SupportMessage"("senderAdminId", "createdAt");

ALTER TABLE "SupportTicket"
ADD CONSTRAINT "SupportTicket_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportTicket"
ADD CONSTRAINT "SupportTicket_assignedAdminId_fkey"
FOREIGN KEY ("assignedAdminId") REFERENCES "AdminAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportMessage"
ADD CONSTRAINT "SupportMessage_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportMessage"
ADD CONSTRAINT "SupportMessage_senderUserId_fkey"
FOREIGN KEY ("senderUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportMessage"
ADD CONSTRAINT "SupportMessage_senderAdminId_fkey"
FOREIGN KEY ("senderAdminId") REFERENCES "AdminAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
