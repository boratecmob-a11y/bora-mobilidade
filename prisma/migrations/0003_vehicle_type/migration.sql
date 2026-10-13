CREATE TYPE "VehicleType" AS ENUM ('CAR', 'MOTO');

ALTER TABLE "Driver"
ADD COLUMN "vehicleType" "VehicleType";

ALTER TABLE "Ride"
ADD COLUMN "vehicleType" "VehicleType" NOT NULL DEFAULT 'CAR';
