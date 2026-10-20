"use client";
/**
 * Criar e editar uma ferramenta HTTP — na gaveta lateral, porque o cadastro é
 * longo e quem edita precisa ver o agente atrás.
 *
 * A validação que vale é a do servidor (`ferramentaHttpSchema`): a gaveta só
 * monta o corpo e mostra o que voltou. A credencial é um campo que SÓ ENTRA:
 * em branco na edição mantém a gravada, e a tela nunca a recebe de volta.
 *
 * O estado nasce das props uma vez: quem abre passa uma `key` nova a cada
 * abertura, e o componente remonta limpo.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ferramentasHttpQueryKey, type FerramentaHttpRow } from "@/hooks/ai/useFerramentasHttp";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { TIPOS_DE_PARAMETRO, type Parametro } from "@/lib/ferramentas-http/schema";
import { METODOS_HTTP, type MetodoHttp, type TipoDeAutenticacao } from "@/lib/ferramentas-http/vocabulario";

type Par = { chave: string; valor: string };

interface Estado {
  name: string;
  slug: string;
  slugEditado: boolean;
  description: string;
  is_active: boolean;
  method: MetodoHttp;
  url: string;
  headers: Par[];
  query: Par[];
  body: string;
  parameters: Parametro[];
  auth_type: TipoDeAutenticacao;
  auth_header_name: string;
  secret: string;
  effect: "consulta" | "acao";
  requires_confirmation: boolean;
  safe_to_retry: boolean;
  timeout_s: string;
  response_map: Par[];
  response_instructions: string;
}

function paraPares(o: Record<string, string> | null | undefined): Par[] {
  return Object.entries(o ?? {}).map(([chave, valor]) => ({ chave, valor }));
}

function deParesParaObjeto(pares: Par[]): Record<string, string> {
  return Object.fromEntries(pares.filter((p) => p.chave.trim()).map((p) => [p.chave.trim(), p.valor]));
}

/** "Consultar horários" → "consultar_horarios" */
export function slugDoNome(nome: string): string {
  const s = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z]/.test(s) ? s : `f_${s}`.slice(0, 64);
}

function estadoInicial(f: FerramentaHttpRow | null): Estado {
  return {
    name: f?.name ?? "",
    slug: f?.slug ?? "",
    slugEditado: Boolean(f),
    description: f?.description ?? "",
    is_active: f?.is_active ?? true,
    method: f?.method ?? "POST",
    url: f?.url ?? "",
    headers: paraPares(f?.headers),
    query: paraPares(f?.query),
    body: f?.body_template == null ? "" : JSON.stringify(f.body_template, null, 2),
    parameters: f?.parameters ?? [],
    auth_type: f?.auth_type ?? "none",
    auth_header_name: f?.auth_header_name ?? "",
    secret: "",
    effect: f?.effect ?? "consulta",
    requires_confirmation: f?.requires_confirmation ?? false,
    safe_to_retry: f?.safe_to_retry ?? false,
    timeout_s: String((f?.timeout_ms ?? 10_000) / 1000),
    response_map: paraPares(f?.response_map),
    response_instructions: f?.response_instructions ?? "",
  };
}

function ListaDePares(props: {
  rotulo: string;
  pares: Par[];
  onChange: (p: Par[]) => void;
  placeholderChave: string;
  placeholderValor: string;
}) {
  const t = useT();
  const { pares, onChange } = props;
  return (
    <div className="space-y-2">
      <Label>{props.rotulo}</Label>
      {pares.map((p, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`${props.rotulo} ${i + 1}`}
            value={p.chave}
            placeholder={props.placeholderChave}
            onChange={(e) => onChange(pares.map((x, j) => (j === i ? { ...x, chave: e.target.value } : x)))}
          />
          <Input
            aria-label={`${props.rotulo} ${i + 1} ${t("valor")}`}
            value={p.valor}
            placeholder={props.placeholderValor}
            onChange={(e) => onChange(pares.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(pares.filter((_, j) => j !== i))}>
            {t("Remover")}
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...pares, { chave: "", valor: "" }])}>
        {t("Adicionar")}
      </Button>
    </div>
  );
}

