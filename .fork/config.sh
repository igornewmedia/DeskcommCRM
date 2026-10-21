#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Configuração do fork — o ÚNICO arquivo da automação com dados próprios.
# Os scripts (.fork/*.sh) e os workflows (fork-*.yml) leem tudo daqui.
# Ver FORK.md, seção "A configuração do fork".
# ═══════════════════════════════════════════════════════════════════════════

# ── Da sua conta ────────────────────────────────────────────────────────────
# O repositório ORIGINAL que este fork acompanha: dono/nome, como aparece na
# URL do GitHub (github.com/DONO/NOME).
UPSTREAM_REPO="${UPSTREAM_REPO:-melgarafael/DeskcommCRM}"

# ESTE fork: dono/nome. Dentro do Actions o GitHub informa sozinho
# (GITHUB_REPOSITORY); este valor é o padrão quando o script roda fora dele.
FORK_REPO="${GITHUB_REPOSITORY:-igornewmedia/DeskcommCRM}"

# ── Do projeto (só mudam se o original for OUTRO projeto) ───────────────────
# Comando que atualiza a VPS, citado na tarefa e nas notas da release.
COMANDO_ATUALIZAR_VPS="bash hostgator-setup-kit/update.sh"
# Workflow do original que constrói e publica as imagens Docker num push de tag.
WORKFLOW_IMAGENS="publish-image.yml"
# Nome da imagem principal no GHCR (aparece nas notas da release).
IMAGEM_PRINCIPAL="deskcommcrm"
# Onde ficam as migrations (para avisar colisão de número) e o baseline.
PASTA_MIGRATIONS="supabase/migrations"
ARQ_BASELINE="supabase/baseline.sql"
