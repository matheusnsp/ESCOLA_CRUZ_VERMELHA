-- Assistente da secretaria: uso por mensagem (limites e custo), sem o texto da conversa.
CREATE TABLE "UsoAssistente" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,
    "tokensCache" INTEGER NOT NULL DEFAULT 0,
    "ferramentas" TEXT[],
    CONSTRAINT "UsoAssistente_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UsoAssistente_usuarioId_criadoEm_idx" ON "UsoAssistente"("usuarioId", "criadoEm");
ALTER TABLE "UsoAssistente" ADD CONSTRAINT "UsoAssistente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
