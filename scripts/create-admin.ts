import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const name = String(process.env.ADMIN_NAME || "").trim();
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const confirmation = process.env.ADMIN_BOOTSTRAP_CONFIRM || "";

  if (confirmation !== "CREATE_FIRST_ADMIN") {
    throw new Error("Confirmação de criação ausente.");
  }

  if (!name || name.length > 120) {
    throw new Error("Nome inválido.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("E-mail inválido.");
  }

  if (
    password.length < 14 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error("A senha deve ter pelo menos 14 caracteres e até 72 bytes.");
  }

  await prisma.$transaction(async (tx) => {
    const adminCount = await tx.user.count({
      where: { role: Role.ADMIN }
    });

    if (adminCount > 0) {
      throw new Error("Já existe um administrador. Criação inicial bloqueada.");
    }

    const existingUser = await tx.user.findFirst({
      where: { email },
      select: { id: true }
    });

    if (existingUser) {
      throw new Error("Este e-mail já pertence a uma conta BORA. Nenhuma conta foi alterada.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: Role.ADMIN
      }
    });
  }, {
    isolationLevel: "Serializable"
  });

  console.log("Primeiro administrador criado com sucesso.");
}

main()
  .catch((error) => {
    console.error("Não foi possível criar o administrador:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
