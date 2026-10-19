#!/usr/bin/env bash
# Funções compartilhadas pela automação do fork (igornewmedia/DeskcommCRM).
#
# Tudo que é DESTE fork mora em `.fork/` e em `.github/workflows/fork-*.yml`:
# arquivos que o projeto original nunca toca, então nunca entram em conflito
# quando a versão nova chega. Ver FORK.md.

set -euo pipefail
# `comm` e `sort` precisam concordar na ordem; o locale do runner não é garantido.
export LC_ALL=C

UPSTREAM_REPO="${UPSTREAM_REPO:-melgarafael/DeskcommCRM}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/${UPSTREAM_REPO}.git}"
ARQ_VERSAO=".fork/versao-original"

# As tags do original ficam num espaço próprio (refs/upstream-tags/*), NUNCA em
# refs/tags/*. O fork publica as próprias tags com os mesmos números; misturar
# os dois faria `v1.86.0` significar duas coisas diferentes no mesmo repositório.
buscar_original() {
  git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
  git fetch --quiet --no-tags upstream \
    "+refs/heads/main:refs/remotes/upstream/main" \
    "+refs/tags/*:refs/upstream-tags/*"
}

versao_incorporada() {
  tr -d '[:space:]' < "$ARQ_VERSAO"
}

# A última versão LANÇADA do original — a mesma pergunta que o update.sh faz
# (releases/latest), e não a maior tag: tag sem release não é versão estável.
ultima_versao_original() {
  local tag=""
  if command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}" ]; then
    tag="$(gh api "repos/${UPSTREAM_REPO}/releases/latest" --jq .tag_name 2>/dev/null || true)"
  fi
  # Sem API (ou resposta que não é versão): a maior tag do original.
  if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    tag="$(git for-each-ref --format='%(refname:strip=2)' 'refs/upstream-tags/v*' \
      | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
  fi
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versão inválida do original: '$tag'" >&2; return 1; }
  printf '%s\n' "$tag"
}

# Versões do original lançadas depois de $1 até $2, inclusive (ordem crescente).
versoes_entre() {
  local de="$1" ate="$2"
  git for-each-ref --format='%(refname:strip=2)' 'refs/upstream-tags/v*' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V \
    | awk -v de="$de" -v ate="$ate" '
        $0 == de { passou = 1; next }
        passou && !feito { print }
        $0 == ate { feito = 1 }'
}

# Trecho do CHANGELOG do original entre duas versões (exclusive $1, inclusive $2).
changelog_entre() {
  local de="${1#v}" ate="${2#v}"
  git show "refs/upstream-tags/v${ate}:CHANGELOG.md" | awk -v de="$de" -v ate="$ate" '
    /^## \[/ {
      if (index($0, "## [" ate "]") == 1) { dentro = 1 }
      else if (index($0, "## [" de "]") == 1) { dentro = 0; fim = 1 }
    }
    dentro && !fim { print }'
}

# Arquivos que o FORK mudou por conta própria: commits do fork que não existem
# em nenhum ponto do original. Merges de sincronização ficam de fora (o conteúdo
# deles é do original). `.fork/` e os workflows do fork também: o original nunca
# os toca, então não há como colidirem.
arquivos_do_fork() {
  local ref="${1:-HEAD}"
  # shellcheck disable=SC2046
  git log --no-merges --format= --name-only "$ref" \
    --not refs/remotes/upstream/main $(git for-each-ref --format='%(refname)' 'refs/upstream-tags/') \
    | grep -v -E '^(\.fork/|\.github/workflows/fork-|FORK\.md$)' | grep . | sort -u || true
}

# Commits do original que estão em $1 mas ainda NÃO saíram em versão lançada
# (estão na main do original, depois da tag $2). Publicar com eles dentro
# entregaria código que o original ainda não lançou.
commits_nao_lancados() {
  local ref="$1" tag="$2"
  comm -12 \
    <(git rev-list "$ref" --not "refs/upstream-tags/${tag}" | sort) \
    <(git rev-list refs/remotes/upstream/main --not "refs/upstream-tags/${tag}" | sort)
}

# Próximo número livre para uma tag DESTE fork: a própria versão do original,
# ou o patch seguinte quando ela já foi usada (correção publicada pelo fork
# entre duas versões do original).
proxima_tag_livre() {
  local v="${1#v}" maj min pat
  IFS=. read -r maj min pat <<< "$v"
  while git rev-parse -q --verify "refs/tags/v${maj}.${min}.${pat}" >/dev/null \
     || git ls-remote --exit-code --tags origin "refs/tags/v${maj}.${min}.${pat}" >/dev/null 2>&1; do
    pat=$((pat + 1))
  done
  printf 'v%s.%s.%s\n' "$maj" "$min" "$pat"
}

configurar_autor_bot() {
  git config user.name  "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}
