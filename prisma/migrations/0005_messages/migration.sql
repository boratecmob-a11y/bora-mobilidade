CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "rideId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Message_rideId_createdAt_idx" ON "Message"("rideId", "createdAt");
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");

ALTER TABLE "Message"
ADD CONSTRAINT "Message_rideId_fkey"
FOREIGN KEY ("rideId") REFERENCES "Ride"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message"
ADD CONSTRAINT "Message_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
