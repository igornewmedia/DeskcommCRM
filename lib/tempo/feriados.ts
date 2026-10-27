import { z } from "zod";

import { feriadosNomeadosDoBrasilDoAno } from "@/lib/lgpd/holidays-br";
import { partesNoFuso } from "@/lib/agenda/fuso";

/**
 * FERIADOS NO BLOCO `## Agora` (fork) — por organização, em
 * `organizations.settings.feriados` (sem migration: settings é jsonb).
 *
 * Desligado por padrão: sem a chave, ou com `ligado: false`, o bloco não muda.
 * Ligado, diz se hoje é feriado (e qual) e qual é o próximo dia útil — segunda
 * a sexta, sem feriado —, para o agente que promete prazo ou entrega em dia útil.
 * Os nacionais são CALCULADOS por ano (`lib/lgpd/holidays-br.ts`, sem serviço
 * externo); os próprios da empresa vêm da lista que ela edita.
 */

export const CHAVE_DOS_FERIADOS = "feriados";

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD");

export const configDeFeriadosSchema = z.object({
  ligado: z.boolean().default(false),
  /** Inclui os feriados nacionais do Brasil, calculados por ano. */
  nacionais: z.boolean().default(true),
  proprios: z
    .array(z.object({ data: dataIso, nome: z.string().trim().min(1).max(80) }))
    .max(100)
    .default([]),
});

export type ConfigDeFeriados = z.infer<typeof configDeFeriadosSchema>;

export const FERIADOS_DESLIGADOS: ConfigDeFeriados = { ligado: false, nacionais: true, proprios: [] };

/** Lê de um `organizations.settings` já carregado. Lixo ou ausência = desligado. */
export function feriadosDasSettings(settings: unknown): ConfigDeFeriados {
  const bruto = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[CHAVE_DOS_FERIADOS] : null;
  const r = configDeFeriadosSchema.safeParse(bruto ?? {});
  return r.success ? r.data : FERIADOS_DESLIGADOS;
}

/** O feriado de uma data civil (`AAAA-MM-DD`), ou null. O próprio vence o nacional. */
export function feriadoDoDia(dataCivil: string, cfg: ConfigDeFeriados): string | null {
  const proprio = cfg.proprios.find((f) => f.data === dataCivil);
  if (proprio) return proprio.nome;
  if (!cfg.nacionais) return null;
  const ano = Number(dataCivil.slice(0, 4));
  return feriadosNomeadosDoBrasilDoAno(ano).find((f) => f.data === dataCivil)?.nome ?? null;
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const dois = (n: number) => String(n).padStart(2, "0");

/** Data civil + n dias, em UTC puro (data civil não tem horário de verão). */
function somarDias(ano: number, mes: number, dia: number, n: number) {
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return { iso: d.toISOString().slice(0, 10), dow: d.getUTCDay(), dia: d.getUTCDate(), mes: d.getUTCMonth() + 1, ano: d.getUTCFullYear() };
}

/**
 * As linhas que entram no `## Agora`. Vazio quando desligado — o bloco fica
 * exatamente como sempre foi.
 */
export function linhasDeFeriado(agora: Date, fuso: string, cfg: ConfigDeFeriados): string[] {
  if (!cfg.ligado) return [];
  const p = partesNoFuso(agora, fuso);
  const hoje = somarDias(p.ano, p.mes, p.dia, 0);
  const feriadoHoje = feriadoDoDia(hoje.iso, cfg);
  let proximo = somarDias(p.ano, p.mes, p.dia, 1);
  // shortcut: 30 dias bastam para achar um dia útil mesmo com recesso longo cadastrado.
  for (let n = 2; n <= 31 && (proximo.dow === 0 || proximo.dow === 6 || feriadoDoDia(proximo.iso, cfg)); n++) {
    proximo = somarDias(p.ano, p.mes, p.dia, n);
  }
  const amanha = somarDias(p.ano, p.mes, p.dia, 1);
  const feriadoAmanha = feriadoDoDia(amanha.iso, cfg);
  return [
    feriadoHoje ? `Hoje é feriado: ${feriadoHoje}.` : "Hoje não é feriado.",
    ...(feriadoAmanha ? [`Amanhã é feriado: ${feriadoAmanha}.`] : []),
    `Próximo dia útil (segunda a sexta, sem feriado): ${DIAS[proximo.dow]}, ${dois(proximo.dia)}/${dois(proximo.mes)}/${proximo.ano}.`,
  ];
}
