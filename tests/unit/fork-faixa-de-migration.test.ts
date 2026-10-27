/**
 * A FAIXA DE MIGRATION DO FORK NÃO VOLTA PARA ONDE O ORIGINAL NUMERA.
 *
 * O fork reservava 9001+. Em 26/10/2026 o original pulou de 0807 para 9016 e
 * passou a numerar ali (máximo + 1), então a faixa antiga colide. O buraco
 * 0808–9015 o original não usa mais; o fork numera de 5001 em diante, no meio
 * dele. Regra em `FORK.md`.
 *
 * Limite: este teste não distingue uma migration do fork numerada 9022+ de uma
 * do original — quem pega esse caso é a sincronização (`.fork/sincronizar.sh`,
 * colisão de NNNN). Ele trava o buraco e o texto que ensina o número.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const DIR = join(RAIZ, "supabase", "migrations");

/** Já rodam em VPS: o número é a versão gravada no banco, não se renumera. */
const LEGADAS_DO_FORK = new Set(["9001", "9002", "9003", "9004"]);
/** Último NNNN do original antes do pulo, e o primeiro depois dele. */
const ORIGINAL_ANTES_DO_PULO = 807;
const ORIGINAL_DEPOIS_DO_PULO = 9016;
const INICIO_DA_FAIXA = 5001;

function numeros(): string[] {
  return readdirSync(DIR)
    .map((f) => /^[0-9]{14}_([0-9]{4})_/.exec(f)?.[1])
    .filter((n): n is string => n !== undefined);
}

describe("faixa de migration do fork", () => {
  it("no buraco que o original abandonou só há a faixa 5001+ e as quatro legadas", () => {
    const fora = numeros().filter((n) => {
      const v = Number(n);
      const noBuraco = v > ORIGINAL_ANTES_DO_PULO && v < ORIGINAL_DEPOIS_DO_PULO;
      const naFaixa = v >= INICIO_DA_FAIXA && v < 9000;
      return noBuraco && !naFaixa && !LEGADAS_DO_FORK.has(n);
    });
    expect(fora).toEqual([]);
  });

  it("o FORK.md ensina a faixa 5001, não a antiga 9001", () => {
    const fork = readFileSync(join(RAIZ, "FORK.md"), "utf-8");
    expect(fork).toContain("faixa 5001 em diante");
    expect(fork).not.toMatch(/faixa 9001 em diante/);
    expect(fork).not.toMatch(/grep -oE '_9\[0-9\]\{3\}_'/);
  });
});
