/**
 * O segredo da ferramenta HTTP cifrado — o miolo, sem HTTP nem banco.
 *
 * Mesmo caminho das chaves de IA e do servidor MCP externo
 * (`lib/mcp/servidor-externo/segredo.ts`): `encryptKey` com `AI_CRED_AES_KEY`,
 * colunas `secret_encrypted/_iv/_tag` + `secret_last4`. O plaintext só existe no
 * escopo da chamada; a tela vê o `last4`, e `authenticated` nem tem SELECT nas
 * colunas cifradas (migration 9002).
 *
 * Basic guarda `usuario:senha` num campo só — é o que o cabeçalho codifica.
 */
import { bufToBytea, byteaToBuffer, decryptKey, encryptKey } from "@/lib/crypto/aes_gcm";

export interface SegredoCifrado {
  secret_encrypted: string;
  secret_iv: string;
  secret_tag: string;
  secret_last4: string;
}

/** O que a leitura devolve: as colunas como vieram do banco, ou `null`. */
export type ColunasDoSegredo = Partial<Record<keyof SegredoCifrado, unknown>> | null | undefined;

/** Colunas que apagam o segredo (troca para "sem autenticação"). `NULL`, nunca string vazia. */
export const SEGREDO_APAGADO = {
  secret_encrypted: null,
  secret_iv: null,
  secret_tag: null,
  secret_last4: null,
} as const;

export function cifrarSegredo(segredo: string): SegredoCifrado {
  const cifrado = encryptKey(segredo);
  return {
    secret_encrypted: bufToBytea(cifrado.ciphertext),
    secret_iv: bufToBytea(cifrado.iv),
    secret_tag: bufToBytea(cifrado.tag),
    secret_last4: cifrado.last4,
  };
}

/**
 * Colunas → plaintext, ou `null` quando não há segredo gravado ou a cifra não
 * abre (chave da instalação trocada, coluna corrompida). Quem chama transforma
 * `null` numa ferramenta que não sai — nunca numa chamada sem autenticação.
 */
export function abrirSegredo(colunas: ColunasDoSegredo): string | null {
  const { secret_encrypted, secret_iv, secret_tag } = colunas ?? {};
  if (
    typeof secret_encrypted !== "string" ||
    typeof secret_iv !== "string" ||
    typeof secret_tag !== "string"
  ) {
    return null;
  }
  try {
    return decryptKey({
      ciphertext: byteaToBuffer(secret_encrypted),
      iv: byteaToBuffer(secret_iv),
      tag: byteaToBuffer(secret_tag),
    });
  } catch {
    return null;
  }
}
