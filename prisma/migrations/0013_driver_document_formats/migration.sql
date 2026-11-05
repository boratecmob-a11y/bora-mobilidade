ALTER TABLE "DriverDocument"
  ADD COLUMN "frontImageFormat" TEXT,
  ADD COLUMN "backImageFormat" TEXT,
  ADD COLUMN "documentFormat" TEXT;

ALTER TABLE "DriverVehicle"
  ADD COLUMN "crlvFormat" TEXT,
  ADD COLUMN "photoFrontFormat" TEXT,
  ADD COLUMN "photoSideFormat" TEXT;
