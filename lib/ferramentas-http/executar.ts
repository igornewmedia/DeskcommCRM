/**
 * Executa UMA chamada de ferramenta HTTP: valida, monta, sai pela porta
 * anti-SSRF, lê com teto e classifica. Não toca em banco — quem chama grava o
 * histórico com o resultado (o turno, a rota do botão Testar).
 *
 * ── A saída é sempre `fetchDeSaida` ─────────────────────────────────────────
 * O mesmo guard do servidor MCP externo e dos webhooks de saída: esquema e
 * literal privado (`assertSafeOutboundUrl`), DNS resolvido sem faixa especial
 * — localhost, rede interna e 169.254.169.254 dos metadados de nuvem —
 * (`assertDestinoResolvidoSeguro`) e `redirect: "manual"` com o host fixado no
 * cadastrado. Um 3xx para o MESMO host não é seguido: vira `erro_http`.
 *
 * ── Retentativa só quando repetir é seguro ─────────────────────────────────
 * GET, PUT e DELETE são idempotentes pelo protocolo; POST e PATCH só com
 * `safe_to_retry` marcado por quem administra, e aí vão com `Idempotency-Key`
 * fixo entre as tentativas. Só falha de conexão, 429, 502, 503 e 504 repetem —
 * timeout não (triplicaria a espera do cliente no WhatsApp), bloqueio nunca.
 *
 * ── Nada de segredo no resultado ────────────────────────────────────────────
 * `requisicao` é a versão `paraExibir` (credencial mascarada). O plaintext
 * existe só dentro de `montarRequisicao` e do `fetch`.
 */
import { randomUUID } from "node:crypto";

import { EgressBlockedError } from "@/lib/agent-engine/edge/egress";
import { fetchDeSaida, type GuardaDeSaida } from "@/lib/mcp/servidor-externo/chamada";

import { executarCodigo } from "./codigo";
import { montarRequisicao, RequisicaoInvalidaError, type CadastroDaRequisicao } from "./montar-requisicao";
import { CAMINHO_DE_RESPOSTA, type FerramentaHttp, type Parametro, validarArgumentos } from "./schema";
import type { StatusDaExecucao } from "./vocabulario";

/** Teto do que se lê do corpo; o resto é descartado sem ler. */
export const MAX_BYTES_DA_RESPOSTA = 256 * 1024;
export const MAX_TENTATIVAS = 3;
const STATUS_QUE_REPETEM = new Set([429, 502, 503, 504]);
const ESPERAS_MS = [500, 1_500];

export type CadastroExecutavel = CadastroDaRequisicao &
  Pick<FerramentaHttp, "safe_to_retry" | "timeout_ms" | "response_map" | "kind" | "code"> & {
    parameters: readonly Parametro[];
  };

export interface ResultadoDaExecucao {
  status: StatusDaExecucao;
  ok: boolean;
  httpStatus?: number;
  duracaoMs: number;
  tentativas: number;
  /** Corpo interpretado (JSON, ou texto) — já mapeado quando há `response_map`. */
  dados?: unknown;
  /** 2xx sem corpo: a chamada deu certo e não há dado nenhum para contar ao cliente. */
  vazia?: boolean;
  truncada?: boolean;
  bytes?: number;
  /** Código curto, sem dado do cliente nem segredo — vai para o histórico. */
  erro?: string;
  /** Problemas de validação dos argumentos (só em `parametros_invalidos`). */
  problemas?: string[];
  requisicao?: RequisicaoMontada["paraExibir"];
}

type RequisicaoMontada = ReturnType<typeof montarRequisicao>;

export interface OpcoesDeExecucao {
  /** Plaintext da credencial, aberto por quem chama (`abrirSegredo`). */
  segredo: string | null;
  /** JUNTA DE TESTE: em produção fica ausente e vale o guard padrão. */
  guarda?: GuardaDeSaida;
  /** Espera entre tentativas (teste injeta uma que não espera). */
  esperar?: (ms: number) => Promise<void>;
  agora?: () => number;
}

function podeRepetir(cadastro: CadastroExecutavel): boolean {
  return ["GET", "PUT", "DELETE"].includes(cadastro.method) || cadastro.safe_to_retry;
}

function ehTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

function ehBloqueio(e: unknown): boolean {
  return (
    e instanceof EgressBlockedError ||
    (e instanceof Error && e.message.startsWith("unsafe_url:"))
  );
}

/** Código do bloqueio sem host nem URL: `unsafe_url:private_ip`, `egress_blocked`. */
function codigoDoBloqueio(e: unknown): string {
  if (e instanceof EgressBlockedError) return "egress_blocked";
  return (e as Error).message.split(" ")[0] as string;
}

async function lerComTeto(res: Response): Promise<{ bytes: Uint8Array; truncada: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncada: false };
  const leitor = res.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  let truncada = false;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    const falta = MAX_BYTES_DA_RESPOSTA - total;
    if (value.byteLength > falta) {
      pedacos.push(value.subarray(0, falta));
      total += falta;
      truncada = true;
      await leitor.cancel().catch(() => undefined);
      break;
    }
    pedacos.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    bytes.set(p, pos);
    pos += p.byteLength;
  }
  return { bytes, truncada };
}

