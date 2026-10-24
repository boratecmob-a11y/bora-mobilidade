import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from "cloudinary";
import { PrismaClient, Role, RideStatus, VehicleType } from "@prisma/client";

dotenv.config();
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const secret = process.env.JWT_SECRET || "development-secret";
const BORA_FIXED_COMMISSION = Number(process.env.BORA_FIXED_COMMISSION || 1);
const ASAAS_API_URL = (process.env.ASAAS_API_URL || "https://api-sandbox.asaas.com").replace(/\/$/, "");

function makeToken(u: { id: string; role: Role }) {
  return jwt.sign({ id: u.id, role: u.role }, secret, { expiresIn: "7d" });
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "Não autorizado" });
  try {
    (req as any).user = jwt.verify(h.slice(7), secret);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

function role(req: express.Request, r: Role) {
  return (req as any).user?.role === r;
}

function asaasConfigured() {
  return Boolean(process.env.ASAAS_API_KEY);
}

async function asaasRequest(path: string, init: RequestInit = {}) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error("ASAAS_API_KEY não configurada");
  const headers = new Headers(init.headers || {});
  headers.set("access_token", apiKey);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${ASAAS_API_URL}${path}`, { ...init, headers });
}

function isValidCPF(value: unknown): boolean {
  const cpf = String(value || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

function normalizeDocument(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

async function getOrCreateAsaasCustomer(user: { id: string; name: string; email: string; cpfCnpj: string | null }) {
  const externalReference = user.id;
  const existing = await asaasRequest(`/v3/customers?externalReference=${encodeURIComponent(externalReference)}&limit=1`);
  const existingData: any = await existing.json();
  if (existing.ok && Array.isArray(existingData.data) && existingData.data[0]?.id) return existingData.data[0];

  const cpfCnpj = normalizeDocument(user.cpfCnpj);
  if (!cpfCnpj) throw new Error("CPF/CNPJ do passageiro é obrigatório para pagamento Asaas");

  const created = await asaasRequest("/v3/customers", {
    method: "POST",
    body: JSON.stringify({
      name: user.name,
      email: user.email,
      cpfCnpj,
      externalReference,
      notificationDisabled: false
    })
  });
  const data: any = await created.json();
  if (!created.ok) {
    const message = data?.errors?.[0]?.description || data?.message || "Asaas recusou o cadastro do cliente";
    throw new Error(message);
  }
  return data;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "BORA Backend", version: "2.2-asaas" }));

app.post("/api/payments/checkout/:rideId", auth, async (req, res) => {
  if (!role(req, Role.PASSENGER)) return res.status(403).json({ error: "Apenas passageiros" });
  if (!asaasConfigured()) return res.status(503).json({ error: "Asaas ainda não configurado no servidor" });

  try {
    const ride = await prisma.ride.findUnique({
      where: { id: req.params.rideId },
      include: { passenger: true }
    });
    if (!ride || ride.passengerId !== (req as any).user.id) return res.status(404).json({ error: "Corrida não encontrada" });
    if (ride.status === RideStatus.CANCELLED) return res.status(409).json({ error: "Corrida cancelada" });
    if (ride.paymentStatus === "RECEIVED" || ride.paymentStatus === "CONFIRMED") {
      return res.status(409).json({ error: "Corrida já possui pagamento confirmado" });
    }

    const customer = await getOrCreateAsaasCustomer(ride.passenger);
    const billingTypes = ["UNDEFINED", "BOLETO", "CREDIT_CARD", "PIX"];
    const billingType = billingTypes.includes(String(req.body?.billingType)) ? String(req.body.billingType) : "UNDEFINED";
    const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const payment = await asaasRequest("/v3/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customer.id,
        billingType,
        value: Number(ride.estimatedFare.toFixed(2)),
        dueDate: due,
        description: `Corrida BORA ${ride.id}`,
        externalReference: ride.id
      })
    });

    const data: any = await payment.json();
    if (!payment.ok) {
      return res.status(502).json({ error: "Asaas recusou a cobrança", details: data });
    }

    await prisma.ride.update({
      where: { id: ride.id },
      data: {
        asaasPaymentId: String(data.id),
        asaasCustomerId: String(customer.id),
        paymentStatus: String(data.status || "PENDING")
      }
    });

    return res.json({
      id: data.id,
      status: data.status,
      invoiceUrl: data.invoiceUrl,
      bankSlipUrl: data.bankSlipUrl,
      value: data.value,
      billingType: data.billingType,
      externalReference: data.externalReference
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Não foi possível criar a cobrança Asaas" });
  }
});

app.post("/api/payments/webhook", async (req, res) => {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected) return res.status(503).json({ error: "Webhook Asaas não configurado" });
  if (req.headers["asaas-access-token"] !== expected) return res.sendStatus(401);

  try {
    const event = String(req.body?.event || "");
    const payment = req.body?.payment;
    const paymentId = String(payment?.id || "");
    const rideId = String(payment?.externalReference || "");

    if (!paymentId || !rideId) return res.sendStatus(200);

    const statusMap: Record<string, string> = {
      PAYMENT_CREATED: "PENDING",
      PAYMENT_CONFIRMED: "CONFIRMED",
      PAYMENT_RECEIVED: "RECEIVED",
      PAYMENT_OVERDUE: "OVERDUE",
      PAYMENT_DELETED: "DELETED",
      PAYMENT_REFUNDED: "REFUNDED",
      PAYMENT_PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
      PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "REFUSED"
    };

    const newStatus = statusMap[event];
    if (!newStatus) return res.sendStatus(200);

    const confirmed = newStatus === "CONFIRMED" || newStatus === "RECEIVED";
    const updateData: any = {
      paymentStatus: newStatus
    };

    if (confirmed) {
      updateData.paymentConfirmedAt = new Date();
    }

    const billingType = String(payment?.billingType || "");
    if (["PIX", "CREDIT_CARD", "DEBIT_CARD"].includes(billingType)) {
      updateData.paymentMethod = billingType;
    }

    // Nunca associa uma cobrança a uma corrida sem correspondência exata.
    await prisma.ride.updateMany({
      where: {
        id: rideId,
        asaasPaymentId: paymentId
      },
      data: updateData
    });

    return res.sendStatus(200);
  } catch (e) {
    console.error("Erro ao processar webhook Asaas:", e);
    return res.sendStatus(500);
  }
});

app.post("/api/payments/pix/:rideId", auth, async (req, res) => {
  if (!role(req, Role.DRIVER)) {
    return res.status(403).json({ error: "Apenas o motorista da corrida pode gerar o Pix" });
  }
  if (!asaasConfigured()) {
    return res.status(503).json({ error: "Asaas ainda não configurado no servidor" });
  }

  try {
    const ride = await prisma.ride.findUnique({
      where: { id: req.params.rideId },
      include: { passenger: true, driver: true }
    });

    if (!ride) return res.status(404).json({ error: "Corrida não encontrada" });
    if (ride.driver?.userId !== (req as any).user.id) {
      return res.status(403).json({ error: "Você não é o motorista desta corrida" });
    }
    if (ride.status !== RideStatus.COMPLETED) {
      return res.status(409).json({ error: "O Pix só pode ser gerado após finalizar a corrida" });
    }
    if (ride.paymentStatus === "RECEIVED" || ride.paymentStatus === "CONFIRMED") {
      return res.status(409).json({ error: "Esta corrida já tem pagamento confirmado" });
    }

    const pixResult: any = await prisma.$transaction(async (tx) => {
      // Serializa a criação do Pix por corrida no PostgreSQL.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ride.id}))`;

      // Rele a corrida após obter o bloqueio: não confiar no estado antigo.
      const currentRide = await tx.ride.findUnique({
        where: { id: ride.id },
        include: { passenger: true, driver: true }
      });

      if (!currentRide) {
        return { errorStatus: 404, error: "Corrida não encontrada" };
      }

      if (currentRide.driver?.userId !== (req as any).user.id) {
        return { errorStatus: 403, error: "Você não é o motorista desta corrida" };
      }

      if (currentRide.status !== RideStatus.COMPLETED) {
        return { errorStatus: 409, error: "O Pix só pode ser gerado após finalizar a corrida" };
      }

      if (currentRide.paymentStatus === "RECEIVED" ||
          currentRide.paymentStatus === "CONFIRMED") {
        return { errorStatus: 409, error: "Esta corrida já tem pagamento confirmado" };
      }

      let paymentId = currentRide.asaasPaymentId;

      if (paymentId && currentRide.paymentMethod !== "PIX") {
        return {
          errorStatus: 409,
          error: "Esta corrida já possui uma cobrança de outro tipo. Não será criada outra cobrança automaticamente."
        };
      }

      if (!paymentId) {
        // Antes de criar, procura uma cobrança Pix já registrada no Asaas.
        let lookupResponse: Response;
        let lookup: any;

        try {
          lookupResponse = await asaasRequest(
            `/v3/payments?externalReference=${encodeURIComponent(currentRide.id)}&limit=10`
          );
          lookup = await lookupResponse.json();
        } catch (error) {
          console.error("Não foi possível consultar cobranças existentes no Asaas:", error);
          return {
            errorStatus: 502,
            error: "Não foi possível verificar se já existe uma cobrança Pix. Nenhuma nova cobrança foi criada."
          };
        }

        if (!lookupResponse.ok || !Array.isArray(lookup?.data)) {
          console.error("Consulta de cobranças no Asaas falhou:", lookup?.errors || lookupResponse.status);
          return {
            errorStatus: 502,
            error: "Não foi possível verificar cobranças anteriores no Asaas. Tente novamente mais tarde."
          };
        }

        const existingPix = lookup.data.find((item: any) =>
          item?.billingType === "PIX" &&
          Number(item?.value) === Number(currentRide.estimatedFare.toFixed(2)) &&
          item?.id &&
          !["DELETED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(String(item?.status || ""))
        );

        if (existingPix) {
          paymentId = String(existingPix.id);

          await tx.ride.update({
            where: { id: currentRide.id },
            data: {
              asaasPaymentId: paymentId,
              asaasCustomerId: String(existingPix.customer || currentRide.asaasCustomerId || ""),
              paymentMethod: "PIX",
              paymentStatus: String(existingPix.status || "PENDING"),
              paymentConfirmedAt: null
            }
          });
        }

        if (!paymentId) {
          const customer = await getOrCreateAsaasCustomer(currentRide.passenger);
        const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10);

        const createdResponse = await asaasRequest("/v3/payments", {
          method: "POST",
          body: JSON.stringify({
            customer: customer.id,
            billingType: "PIX",
            value: Number(currentRide.estimatedFare.toFixed(2)),
            dueDate,
            description: `Corrida BORA ${currentRide.id}`,
            externalReference: currentRide.id
          })
        });

        const created: any = await createdResponse.json();

        if (!createdResponse.ok || !created.id) {
          console.error(
            "Falha ao criar cobrança Pix no Asaas:",
            created?.errors || created?.message || createdResponse.status
          );
          return {
            errorStatus: 502,
            error: "Não foi possível confirmar a criação da cobrança Pix. Consulte o Asaas antes de tentar novamente."
          };
        }

        paymentId = String(created.id);

        await tx.ride.update({
          where: { id: currentRide.id },
          data: {
            asaasPaymentId: paymentId,
            asaasCustomerId: String(customer.id),
            paymentMethod: "PIX",
            paymentStatus: String(created.status || "PENDING"),
            paymentConfirmedAt: null
          }
        });
        }
      }

      return { paymentId };
    }, { maxWait: 10000, timeout: 60000 });

    if (pixResult.errorStatus) {
      return res.status(pixResult.errorStatus).json({ error: pixResult.error });
    }

    const paymentId = String(pixResult.paymentId);

    const qrResponse = await asaasRequest(
      `/v3/payments/${encodeURIComponent(paymentId)}/pixQrCode`
    );
    const qr: any = await qrResponse.json();

    if (!qrResponse.ok || !qr.payload) {
      console.error("Falha ao consultar QR Code Pix no Asaas:", qr?.errors || qr?.message || qrResponse.status);
      return res.status(502).json({
        error: "A cobrança existe, mas não foi possível obter o QR Code Pix. Tente consultar novamente."
      });
    }

    return res.json({
      rideId: ride.id,
      paymentId,
      paymentMethod: "PIX",
      status: String((await prisma.ride.findUnique({ where: { id: ride.id }, select: { paymentStatus: true } }))?.paymentStatus || "PENDING"),
      value: Number(ride.estimatedFare.toFixed(2)),
      encodedImage: qr.encodedImage,
      payload: qr.payload,
      expirationDate: qr.expirationDate
    });
  } catch (error) {
    console.error("Erro ao gerar Pix da corrida:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Erro interno ao gerar Pix"
    });
  }
});

