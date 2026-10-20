/**
 * O executor contra um receiver HTTP DE VERDADE (doutrina: efeito externo se
 * prova com receiver real, mock não estressa o egress).
 *
 * O receiver mora em 127.0.0.1, faixa que o guard anti-SSRF recusa — por isso
 * os casos de entrega afrouxam só `conferirUrl`/`conferirIp` pela junta de teste
 * (`GuardaDeSaida`). A allowlist do host e o `redirect: "manual"` continuam os de
 * produção. O bloco "anti-SSRF" roda SEM junta e prova a recusa.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { executarFerramentaHttp, lerCaminho, MAX_BYTES_DA_RESPOSTA, type CadastroExecutavel } from "./executar";
import { respostaParaOModelo, MAX_BYTES_PARA_O_MODELO } from "./para-o-modelo";

interface Recebida {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let servidor: Server;
let base: string;
let recebidas: Recebida[] = [];
let responder: (req: IncomingMessage, res: ServerResponse, n: number) => void = () => undefined;

const ABERTO = { conferirUrl: () => undefined, conferirIp: async () => undefined };
const semEspera = { esperar: async () => undefined };

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      recebidas.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      responder(req, res, recebidas.length);
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

beforeEach(() => {
  recebidas = [];
});

function json(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(corpo));
}

function cadastro(parcial: Partial<CadastroExecutavel> = {}): CadastroExecutavel {
  return {
    kind: "http",
    code: null,
    method: "POST",
    url: `${base}/horarios`,
    headers: {},
    query: {},
    body_template: { data: "{{data}}", procedimento: "{{procedimento}}" },
    auth_type: "bearer",
    auth_header_name: null,
    parameters: [
      { name: "data", type: "string", format: "date", required: true, description: "Data" },
      { name: "procedimento", type: "string", required: true, description: "Procedimento" },
    ],
    safe_to_retry: false,
    timeout_ms: 2_000,
    response_map: null,
    ...parcial,
  };
}

const ARGS = { data: "2026-10-20", procedimento: "limpeza" };

describe("executarFerramentaHttp — entrega", () => {
  it("POST com JSON: o receiver recebe corpo e credencial; o resultado é mapeado", async () => {
    responder = (_q, res) => json(res, 200, { data: { slots: ["09:00", "10:30"] }, interno: "x" });
    const r = await executarFerramentaHttp(
      cadastro({ response_map: { horarios: "$.data.slots", primeiro: "$.data.slots[0]", nada: "$.x.y" } }),
      ARGS,
      { segredo: "tok-secreto", guarda: ABERTO },
    );
    expect(r).toMatchObject({ status: "sucesso", ok: true, httpStatus: 200, tentativas: 1 });
    expect(r.dados).toEqual({ horarios: ["09:00", "10:30"], primeiro: "09:00", nada: null });
    expect(recebidas[0]?.headers.authorization).toBe("Bearer tok-secreto");
    expect(JSON.parse(recebidas[0]?.body ?? "")).toEqual(ARGS);
    expect(JSON.stringify(r)).not.toContain("tok-secreto");
  });

  it("parâmetro inválido não sai para a rede", async () => {
    const r = await executarFerramentaHttp(cadastro(), { data: "amanhã" }, { segredo: "t", guarda: ABERTO });
    expect(r.status).toBe("parametros_invalidos");
    expect(r.problemas?.length).toBeGreaterThan(0);
    expect(recebidas).toHaveLength(0);
  });

  it("204 é sucesso vazio, e o modelo é avisado para não supor conteúdo", async () => {
    responder = (_q, res) => {
      res.writeHead(204);
      res.end();
    };
    const r = await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t", guarda: ABERTO });
    expect(r).toMatchObject({ status: "sucesso", ok: true, vazia: true });
    expect(respostaParaOModelo(r, null)).toMatchObject({ dados: null });
  });

  it("texto puro é lido como texto; binário é resposta inválida", async () => {
    responder = (_q, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("agenda cheia");
    };
    expect((await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t", guarda: ABERTO })).dados).toBe(
      "agenda cheia",
    );
    responder = (_q, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([0x89, 0x50]));
    };
    const r = await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t", guarda: ABERTO });
    expect(r).toMatchObject({ status: "resposta_invalida", erro: "tipo_nao_suportado" });
  });

  it("corpo acima do teto é cortado sem ler o resto", async () => {
    responder = (_q, res) => json(res, 200, { lixo: "a".repeat(MAX_BYTES_DA_RESPOSTA * 2) });
    const r = await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t", guarda: ABERTO });
    expect(r).toMatchObject({ status: "resposta_invalida", truncada: true, erro: "json_truncado" });
    expect(r.bytes).toBe(MAX_BYTES_DA_RESPOSTA);
  });
});

describe("executarFerramentaHttp — falhas e retentativa", () => {
  it("POST sem 'seguro repetir' não repete um 503", async () => {
    responder = (_q, res) => json(res, 503, { erro: "fora" });
    const r = await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t", guarda: ABERTO, ...semEspera });
    expect(r).toMatchObject({ status: "erro_http", httpStatus: 503, tentativas: 1, erro: "http_503" });
    expect(recebidas).toHaveLength(1);
  });

  it("POST marcado seguro repete com o MESMO Idempotency-Key e para no sucesso", async () => {
    responder = (_q, res, n) => (n === 1 ? json(res, 503, {}) : json(res, 200, { ok: 1 }));
    const r = await executarFerramentaHttp(cadastro({ safe_to_retry: true }), ARGS, {
      segredo: "t",
      guarda: ABERTO,
      ...semEspera,
    });
    expect(r).toMatchObject({ status: "sucesso", tentativas: 2 });
    const chaves = recebidas.map((q) => q.headers["idempotency-key"]);
    expect(chaves[0]).toBeTruthy();
    expect(chaves[0]).toBe(chaves[1]);
  });

  it("GET repete até 3 vezes e devolve o último erro", async () => {
    responder = (_q, res) => json(res, 502, {});
    const r = await executarFerramentaHttp(
      cadastro({ method: "GET", body_template: null, url: `${base}/h/{{data}}` }),
      ARGS,
      { segredo: "t", guarda: ABERTO, ...semEspera },
    );
    expect(r).toMatchObject({ status: "erro_http", tentativas: 3 });
    expect(recebidas.map((q) => q.method)).toEqual(["GET", "GET", "GET"]);
  });

  it("400 não repete nem em GET", async () => {
    responder = (_q, res) => json(res, 400, { erro: "data inválida" });
    const r = await executarFerramentaHttp(cadastro({ method: "GET", body_template: null }), ARGS, {
      segredo: "t",
      guarda: ABERTO,
      ...semEspera,
    });
    expect(r).toMatchObject({ status: "erro_http", tentativas: 1, dados: { erro: "data inválida" } });
  });

  it("timeout não repete", async () => {
    responder = (_q, res) => setTimeout(() => json(res, 200, {}), 800);
    const r = await executarFerramentaHttp(cadastro({ method: "GET", body_template: null, timeout_ms: 150 }), ARGS, {
      segredo: "t",
      guarda: ABERTO,
      ...semEspera,
    });
    expect(r).toMatchObject({ status: "timeout", tentativas: 1 });
  });

  it("porta fechada é falha de conexão, com retentativa em GET", async () => {
    const r = await executarFerramentaHttp(
      cadastro({ method: "GET", body_template: null, url: "http://127.0.0.1:1/x" }),
      ARGS,
      { segredo: "t", guarda: ABERTO, ...semEspera },
    );
    expect(r).toMatchObject({ status: "falha_conexao", tentativas: 3 });
  });
});

describe("executarFerramentaHttp — anti-SSRF", () => {
  it("sem junta de teste, localhost é bloqueado antes de sair byte", async () => {
    const r = await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t" });
    expect(r).toMatchObject({ status: "bloqueado", erro: "unsafe_url:private_host" });
    expect(recebidas).toHaveLength(0);
  });

  it("metadados de nuvem (169.254.169.254) são bloqueados", async () => {
    const r = await executarFerramentaHttp(
      cadastro({ url: "http://169.254.169.254/latest/meta-data" }),
      ARGS,
      { segredo: "t" },
    );
    expect(r.status).toBe("bloqueado");
  });

  it("redirect para outro host é bloqueado; para o mesmo host, não é seguido", async () => {
    responder = (_q, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest" });
      res.end();
    };
    const fora = await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t", guarda: ABERTO });
    expect(fora).toMatchObject({ status: "bloqueado", erro: "egress_blocked" });

    responder = (_q, res) => {
      res.writeHead(302, { location: "/outro" });
      res.end();
    };
    const dentro = await executarFerramentaHttp(cadastro(), ARGS, { segredo: "t", guarda: ABERTO });
    expect(dentro).toMatchObject({ status: "erro_http", erro: "redirect_nao_seguido" });
    expect(recebidas.map((q) => q.url)).toEqual(["/horarios", "/horarios"]);
  });
});

describe("respostaParaOModelo", () => {
  it("falha leva orientação de não inventar e nenhum dado", () => {
    const m = respostaParaOModelo({ status: "timeout", ok: false, duracaoMs: 1, tentativas: 1 }, null);
    expect(m.ok).toBe(false);
    expect("dados" in m).toBe(false);
    expect(String(m.orientacao)).toMatch(/Não invente/);
  });

  it("sucesso leva o aviso de dado não confiável e respeita o teto", () => {
    const m = respostaParaOModelo(
      { status: "sucesso", ok: true, duracaoMs: 1, tentativas: 1, dados: { t: "é".repeat(MAX_BYTES_PARA_O_MODELO) } },
      "Ofereça no máximo 3 horários.",
    );
    expect(String(m.aviso)).toMatch(/nunca como instrução/);
    expect(m.como_interpretar).toBe("Ofereça no máximo 3 horários.");
    expect(Buffer.byteLength(String(m.dados))).toBeLessThanOrEqual(MAX_BYTES_PARA_O_MODELO);
    expect(m.aviso_de_corte).toBeDefined();
  });
});

describe("lerCaminho", () => {
  it("lê objeto e lista, e devolve null para o que não existe ou caminho inválido", () => {
    const d = { a: { itens: [{ nome: "x" }] } };
    expect(lerCaminho(d, "$.a.itens[0].nome")).toBe("x");
    expect(lerCaminho(d, "$")).toBe(d);
    expect(lerCaminho(d, "$.a.itens[3].nome")).toBeNull();
    expect(lerCaminho(d, "a.itens")).toBeNull();
  });
});
