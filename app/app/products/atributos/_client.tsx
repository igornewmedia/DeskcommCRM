"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  LIMITE_DE_ATRIBUTOS,
  TIPOS_DE_ATRIBUTO,
  type AtributoDeProduto,
  type TipoDeAtributo,
} from "@/lib/schemas/atributos-de-produto";

const NOME_DO_TIPO: Record<TipoDeAtributo, string> = {
  texto: "Texto",
  numero: "Número",
  booleano: "Sim ou não",
  moeda: "Valor em dinheiro",
  lista: "Lista de opções",
};

interface Rascunho {
  id: string | null;
  chave: string;
  rotulo: string;
  tipo: TipoDeAtributo;
  descricao_ia: string;
  visivel_ia: boolean;
  pesquisavel: boolean;
  ordem: string;
  opcoes: string;
}

const VAZIO: Rascunho = {
  id: null,
  chave: "",
  rotulo: "",
  tipo: "texto",
  descricao_ia: "",
  visivel_ia: true,
  pesquisavel: false,
  ordem: "0",
  opcoes: "",
};

/** "Preço no cartão" → "preco_no_cartao": a chave sugerida enquanto a pessoa digita o nome. */
function chaveDoRotulo(rotulo: string): string {
  return rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);
}

export function AtributosClient(props: { inicial: AtributoDeProduto[]; podeEditar: boolean }) {
  const t = useT();
  const router = useRouter();
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  const [chaveEditada, setChaveEditada] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const cheio = props.inicial.length >= LIMITE_DE_ATRIBUTOS;

  async function salvar() {
    if (!rascunho) return;
    const opcoes = rascunho.opcoes
      .split(/[\n,]/)
      .map((o) => o.trim())
      .filter(Boolean);
    const comum = {
      rotulo: rascunho.rotulo.trim(),
      descricao_ia: rascunho.descricao_ia.trim() || null,
      visivel_ia: rascunho.visivel_ia,
      pesquisavel: rascunho.pesquisavel,
      ordem: Math.max(0, Math.trunc(Number(rascunho.ordem) || 0)),
      ...(rascunho.tipo === "lista" ? { opcoes } : {}),
    };
    setSalvando(true);
    try {
      if (rascunho.id) await apiClient.patch(`/api/v1/product-attributes/${rascunho.id}`, comum);
      else await apiClient.post("/api/v1/product-attributes", { ...comum, chave: rascunho.chave.trim(), tipo: rascunho.tipo });
      toast.success(t("Atributo salvo."));
      setRascunho(null);
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setSalvando(false);
    }
  }

  async function remover(a: AtributoDeProduto) {
    if (!window.confirm(t("Remover este atributo? O valor dele some de todos os produtos."))) return;
    try {
      await apiClient.delete(`/api/v1/product-attributes/${a.id}`);
      router.refresh();
    } catch (err) {
      showApiError(err);
    }
  }

  const editandoExistente = rascunho?.id != null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <a href="/app/products" className="text-sm underline">
          {t("Produtos")}
        </a>
        <h1 className="text-2xl font-semibold">{t("Atributos dos produtos")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Informações próprias da sua loja em cada produto, como pronta entrega, preço no cartão ou versão. Elas aparecem no cadastro do produto e o atendente de IA as lê ao consultar o catálogo.",
          )}
        </p>
      </header>

      {props.podeEditar && !rascunho ? (
        <Button
          className="mb-4"
          onClick={() => {
            setChaveEditada(false);
            setRascunho(VAZIO);
          }}
          disabled={cheio}
          data-testid="novo-atributo"
        >
          {cheio ? t("Limite de 30 atributos atingido") : t("Novo atributo")}
        </Button>
      ) : null}

      {rascunho ? (
        <div className="mb-6 rounded-lg border p-4" data-testid="form-atributo">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("Nome")}
              <input
                value={rascunho.rotulo}
                onChange={(e) =>
                  setRascunho({
                    ...rascunho,
                    rotulo: e.target.value,
                    ...(editandoExistente || chaveEditada ? {} : { chave: chaveDoRotulo(e.target.value) }),
                  })
                }
                placeholder={t("Pronta entrega")}
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="atributo-rotulo"
              />
            </label>
            <label className="text-sm">
              {t("Chave (usada pela API e pelos filtros da IA)")}
              <input
                value={rascunho.chave}
                onChange={(e) => {
                  setChaveEditada(true);
                  setRascunho({ ...rascunho, chave: e.target.value });
                }}
                disabled={editandoExistente}
                placeholder="pronta_entrega"
                className="mt-1 h-9 w-full rounded-md border px-3 font-mono"
                data-testid="atributo-chave"
              />
            </label>
            <label className="text-sm">
              {t("Tipo")}
              <select
                value={rascunho.tipo}
                onChange={(e) => setRascunho({ ...rascunho, tipo: e.target.value as TipoDeAtributo })}
                disabled={editandoExistente}
                className="mt-1 h-9 w-full rounded-md border bg-background px-3"
                data-testid="atributo-tipo"
              >
                {TIPOS_DE_ATRIBUTO.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {t(NOME_DO_TIPO[tipo])}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t("Ordem")}
              <input
                value={rascunho.ordem}
                onChange={(e) => setRascunho({ ...rascunho, ordem: e.target.value })}
                inputMode="numeric"
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="atributo-ordem"
              />
            </label>
            {rascunho.tipo === "lista" ? (
              <label className="text-sm sm:col-span-2">
                {t("Opções (uma por linha ou separadas por vírgula)")}
                <textarea
                  value={rascunho.opcoes}
                  onChange={(e) => setRascunho({ ...rascunho, opcoes: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  data-testid="atributo-opcoes"
                />
              </label>
            ) : null}
            <label className="text-sm sm:col-span-2">
              {t("O que significa, para a IA")} <span className="text-muted-foreground">{t("(opcional)")}</span>
              <textarea
                value={rascunho.descricao_ia}
                onChange={(e) => setRascunho({ ...rascunho, descricao_ia: e.target.value })}
                rows={2}
                maxLength={300}
                placeholder={t("Ex.: sim = produto em estoque em Brasília, pagamento na entrega")}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                data-testid="atributo-descricao"
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rascunho.visivel_ia}
              onChange={(e) => setRascunho({ ...rascunho, visivel_ia: e.target.checked })}
              data-testid="atributo-visivel"
            />
            {t("A IA vê este atributo ao consultar o catálogo")}
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rascunho.pesquisavel}
              onChange={(e) => setRascunho({ ...rascunho, pesquisavel: e.target.checked })}
              data-testid="atributo-pesquisavel"
            />
            {t("Entra na busca (o que o cliente escreve pode achar o produto por este valor)")}
          </label>
          <div className="mt-3 flex gap-2">
            <Button onClick={salvar} disabled={salvando} data-testid="salvar-atributo">
              {salvando ? t("Salvando…") : t("Salvar")}
            </Button>
            <Button variant="outline" onClick={() => setRascunho(null)}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : null}

      {props.inicial.length === 0 ? (
        <div className="rounded-lg border p-6 text-center">
          <p className="font-medium">{t("Nenhum atributo definido ainda")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Sem atributos, o cadastro do produto tem só os campos de sempre.")}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="lista-atributos">
          {props.inicial.map((a) => (
            <li key={a.id} className="flex items-center gap-4 p-3" data-testid="atributo">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {a.rotulo} <span className="font-mono text-xs text-muted-foreground">{a.chave}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t(NOME_DO_TIPO[a.tipo])}
                  {a.tipo === "lista" ? `: ${a.opcoes.join(", ")}` : ""}
                  {a.visivel_ia ? ` · ${t("a IA vê")}` : ` · ${t("oculto da IA")}`}
                  {a.pesquisavel ? ` · ${t("entra na busca")}` : ""}
                </p>
              </div>
              {props.podeEditar ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRascunho({
                        id: a.id,
                        chave: a.chave,
                        rotulo: a.rotulo,
                        tipo: a.tipo,
                        descricao_ia: a.descricao_ia ?? "",
                        visivel_ia: a.visivel_ia,
                        pesquisavel: a.pesquisavel,
                        ordem: String(a.ordem),
                        opcoes: a.opcoes.join("\n"),
                      })
                    }
                  >
                    {t("Editar")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remover(a)}>
                    {t("Remover")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
