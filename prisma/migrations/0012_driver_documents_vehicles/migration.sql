CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "LicenseCategory" AS ENUM ('A', 'B', 'AB', 'C', 'D', 'E');

CREATE TYPE "DriverDocumentType" AS ENUM ('CNH', 'CRIMINAL_RECORD');

CREATE TABLE "DriverDocument" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "licenseNumber" TEXT,
    "licenseCategory" "LicenseCategory",
    "licenseExpiresAt" TIMESTAMP(3),
    "ear" BOOLEAN NOT NULL DEFAULT false,
    "frontImageUrl" TEXT,
    "backImageUrl" TEXT,
    "documentUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverVehicle" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "crlvUrl" TEXT,
    "photoFrontUrl" TEXT,
    "photoSideUrl" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverVehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverDocument_driverId_type_key"
ON "DriverDocument"("driverId", "type");

CREATE INDEX "DriverDocument_status_idx"
ON "DriverDocument"("status");

CREATE UNIQUE INDEX "DriverVehicle_plate_key"
ON "DriverVehicle"("plate");

CREATE UNIQUE INDEX "DriverVehicle_driverId_vehicleType_key"
ON "DriverVehicle"("driverId", "vehicleType");

CREATE INDEX "DriverVehicle_status_idx"
ON "DriverVehicle"("status");

ALTER TABLE "DriverDocument"
ADD CONSTRAINT "DriverDocument_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverVehicle"
ADD CONSTRAINT "DriverVehicle_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