app.get("/api/payments/status/:rideId", auth, async (req, res) => {
  const ride = await prisma.ride.findUnique({ where: { id: req.params.rideId }, include: { driver: true } });
  if (!ride) return res.status(404).json({ error: "Corrida não encontrada" });

  const uid = (req as any).user.id;
  if (ride.passengerId !== uid && ride.driver?.userId !== uid) return res.status(403).json({ error: "Sem acesso" });

  if (ride.asaasPaymentId && asaasConfigured()) {
    try {
      const r = await asaasRequest(`/v3/payments/${ride.asaasPaymentId}`);
      if (r.ok) {
        const p: any = await r.json();
        await prisma.ride.update({ where: { id: ride.id }, data: { paymentStatus: String(p.status || ride.paymentStatus) } });
        return res.json({ status: p.status, id: p.id, invoiceUrl: p.invoiceUrl, value: p.value });
      }
    } catch {}
  }

  return res.json({ status: ride.paymentStatus, id: ride.asaasPaymentId });
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, role: r, cpfCnpj, profilePhoto } = req.body;
  const normalizedCpf = normalizeDocument(cpfCnpj);
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!name || !normalizedEmail || !password || !["PASSENGER", "DRIVER"].includes(r)) {
    return res.status(400).json({ error: "Dados inválidos" });
  }
  if (!isValidCPF(normalizedCpf)) {
    return res.status(400).json({ error: "Informe um CPF válido" });
  }
  if (r === "PASSENGER") {
    if (
      typeof profilePhoto !== "string" ||
      profilePhoto.length > 4500000 ||
      !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profilePhoto)
    ) {
      return res.status(400).json({ error: "Selecione uma foto válida para o perfil" });
    }
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return res.status(503).json({ error: "Armazenamento de fotos ainda não configurado" });
    }
  }

  let uploaded = null;
  try {
    const existingEmail = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });
    if (existingEmail) {
      return res.status(409).json({ error: "Este e-mail já está cadastrado" });
    }

    const existingCpf = await prisma.user.findFirst({
      where: { cpfCnpj: normalizedCpf }
    });
    if (existingCpf) {
      return res.status(409).json({ error: "Este CPF já está cadastrado" });
    }

    if (r === "PASSENGER") {
      uploaded = await cloudinary.uploader.upload(profilePhoto, {
        folder: "bora/profile",
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }]
      });
    }

    const u = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(String(password), 10),
        role: r,
        cpfCnpj: normalizedCpf,
        profilePhotoUrl: uploaded ? uploaded.secure_url : null,
        profilePhotoPublicId: uploaded ? uploaded.public_id : null
      }
    });

    if (r === "DRIVER") {
      await prisma.driver.create({ data: { userId: u.id } });
    }

    return res.status(201).json({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      profilePhotoUrl: u.profilePhotoUrl,
      token: makeToken(u)
    });
  } catch (error) {
    if (uploaded?.public_id) {
      try {
        await cloudinary.uploader.destroy(uploaded.public_id);
      } catch {}
    }
    console.error("Falha no cadastro:", error);
    return res.status(400).json({ error: "Não foi possível concluir o cadastro" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const u = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (!u || !(await bcrypt.compare(req.body.password, u.passwordHash))) return res.status(401).json({ error: "Login inválido" });
  res.json({ id: u.id, name: u.name, role: u.role, token: makeToken(u) });
});


app.get("/api/drivers/daily-balance", auth, async (req, res) => {
  if (!role(req, Role.DRIVER)) {
    return res.status(403).json({ error: "Apenas motoristas" });
  }

  try {
    const driver = await prisma.driver.findUnique({
      where: { userId: (req as any).user.id }
    });
    if (!driver) {
      return res.status(404).json({ error: "Motorista não encontrado" });
    }

    // Dia corrente em Brasília (UTC-3).
    const now = new Date();
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);

    const start = new Date(`${day}T03:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const rides = await prisma.ride.findMany({
      where: {
        driverId: driver.id,
        status: RideStatus.COMPLETED,
        createdAt: { gte: start, lt: end }
      },
      select: {
        id: true,
        createdAt: true,
        estimatedFare: true,
        commission: true,
        driverPayout: true,
        paymentStatus: true
      },
      orderBy: { createdAt: "desc" }
    });

    const gross = rides.reduce((sum, r) => sum + r.estimatedFare, 0);
    const commission = rides.reduce((sum, r) => sum + r.commission, 0);
    const net = rides.reduce((sum, r) => sum + r.driverPayout, 0);

    return res.json({
      date: day,
      ridesCount: rides.length,
      gross: Number(gross.toFixed(2)),
      commission: Number(commission.toFixed(2)),
      net: Number(net.toFixed(2)),
      rides
    });
  } catch (error) {
    console.error("Erro ao consultar saldo diário:", error);
    return res.status(500).json({ error: "Não foi possível consultar o saldo do dia" });
  }
});

app.post("/api/drivers/online", auth, async (req, res) => {
  if (!role(req, Role.DRIVER)) return res.status(403).json({ error: "Apenas motoristas" });
  const data: any = { online: Boolean(req.body.online) };
  if (req.body.vehicleType !== undefined) {
    if (![VehicleType.CAR, VehicleType.MOTO].includes(req.body.vehicleType)) return res.status(400).json({ error: "Tipo de veículo inválido. Use CAR ou MOTO" });
    data.vehicleType = req.body.vehicleType;
  }
  const d = await prisma.driver.update({ where: { userId: (req as any).user.id }, data });
  res.json(d);
});

app.post("/api/drivers/location", auth, async (req, res) => {
  if (!role(req, Role.DRIVER)) return res.status(403).json({ error: "Apenas motoristas" });
  const { latitude, longitude } = req.body;
  if (typeof latitude !== "number" || typeof longitude !== "number") return res.status(400).json({ error: "Localização inválida" });
  const d = await prisma.driver.update({ where: { userId: (req as any).user.id }, data: { latitude, longitude, online: true } });
  res.json(d);
});

app.get("/api/rides/available", auth, async (req, res) => {
  if (!role(req, Role.DRIVER)) return res.status(403).json({ error: "Apenas motoristas" });
  const d = await prisma.driver.findUnique({ where: { userId: (req as any).user.id } });
  if (!d || !d.online || !d.vehicleType) return res.json([]);
  const rides = await prisma.ride.findMany({
    where: { status: RideStatus.SEARCHING_DRIVER, driverId: null, vehicleType: d.vehicleType },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: { passenger: { select: { name: true, profilePhotoUrl: true } }, stops: { orderBy: { position: "asc" } } }
  });
  res.json(rides);
});

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (v: number) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fareFor(distanceKm: number, vehicleType: VehicleType = VehicleType.CAR) {
  const base = Number(process.env.BORA_BASE_FARE || 1.90);
  const perKm = Number(process.env.BORA_PRICE_PER_KM || 1.35);
  const avgSpeed = Number(process.env.BORA_AVG_SPEED_KMH || 30);
  const minutes = (distanceKm / Math.max(avgSpeed, 1)) * 60;
  const perMinute = Number(process.env.BORA_PRICE_PER_MINUTE || 0.27);

  // Horário local de Goiânia, incluindo mudanças oficiais de fuso.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const part = (type: string) =>
    parts.find(p => p.type === type)?.value || "";

  const weekday = part("weekday");
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  const timeOfDay = hour * 60 + minute;
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);

  let dynamicPercent = 0;
  if (isWeekday && timeOfDay >= 360 && timeOfDay < 540) {
    dynamicPercent = 15;
  } else if (isWeekday && timeOfDay >= 1020 && timeOfDay < 1200) {
    dynamicPercent = 20;
  }

  const normalFare = base + distanceKm * perKm + minutes * perMinute;
  const fareWithDynamic = normalFare * (1 + dynamicPercent / 100);
  const fare = vehicleType === VehicleType.MOTO
    ? fareWithDynamic * 0.90
    : fareWithDynamic;

  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    durationMin: Math.max(1, Math.round(minutes)),
    dynamicPercent,
    estimatedFare: Number(fare.toFixed(2))
  };
}

app.get("/api/rides/estimate", auth, async (req, res) => {
  if (!role(req, Role.PASSENGER)) return res.status(403).json({ error: "Apenas passageiros" });
  const originLat = Number(req.query.originLat), originLng = Number(req.query.originLng), destinationLat = Number(req.query.destinationLat), destinationLng = Number(req.query.destinationLng);
  const vehicleType = String(req.query.vehicleType || VehicleType.CAR);
  if (![VehicleType.CAR, VehicleType.MOTO].includes(vehicleType as VehicleType)) return res.status(400).json({ error: "Tipo de veículo inválido. Use CAR ou MOTO" });
  if ([originLat, originLng, destinationLat, destinationLng].some(v => !Number.isFinite(v))) return res.status(400).json({ error: "Coordenadas inválidas" });
  const stopCount = Number(req.query.stopCount || 0);
  if (!Number.isInteger(stopCount) || stopCount < 0 || stopCount > 10) return res.status(400).json({ error: "Informe de 0 a 10 paradas" });
  const quote = fareFor(haversineKm(originLat, originLng, destinationLat, destinationLng), vehicleType as VehicleType);
  const stopsFee = Number((stopCount * 5).toFixed(2));
  res.json({ ...quote, baseEstimatedFare: quote.estimatedFare, stopsCount: stopCount, stopsFee, estimatedFare: Number((quote.estimatedFare + stopsFee).toFixed(2)) });
});

app.post("/api/rides", auth, async (req, res) => {
  if (!role(req, Role.PASSENGER)) return res.status(403).json({ error: "Apenas passageiros" });
  const { originLat, originLng, destinationLat, destinationLng, vehicleType, stops = [] } = req.body;
  if ([originLat, originLng, destinationLat, destinationLng].some(v => typeof v !== "number")) return res.status(400).json({ error: "Dados da corrida inválidos" });
  if (!Array.isArray(stops) || stops.length > 10 || stops.some((stop: any) => !stop || typeof stop.latitude !== "number" || typeof stop.longitude !== "number" || !Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude))) return res.status(400).json({ error: "Paradas inválidas. Informe até 10 paradas com coordenadas válidas" });
  if (![VehicleType.CAR, VehicleType.MOTO].includes(vehicleType)) return res.status(400).json({ error: "Tipo de veículo obrigatório. Use CAR ou MOTO" });
  const quote = fareFor(haversineKm(originLat, originLng, destinationLat, destinationLng), vehicleType as VehicleType);
  const baseFare = quote.estimatedFare;
  const stopsFee = Number((stops.length * 5).toFixed(2));
  const estimatedFare = Number((baseFare + stopsFee).toFixed(2));
  const baseCommission = Math.min(baseFare <= 20 ? 1 : 2, baseFare);
  const commission = Number((baseCommission + stops.length).toFixed(2));
  const payout = Number((baseFare - baseCommission + stops.length * 4).toFixed(2));
  const ride = await prisma.ride.create({
    data: {
      passengerId: (req as any).user.id,
      originLat,
      originLng,
      destinationLat,
      destinationLng,
      vehicleType,
      estimatedFare,
      commission,
      driverPayout: payout,
      status: RideStatus.SEARCHING_DRIVER,
      stops: { create: stops.map((stop: any, index: number) => ({ latitude: stop.latitude, longitude: stop.longitude, address: typeof stop.address === "string" ? stop.address : null, position: index + 1 })) }
    }
  });
  res.status(201).json({ ...ride, distanceKm: quote.distanceKm, durationMin: quote.durationMin, dynamicPercent: quote.dynamicPercent });
});

app.get("/api/rides/:id", auth, async (req, res) => {
  const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { passenger: true, driver: { include: { user: true } }, stops: { orderBy: { position: "asc" } } } });
  if (!ride) return res.status(404).json({ error: "Corrida não encontrada" });
  const uid = (req as any).user.id;
  if (ride.passengerId !== uid && ride.driver?.userId !== uid) return res.status(403).json({ error: "Sem acesso a esta corrida" });
  res.json(ride);
});

app.post("/api/rides/:id/accept", auth, async (req, res) => {
  if (!role(req, Role.DRIVER)) return res.status(403).json({ error: "Apenas motoristas" });
  const d = await prisma.driver.findUnique({ where: { userId: (req as any).user.id } });
  if (!d || !d.online) return res.status(403).json({ error: "Motorista precisa estar online" });
  const current = await prisma.ride.findUnique({ where: { id: req.params.id } });
  if (!current || current.status !== RideStatus.SEARCHING_DRIVER || current.driverId) return res.status(409).json({ error: "Corrida já foi aceita ou não está disponível" });
  if (current.vehicleType !== d.vehicleType) return res.status(403).json({ error: "Veículo incompatível com esta corrida" });
  const updated = await prisma.ride.updateMany({ where: { id: req.params.id, status: RideStatus.SEARCHING_DRIVER, driverId: null }, data: { driverId: d.id, status: RideStatus.DRIVER_ACCEPTED } });
  if (updated.count !== 1) return res.status(409).json({ error: "Outro motorista aceitou primeiro" });
  res.json(await prisma.ride.findUnique({ where: { id: req.params.id } }));
});

async function changeRide(req: express.Request, res: express.Response, status: RideStatus) {
  const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
  if (!ride) return res.status(404).json({ error: "Corrida não encontrada" });
  const uid = (req as any).user.id;
  if (ride.driver?.userId !== uid) return res.status(403).json({ error: "Apenas o motorista da corrida" });
  const allowed = (status === RideStatus.IN_PROGRESS && ride.status === RideStatus.DRIVER_ACCEPTED) || (status === RideStatus.COMPLETED && ride.status === RideStatus.IN_PROGRESS);
  if (!allowed) return res.status(409).json({ error: "Transição de status inválida" });
  res.json(await prisma.ride.update({ where: { id: ride.id }, data: { status } }));
}

app.post("/api/rides/:id/start", auth, (req, res) => changeRide(req, res, RideStatus.IN_PROGRESS));
app.post("/api/rides/:id/finish", auth, (req, res) => changeRide(req, res, RideStatus.COMPLETED));
app.post("/api/rides/:id/cancel", auth, async (req, res) => {
  const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
  if (!ride) return res.status(404).json({ error: "Corrida não encontrada" });
  const uid = (req as any).user.id;
  if (ride.passengerId !== uid && ride.driver?.userId !== uid) return res.status(403).json({ error: "Sem permissão" });
  if ([RideStatus.COMPLETED, RideStatus.CANCELLED].includes(ride.status)) return res.status(409).json({ error: "Corrida já encerrada" });
  res.json(await prisma.ride.update({ where: { id: ride.id }, data: { status: RideStatus.CANCELLED } }));
});

// CHAT DA CORRIDA
app.get("/api/rides/:id/messages", auth, async (req, res) => {
  const ride = await prisma.ride.findUnique({
    where: { id: req.params.id },
    include: { driver: true }
  });

  if (!ride) return res.status(404).json({ error: "Corrida não encontrada" });

  const uid = (req as any).user.id;
  if (ride.passengerId !== uid && ride.driver?.userId !== uid) {
    return res.status(403).json({ error: "Sem acesso a esta conversa" });
  }

  const messages = await prisma.message.findMany({
    where: { rideId: ride.id },
    orderBy: { createdAt: "asc" },
    include: {
      sender: {
        select: { id: true, name: true, role: true }
      }
    }
  });

  res.json(messages);
});

app.post("/api/rides/:id/messages", auth, async (req, res) => {
  const ride = await prisma.ride.findUnique({
    where: { id: req.params.id },
    include: { driver: true }
  });

  if (!ride) return res.status(404).json({ error: "Corrida não encontrada" });

  const uid = (req as any).user.id;
  if (ride.passengerId !== uid && ride.driver?.userId !== uid) {
    return res.status(403).json({ error: "Sem acesso a esta conversa" });
  }

  if ([RideStatus.COMPLETED, RideStatus.CANCELLED].includes(ride.status)) {
    return res.status(409).json({ error: "O chat desta corrida está encerrado" });
  }

  const content = String(req.body?.content || "").trim();

  if (!content) {
    return res.status(400).json({ error: "Mensagem vazia" });
  }

  if (content.length > 1000) {
    return res.status(400).json({ error: "Mensagem muito longa" });
  }

  const message = await prisma.message.create({
    data: {
      rideId: ride.id,
      senderId: uid,
      content
    },
    include: {
      sender: {
        select: { id: true, name: true, role: true }
      }
    }
  });

  res.status(201).json(message);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log("BORA Backend v2.2 Asaas rodando na porta " + port));
