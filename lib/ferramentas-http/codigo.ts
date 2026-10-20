/**
 * Ferramenta de CÓDIGO (migration 9003): o JavaScript que quem administra
 * escreveu, rodando com o que a IA mandou em `input`.
 *
 * ── Isolamento: QuickJS em WebAssembly ─────────────────────────────────────
 * O código roda num interpretador QuickJS compilado para WASM
 * (`quickjs-emscripten-core` + a variante singlefile, que embute o .wasm no JS
 * e dispensa arquivo vizinho no `.next/standalone`). É um motor JS SEPARADO do
 * Node: o código não enxerga `process`, `require`, `fetch`, arquivo, rede, env
 * nem segredo — esses objetos não existem lá dentro, nada é exposto do host.
 * A memória é a do heap WASM com teto (`MEMORIA_MAXIMA`), e o tempo é cortado
 * pelo interrupt handler (`TEMPO_MAXIMO_MS`). Recusado: `node:vm` (a própria
 * documentação do Node diz que não é mecanismo de segurança) e `isolated-vm`
 * (módulo nativo, compila por arquitetura e quebra a imagem arm64/amd64).
 *
 * ── Contrato ────────────────────────────────────────────────────────────────
 * O corpo é o de uma função: lê `input` (os parâmetros já validados pelo mesmo
 * schema das ferramentas HTTP) e devolve com `return`. Só DADO sai: o valor de
 * retorno passa por `JSON.stringify` DENTRO do QuickJS, e o que cruza para o
 * Node é texto. Sem rede e sem efeito, a ferramenta de código é sempre consulta.
 */
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from "quickjs-emscripten-core";
import variante from "@jitl/quickjs-singlefile-cjs-release-sync";

import { validarArgumentos, type Parametro } from "./schema";
import type { ResultadoDaExecucao } from "./executar";

export const TEMPO_MAXIMO_MS = 2_000;
export const MEMORIA_MAXIMA = 16 * 1024 * 1024;
export const PILHA_MAXIMA = 512 * 1024;
export const MAX_BYTES_DO_RETORNO = 64 * 1024;

let modulo: Promise<QuickJSWASMModule> | null = null;
function carregarModulo(): Promise<QuickJSWASMModule> {
  modulo ??= newQuickJSWASMModuleFromVariant(variante);
  return modulo;
}

/** Monta o programa: `input` entra como literal JSON, o retorno sai como texto JSON. */
function programa(codigo: string, args: Record<string, unknown>): string {
  const literal = JSON.stringify(JSON.stringify(args));
  return `(function () {
  "use strict";
  const resultado = (function (input) {
${codigo}
  })(JSON.parse(${literal}));
  return resultado === undefined ? undefined : JSON.stringify(resultado);
})()`;
}

/** Mensagem curta do erro do código, sem pilha do host. */
function mensagemDoErro(erro: unknown): string {
  if (erro && typeof erro === "object") {
    const e = erro as { name?: unknown; message?: unknown };
    const nome = typeof e.name === "string" ? e.name : "Error";
    const msg = typeof e.message === "string" ? e.message : "";
    return `${nome}: ${msg}`.slice(0, 300);
  }
  return String(erro).slice(0, 300);
}

export async function executarCodigo(
  cadastro: { code: string | null; parameters: readonly Parametro[]; timeout_ms: number },
  argsBrutos: unknown,
  agora: () => number = Date.now,
): Promise<ResultadoDaExecucao> {
  const inicio = agora();
  const duracao = () => Math.max(0, Math.round(agora() - inicio));
  const base = { tentativas: 1 } as const;

  const validacao = validarArgumentos(cadastro.parameters, argsBrutos);
  if (!validacao.ok) {
    return { ...base, status: "parametros_invalidos", ok: false, duracaoMs: duracao(), erro: "parametros_invalidos", problemas: validacao.problemas };
  }
  if (!cadastro.code?.trim()) {
    return { ...base, status: "erro_codigo", ok: false, duracaoMs: duracao(), erro: "sem_codigo" };
  }

  const qjs = await carregarModulo();
  const runtime = qjs.newRuntime();
  runtime.setMemoryLimit(MEMORIA_MAXIMA);
  runtime.setMaxStackSize(PILHA_MAXIMA);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + Math.min(cadastro.timeout_ms, TEMPO_MAXIMO_MS)));
  const vm = runtime.newContext();
  try {
    const r = vm.evalCode(programa(cadastro.code, validacao.args), "ferramenta.js");
    if (r.error) {
      const erro = vm.dump(r.error) as unknown;
      r.error.dispose();
      const texto = mensagemDoErro(erro);
      // O interrupt handler lança "interrupted": é o tempo que acabou, não erro do código.
      if (/interrupted/i.test(texto)) {
        return { ...base, status: "timeout", ok: false, duracaoMs: duracao(), erro: "timeout" };
      }
      return { ...base, status: "erro_codigo", ok: false, duracaoMs: duracao(), erro: "erro_codigo", problemas: [texto] };
    }
    const tipo = vm.typeof(r.value);
    const texto = tipo === "string" ? vm.getString(r.value) : undefined;
    r.value.dispose();
    if (texto === undefined) return { ...base, status: "sucesso", ok: true, vazia: true, duracaoMs: duracao() };
    const bytes = Buffer.byteLength(texto, "utf8");
    if (bytes > MAX_BYTES_DO_RETORNO) {
      return { ...base, status: "resposta_invalida", ok: false, duracaoMs: duracao(), bytes, erro: "retorno_grande_demais" };
    }
    return { ...base, status: "sucesso", ok: true, dados: JSON.parse(texto) as unknown, bytes, duracaoMs: duracao() };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
