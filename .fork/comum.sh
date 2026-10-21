#!/usr/bin/env bash
# Funções compartilhadas pela automação do fork. Os dados próprios (repositório
# original, este fork, comandos do projeto) moram em .fork/config.sh.
#
# Tudo que é DESTE fork mora em `.fork/` e em `.github/workflows/fork-*.yml`:
# arquivos que o projeto original nunca toca, então nunca entram em conflito
# quando a versão nova chega. Ver FORK.md.

set -euo pipefail
# `comm` e `sort` precisam concordar na ordem; o locale do runner não é garantido.
export LC_ALL=C

# shellcheck source=config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

# Valor de exemplo esquecido: parar aqui, com o nome da variável, em vez de
# falhar mais adiante pedindo coisas a um repositório que não existe.
for _var in UPSTREAM_REPO FORK_REPO; do
  case "${!_var}" in
    *__*|"") echo "::error::Preencha ${_var} em .fork/config.sh (valor atual: '${!_var}')." >&2; exit 1 ;;
  esac
done
unset _var

FORK_DONO="${FORK_REPO%%/*}"
# O GHCR só aceita nome em minúsculas, mesmo quando o usuário tem maiúsculas.
IMG_NAMESPACE="ghcr.io/$(printf '%s' "$FORK_DONO" | tr '[:upper:]' '[:lower:]')"

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/${UPSTREAM_REPO}.git}"
ARQ_VERSAO=".fork/versao-original"

# O `gh` escolhe o repositório pelos remotes do git e PREFERE o chamado
# `upstream` — que aqui é o original. Sem isto, tarefa, PR, release e build
# seriam pedidos ao repositório original. Medido: na primeira execução o
# `gh release list` leu as releases do original e a release inicial não nasceu.
export GH_REPO="${GH_REPO:-$FORK_REPO}"

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

# O fork nasce sem tag e sem release nenhuma, e parte dos testes do original
# (scripts/conferir-isolamento-do-kit.sh, no `invariants`) compara o kit com a
# última release DESTE repositório e com tags antigas (v1.63.0). Este passo dá
# ao fork o histórico que ele já contém: as tags do original até a versão
# incorporada — os MESMOS commits, sem mudança — e, se ainda não houver release
# nenhuma, a release dessa versão (que é o original puro, com as imagens dele).
# Idempotente. Empurrado pelo GITHUB_TOKEN, não dispara o build de imagens.
preparar_historico_do_fork() {
  local ate="$1" t faltam=() remotas
  remotas="$(git ls-remote --tags origin | awk '{print $2}' | sed 's#^refs/tags/##; s#\^{}$##' | sort -u)"
  while read -r t; do
    printf '%s\n' "$remotas" | grep -xF "$t" >/dev/null || faltam+=("refs/upstream-tags/${t}:refs/tags/${t}")
  done < <(git for-each-ref --format='%(refname:strip=2)' 'refs/upstream-tags/v*' \
             | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V \
             | awk -v ate="$ate" '!feito { print } $0 == ate { feito = 1 }')
  if [ "${#faltam[@]}" -gt 0 ]; then
    echo "Trazendo ${#faltam[@]} tag(s) do original (até ${ate}) para o fork."
    git push --quiet origin "${faltam[@]}"
  fi
  # Pergunta explícita ao repositório do fork; erro da API derruba o passo em vez
  # de virar "já tem release" em silêncio.
  local n
  n="$(gh api "repos/${GH_REPO}/releases?per_page=1" --jq 'length')"
  if [ "$n" = "0" ]; then
    gh release create "$ate" --verify-tag --latest --title "${ate} (original, sem modificações)" \
      --notes "Ponto de partida do fork: a versão ${ate#v} do original, idêntica. As próximas versões deste repositório trazem as modificações do fork. Ver FORK.md."
    echo "Release inicial ${ate} criada."
  fi
}

configurar_autor_bot() {
  git config user.name  "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}