/** `$.a.itens[0].nome` → valor, ou `null` quando o caminho não existe. */
export function lerCaminho(raiz: unknown, caminho: string): unknown {
  if (!CAMINHO_DE_RESPOSTA.test(caminho)) return null;
  let atual: unknown = raiz;
  for (const [, chave, indice] of caminho.slice(1).matchAll(/\.([^.[]+)|\[(\d+)\]/g)) {
    if (atual === null || typeof atual !== "object") return null;
    atual =
      indice !== undefined
        ? Array.isArray(atual)
          ? atual[Number(indice)]
          : undefined
        : (atual as Record<string, unknown>)[chave as string];
    if (atual === undefined) return null;
  }
  return atual;
}

function mapear(dados: unknown, mapa: Record<string, string> | null): unknown {
  if (!mapa || Object.keys(mapa).length === 0) return dados;
  return Object.fromEntries(Object.entries(mapa).map(([campo, c]) => [campo, lerCaminho(dados, c)]));
}

function interpretar(
  res: Response,
  bytes: Uint8Array,
  truncada: boolean,
): Pick<ResultadoDaExecucao, "dados" | "vazia" | "erro"> & { invalida?: true } {
  if (bytes.byteLength === 0) return { vazia: true };
  const texto = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const tipo = (res.headers.get("content-type") ?? "").toLowerCase();
  const pareceJson = tipo.includes("json") || /^\s*[[{]/.test(texto);
  if (pareceJson) {
    try {
      return { dados: JSON.parse(texto) };
    } catch {
      // JSON cortado no teto não é JSON inválido do servidor — mas também não é dado.
      return { invalida: true, erro: truncada ? "json_truncado" : "json_invalido" };
    }
  }
  if (tipo === "" || tipo.startsWith("text/")) return { dados: texto };
  return { invalida: true, erro: "tipo_nao_suportado" };
}

export async function executarFerramentaHttp(
  cadastro: CadastroExecutavel,
  argsBrutos: unknown,
  opcoes: OpcoesDeExecucao,
): Promise<ResultadoDaExecucao> {
  // Ferramenta de código (9003): não sai para a rede, roda isolada aqui mesmo.
  if (cadastro.kind === "codigo") return executarCodigo(cadastro, argsBrutos, opcoes.agora);
  const agora = opcoes.agora ?? Date.now;
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const inicio = agora();
  const duracao = () => Math.max(0, Math.round(agora() - inicio));

  const validacao = validarArgumentos(cadastro.parameters, argsBrutos);
  if (!validacao.ok) {
    return {
      status: "parametros_invalidos",
      ok: false,
      duracaoMs: duracao(),
      tentativas: 1,
      erro: "parametros_invalidos",
      problemas: validacao.problemas,
    };
  }

  let req: RequisicaoMontada;
  try {
    req = montarRequisicao(cadastro, validacao.args, opcoes.segredo);
  } catch (e) {
    if (e instanceof RequisicaoInvalidaError) {
      return {
        status: "parametros_invalidos",
        ok: false,
        duracaoMs: duracao(),
        tentativas: 1,
        erro: "requisicao_invalida",
        problemas: [e.message],
      };
    }
    throw e;
  }

  const repete = podeRepetir(cadastro);
  const headers = { ...req.headers };
  if (repete && (cadastro.method === "POST" || cadastro.method === "PATCH")) {
    headers["Idempotency-Key"] = randomUUID();
  }
  const saida = fetchDeSaida(req.url, opcoes.guarda);
  const base = { duracaoMs: 0, requisicao: req.paraExibir };

  let tentativas = 0;
  for (;;) {
    tentativas += 1;
    const ultima = !repete || tentativas >= MAX_TENTATIVAS;
    let res: Response;
    try {
      res = (await saida(req.url, {
        method: req.method,
        headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: AbortSignal.timeout(cadastro.timeout_ms),
      })) as Response;
    } catch (e) {
      if (ehBloqueio(e)) {
        return { ...base, status: "bloqueado", ok: false, tentativas, duracaoMs: duracao(), erro: codigoDoBloqueio(e) };
      }
      if (ehTimeout(e)) {
        return { ...base, status: "timeout", ok: false, tentativas, duracaoMs: duracao(), erro: "timeout" };
      }
      if (!ultima) {
        await esperar(ESPERAS_MS[tentativas - 1] ?? 1_500);
        continue;
      }
      return { ...base, status: "falha_conexao", ok: false, tentativas, duracaoMs: duracao(), erro: "falha_conexao" };
    }

    if (!res.ok && STATUS_QUE_REPETEM.has(res.status) && !ultima) {
      await res.body?.cancel().catch(() => undefined);
      await esperar(ESPERAS_MS[tentativas - 1] ?? 1_500);
      continue;
    }

    let lido: { bytes: Uint8Array; truncada: boolean };
    try {
      lido = await lerComTeto(res);
    } catch (e) {
      const status: StatusDaExecucao = ehTimeout(e) ? "timeout" : "falha_conexao";
      return { ...base, status, ok: false, tentativas, httpStatus: res.status, duracaoMs: duracao(), erro: status };
    }
    const comum = {
      ...base,
      tentativas,
      httpStatus: res.status,
      bytes: lido.bytes.byteLength,
      ...(lido.truncada ? { truncada: true } : {}),
    };

    if (res.status >= 300) {
      const corpo = interpretar(res, lido.bytes, lido.truncada);
      return {
        ...comum,
        status: "erro_http",
        ok: false,
        duracaoMs: duracao(),
        erro: res.status < 400 ? "redirect_nao_seguido" : `http_${res.status}`,
        ...(corpo.dados !== undefined ? { dados: corpo.dados } : {}),
      };
    }

    const corpo = interpretar(res, lido.bytes, lido.truncada);
    if (corpo.invalida) {
      return { ...comum, status: "resposta_invalida", ok: false, duracaoMs: duracao(), erro: corpo.erro as string };
    }
    if (corpo.vazia) return { ...comum, status: "sucesso", ok: true, vazia: true, duracaoMs: duracao() };
    return {
      ...comum,
      status: "sucesso",
      ok: true,
      dados: mapear(corpo.dados, cadastro.response_map),
      duracaoMs: duracao(),
    };
  }
}
