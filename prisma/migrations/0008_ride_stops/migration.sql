CREATE TABLE "RideStop" (
  "id" TEXT NOT NULL,
  "rideId" TEXT NOT NULL,
  "address" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RideStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RideStop_rideId_position_key"
ON "RideStop"("rideId", "position");

CREATE INDEX "RideStop_rideId_position_idx"
ON "RideStop"("rideId", "position");

ALTER TABLE "RideStop"
ADD CONSTRAINT "RideStop_rideId_fkey"
FOREIGN KEY ("rideId") REFERENCES "Ride"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