const ROTULO_DO_TIPO: Record<(typeof TIPOS_DE_PARAMETRO)[number], string> = {
  string: "Texto",
  number: "Número",
  integer: "Número inteiro",
  boolean: "Sim ou não",
  enum: "Lista de opções",
};

function EditorDeParametros(props: { parametros: Parametro[]; onChange: (p: Parametro[]) => void }) {
  const t = useT();
  const { parametros, onChange } = props;
  const mudar = (i: number, p: Partial<Parametro>) =>
    onChange(parametros.map((x, j) => (j === i ? ({ ...x, ...p } as Parametro) : x)));
  return (
    <div className="space-y-3">
      <div>
        <Label>{t("Parâmetros que a IA preenche")}</Label>
        <p className="text-xs text-muted-foreground">
          {t("Use {{nome}} na URL, nos parâmetros de URL, nos cabeçalhos ou no corpo para colocar o valor.")}
        </p>
      </div>
      {parametros.map((p, i) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-44"
              aria-label={t("Nome do parâmetro")}
              placeholder="data"
              value={p.name}
              onChange={(e) => mudar(i, { name: e.target.value })}
            />
            <Select
              value={p.type}
              onValueChange={(v) =>
                mudar(i, {
                  type: v as Parametro["type"],
                  values: v === "enum" ? (p.values ?? [""]) : undefined,
                  format: v === "string" ? p.format : undefined,
                })
              }
            >
              <SelectTrigger className="w-44" aria-label={t("Tipo do parâmetro")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DE_PARAMETRO.map((tipo) => (
                  <SelectItem key={tipo} value={tipo}>
                    {t(ROTULO_DO_TIPO[tipo])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id={`obrigatorio-${i}`}
                checked={p.required}
                onCheckedChange={(v) => mudar(i, { required: v })}
              />
              <Label htmlFor={`obrigatorio-${i}`}>{t("Obrigatório")}</Label>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(parametros.filter((_, j) => j !== i))}>
              {t("Remover")}
            </Button>
          </div>
          <Input
            aria-label={t("Descrição do parâmetro")}
            placeholder={t("O que a IA deve colocar aqui (ex.: data no formato AAAA-MM-DD)")}
            value={p.description}
            onChange={(e) => mudar(i, { description: e.target.value })}
          />
          {p.type === "enum" ? (
            <Input
              aria-label={t("Opções, separadas por vírgula")}
              placeholder={t("Opções, separadas por vírgula")}
              value={(p.values ?? []).join(", ")}
              onChange={(e) => mudar(i, { values: e.target.value.split(",").map((v) => v.trim()) })}
            />
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...parametros, { name: "", type: "string", required: false, description: "" }])}
      >
        {t("Adicionar parâmetro")}
      </Button>
    </div>
  );
}

export function EditorDeFerramentaHttp(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ferramenta: FerramentaHttpRow | null;
  /** Chamado com a ferramenta salva (a criação devolve o id novo). */
  onSalva?: (f: FerramentaHttpRow) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [e, setE] = React.useState<Estado>(() => estadoInicial(props.ferramenta));
  const [salvando, setSalvando] = React.useState(false);
  const [erros, setErros] = React.useState<string[]>([]);

  const mudar = (p: Partial<Estado>) => setE((atual) => ({ ...atual, ...p }));
  const edicao = props.ferramenta !== null;

  async function salvar() {
    let body_template: unknown = null;
    if (e.method !== "GET" && e.body.trim()) {
      try {
        body_template = JSON.parse(e.body);
      } catch {
        setErros([t("O corpo não é um JSON válido.")]);
        return;
      }
    }
    const corpo = {
      name: e.name,
      slug: e.slug,
      description: e.description,
      is_active: e.is_active,
      method: e.method,
      url: e.url,
      headers: deParesParaObjeto(e.headers),
      query: deParesParaObjeto(e.query),
      body_template,
      parameters: e.parameters,
      auth_type: e.auth_type,
      auth_header_name: e.auth_type === "api_key" ? e.auth_header_name || null : null,
      effect: e.effect,
      requires_confirmation: e.effect === "acao" && e.requires_confirmation,
      safe_to_retry: e.safe_to_retry,
      timeout_ms: Math.round(Number(e.timeout_s.replace(",", ".")) * 1000),
      response_map: e.response_map.some((p) => p.chave.trim()) ? deParesParaObjeto(e.response_map) : null,
      response_instructions: e.response_instructions.trim() || null,
      ...(e.secret ? { secret: e.secret } : {}),
    };
    setSalvando(true);
    setErros([]);
    try {
      const res = edicao
        ? await apiClient.patch<{ data: FerramentaHttpRow }>(`/api/v1/ai/http-tools/${props.ferramenta!.id}`, corpo)
        : await apiClient.post<{ data: FerramentaHttpRow }>("/api/v1/ai/http-tools", corpo);
      await qc.invalidateQueries({ queryKey: ferramentasHttpQueryKey });
      toast.success(edicao ? t("Ferramenta salva.") : t("Ferramenta criada."));
      props.onSalva?.(res.data);
      props.onOpenChange(false);
    } catch (err) {
      const detalhes = (err as { details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } })
        .details;
      const lista = [
        ...(detalhes?.formErrors ?? []),
        ...Object.entries(detalhes?.fieldErrors ?? {}).flatMap(([campo, msgs]) => msgs.map((m) => `${campo}: ${m}`)),
      ];
      if (lista.length > 0) setErros(lista);
      showApiError(err);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{edicao ? t("Editar ferramenta") : t("Nova ferramenta")}</SheetTitle>
          <SheetDescription>
            {t("O agente chama este endereço durante a conversa quando precisar da informação ou da ação descrita.")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-4">
          <section className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ft-nome">{t("Nome")}</Label>
              <Input
                id="ft-nome"
                value={e.name}
                placeholder={t("Consultar horários")}
                onChange={(ev) =>
                  mudar({ name: ev.target.value, ...(e.slugEditado ? {} : { slug: slugDoNome(ev.target.value) }) })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ft-slug">{t("Identificador interno")}</Label>
              <Input
                id="ft-slug"
                className="font-mono"
                value={e.slug}
                onChange={(ev) => mudar({ slug: ev.target.value, slugEditado: true })}
              />
              <p className="text-xs text-muted-foreground">
                {t("É o nome que a IA vê. Letras minúsculas, números e _.")}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ft-descricao">{t("Descrição")}</Label>
              <Textarea
                id="ft-descricao"
                rows={3}
                value={e.description}
                placeholder={t("Diga à IA quando usar: ex.: consulta os horários livres de um procedimento numa data.")}
                onChange={(ev) => mudar({ description: ev.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="ft-ativa" checked={e.is_active} onCheckedChange={(v) => mudar({ is_active: v })} />
              <Label htmlFor="ft-ativa">{t("Ativa")}</Label>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-medium">{t("Requisição")}</h4>
            <div className="flex gap-2">
              <Select value={e.method} onValueChange={(v) => mudar({ method: v as MetodoHttp })}>
                <SelectTrigger className="w-28" aria-label={t("Método")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METODOS_HTTP.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="URL"
                className="font-mono"
                value={e.url}
                placeholder="https://"
                onChange={(ev) => mudar({ url: ev.target.value })}
              />
            </div>
            <ListaDePares
              rotulo={t("Parâmetros de URL")}
              pares={e.query}
              onChange={(query) => mudar({ query })}
              placeholderChave={t("nome")}
              placeholderValor="{{data}}"
            />
            <ListaDePares
              rotulo={t("Cabeçalhos")}
              pares={e.headers}
              onChange={(headers) => mudar({ headers })}
              placeholderChave="X-Origem"
              placeholderValor={t("valor")}
            />
            {e.method !== "GET" ? (
              <div className="space-y-1">
                <Label htmlFor="ft-corpo">{t("Corpo (JSON)")}</Label>
                <Textarea
                  id="ft-corpo"
                  rows={5}
                  className="font-mono text-xs"
                  value={e.body}
                  placeholder={'{ "data": "{{data}}" }'}
                  onChange={(ev) => mudar({ body: ev.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("Em branco, os parâmetros vão como JSON no corpo.")}
                </p>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="ft-timeout">{t("Tempo máximo de espera (segundos)")}</Label>
              <Input
                id="ft-timeout"
                className="w-28"
                inputMode="decimal"
                value={e.timeout_s}
                onChange={(ev) => mudar({ timeout_s: ev.target.value })}
              />
            </div>
          </section>

          <section className="space-y-3">
            <EditorDeParametros parametros={e.parameters} onChange={(parameters) => mudar({ parameters })} />
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-medium">{t("Autenticação")}</h4>
            <Select value={e.auth_type} onValueChange={(v) => mudar({ auth_type: v as TipoDeAutenticacao })}>
              <SelectTrigger className="w-56" aria-label={t("Autenticação")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("Nenhuma")}</SelectItem>
                <SelectItem value="api_key">API Key</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="basic">Basic</SelectItem>
              </SelectContent>
            </Select>
            {e.auth_type === "api_key" ? (
              <Input
                aria-label={t("Cabeçalho da API Key")}
                placeholder="X-Api-Key"
                value={e.auth_header_name}
                onChange={(ev) => mudar({ auth_header_name: ev.target.value })}
              />
            ) : null}
            {e.auth_type !== "none" ? (
              <div className="space-y-1">
                <Input
                  type="password"
                  autoComplete="new-password"
                  aria-label={t("Credencial")}
                  placeholder={e.auth_type === "basic" ? t("usuario:senha") : t("Credencial")}
                  value={e.secret}
                  onChange={(ev) => mudar({ secret: ev.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {props.ferramenta?.secret_last4
                    ? `${t("Guardada, termina em")} ${props.ferramenta.secret_last4}. ${t("Deixe em branco para manter.")}`
                    : t("Fica guardada criptografada e nunca mais aparece na tela.")}
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-medium">{t("Segurança")}</h4>
            <Select value={e.effect} onValueChange={(v) => mudar({ effect: v as Estado["effect"] })}>
              <SelectTrigger className="w-72" aria-label={t("O que a ferramenta faz")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consulta">{t("Só consulta informação")}</SelectItem>
                <SelectItem value="acao">{t("Executa uma ação (marca, cancela, altera)")}</SelectItem>
              </SelectContent>
            </Select>
            {e.effect === "acao" ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="ft-confirmar"
                  checked={e.requires_confirmation}
                  onCheckedChange={(v) => mudar({ requires_confirmation: v })}
                />
                <Label htmlFor="ft-confirmar">{t("Pedir confirmação do cliente antes de executar")}</Label>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Switch id="ft-repetir" checked={e.safe_to_retry} onCheckedChange={(v) => mudar({ safe_to_retry: v })} />
              <Label htmlFor="ft-repetir">{t("Pode repetir a chamada se a conexão falhar")}</Label>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-medium">{t("Resposta")}</h4>
            <ListaDePares
              rotulo={t("Campos que a IA recebe (opcional)")}
              pares={e.response_map}
              onChange={(response_map) => mudar({ response_map })}
              placeholderChave="horarios"
              placeholderValor="$.data.slots"
            />
            <div className="space-y-1">
              <Label htmlFor="ft-instrucoes">{t("Como a IA deve interpretar a resposta (opcional)")}</Label>
              <Textarea
                id="ft-instrucoes"
                rows={2}
                value={e.response_instructions}
                placeholder={t("Ex.: ofereça no máximo 3 horários.")}
                onChange={(ev) => mudar({ response_instructions: ev.target.value })}
              />
            </div>
          </section>

          {erros.length > 0 ? (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 p-3 text-xs text-destructive">
              {erros.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? t("Salvando…") : t("Salvar")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
