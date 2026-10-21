#!/usr/bin/env bash
# Confere se o original (UPSTREAM_REPO, em config.sh) lançou versão nova e, se
# lançou, abre a TAREFA (uma Issue) com o que mudou. Quando a junção com o
# código deste fork é limpa, abre também o PR pronto para aprovar.
#
# Uso: bash .fork/sincronizar.sh                 (no Actions, com GH_TOKEN)
#      SINCRONIZAR_SECO=1 bash .fork/sincronizar.sh   (só o relatório, sem
#                                                      branch, PR nem Issue)
#
# Nunca mexe na main: tudo vai para a branch `sincronizar/vX.Y.Z` e só entra
# na main quando você aprova o PR.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=comum.sh
source "$DIR/comum.sh"

ROTULO="sincronizacao"

# A tarefa é aberta pelo robô do GitHub (BOT_TOKEN = GITHUB_TOKEN) para que a
# notificação chegue ao dono do fork; sem ele, cai na chave do dono.
gh_bot() { GH_TOKEN="${BOT_TOKEN:-$GH_TOKEN}" gh "$@"; }
SECO="${SINCRONIZAR_SECO:-}"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "::error::Há alterações não commitadas nesta cópia. A sincronização precisa de árvore limpa." >&2
  exit 1
fi

buscar_original
atual="$(versao_incorporada)"
alvo="$(ultima_versao_original)"

[ -z "$SECO" ] && preparar_historico_do_fork "$atual"

echo "Versão incorporada: ${atual} | última versão do original: ${alvo}"
if [ "$atual" = "$alvo" ]; then
  echo "Nada novo. Até a próxima semana."
  exit 0
fi
if [ "$(printf '%s\n%s\n' "$atual" "$alvo" | sort -V | tail -1)" = "$atual" ]; then
  echo "::warning::${ARQ_VERSAO} (${atual}) está À FRENTE do original (${alvo}). Nada a fazer."
  exit 0
fi

titulo="Atualização do original: ${atual} → ${alvo}"
branch="sincronizar/${alvo}"

# ── Uma tarefa por vez: a mais nova substitui as antigas ─────────────────────
if [ -z "$SECO" ]; then
  gh_bot label create "$ROTULO" --color 1D76DB \
    --description "Atualização vinda do projeto original" --force >/dev/null 2>&1 || true

  if gh issue list --label "$ROTULO" --state open --json title --jq '.[].title' | grep -xF "$titulo" >/dev/null; then
    echo "Já existe tarefa aberta para ${alvo}. Nada a fazer."
    exit 0
  fi
  while read -r num; do
    [ -n "$num" ] || continue
    gh_bot issue close "$num" --comment "Substituída pela tarefa de ${alvo}, que já inclui estas mudanças." || true
  done < <(gh issue list --label "$ROTULO" --state open --json number --jq '.[].number')
  while read -r num; do
    [ -n "$num" ] || continue
    gh pr close "$num" --delete-branch --comment "Substituído pela atualização para ${alvo}." || true
  done < <(gh pr list --label "$ROTULO" --state open --json number --jq '.[].number')
fi

# ── O relatório ──────────────────────────────────────────────────────────────
versoes="$(versoes_entre "$atual" "$alvo" | tr '\n' ' ')"
mudados_original="$(git diff --name-only "refs/upstream-tags/${atual}" "refs/upstream-tags/${alvo}" | sort -u)"
do_fork="$(arquivos_do_fork HEAD)"
em_comum="$(comm -12 <(printf '%s\n' "$mudados_original") <(printf '%s\n' "$do_fork") | grep . || true)"
n_mudados="$(printf '%s\n' "$mudados_original" | grep -c . || true)"

migr_original="$(git diff --name-only --diff-filter=A "refs/upstream-tags/${atual}" "refs/upstream-tags/${alvo}" -- "$PASTA_MIGRATIONS" | sed 's#.*/##' | grep -E '^[0-9]{14}_[0-9]{4}_' || true)"
migr_fork="$(printf '%s\n' "$do_fork" | grep "^${PASTA_MIGRATIONS}/" | sed 's#.*/##' | grep -E '^[0-9]{14}_[0-9]{4}_' || true)"
numeros_colididos="$(comm -12 \
  <(printf '%s\n' "$migr_original" | sed -nE 's#^[0-9]{14}_([0-9]{4})_.*#\1#p' | sort -u) \
  <(printf '%s\n' "$migr_fork"     | sed -nE 's#^[0-9]{14}_([0-9]{4})_.*#\1#p' | sort -u) | grep . || true)"

# ── A junção, numa branch à parte ────────────────────────────────────────────
configurar_autor_bot
base_sha="$(git rev-parse HEAD)"
voltar_para="$(git symbolic-ref -q --short HEAD || echo "$base_sha")"
git checkout --quiet -B "$branch" "$base_sha"
conflitos=""
if git merge --no-ff --no-edit -m "Incorpora ${alvo} do original" "refs/upstream-tags/${alvo}" >/tmp/merge.log 2>&1; then
  printf '%s\n' "$alvo" > "$ARQ_VERSAO"
  git add "$ARQ_VERSAO"
  git commit --quiet -m "fork: versão incorporada do original agora é ${alvo}"
  juncao="limpa"
else
  conflitos="$(git diff --name-only --diff-filter=U | sort -u)"
  git merge --abort
  juncao="conflito"
fi
git checkout --quiet "$voltar_para"

# ── O texto da tarefa ────────────────────────────────────────────────────────
{
  # A menção faz a tarefa chegar como "participando", o nível mais alto de aviso.
  echo "@${GITHUB_REPOSITORY_OWNER:-$FORK_DONO} o projeto original lançou **${alvo}**. Este fork está em **${atual}**."
  echo
  echo "Versões novas: ${versoes}· ${n_mudados} arquivo(s) alterado(s) no original."
  echo
  if [ "$juncao" = "limpa" ]; then
    echo "### ✅ A junção com o seu código foi limpa"
    echo
    echo "O PR com a atualização já está aberto (link abaixo). Para concluir:"
    echo
    echo "1. Leia as novidades abaixo e confira os pontos de atenção."
    echo "2. Espere os testes do PR terminarem (uns 30 minutos) e, com eles verdes, aprove o merge."
    echo "3. A versão nova do fork é publicada sozinha em seguida (mais uns 20 minutos, para as imagens)."
    echo "4. Quando a release aparecer, atualize a VPS: \`${COMANDO_ATUALIZAR_VPS}\`."
  else
    echo "### ⚠️ A junção tem conflito — precisa de uma mão"
    echo
    echo "O original mudou os mesmos trechos que você modificou nestes arquivos:"
    echo
    printf '%s\n' "$conflitos" | sed 's#^#- `#; s#$#`#'
    echo
    echo "**Para resolver com o Claude**, mande o link desta tarefa com o pedido:"
    echo
    echo "> Resolva a tarefa de sincronização deste link no fork ${FORK_REPO}: incorpore a ${alvo} do original preservando as minhas modificações, rode os testes e abra o PR."
  fi
  echo
  atencao="$(comm -23 <(printf '%s\n' "$em_comum") <(printf '%s\n' "$conflitos") | grep . || true)"
  if [ -n "$atencao" ]; then
    echo "### Pontos de atenção: arquivos que você modificou e o original também mudou"
    echo
    printf '%s\n' "$atencao" | sed 's#^#- `#; s#$#`#'
    echo
    echo "A junção desses foi automática, mas confira se a sua mudança continua fazendo sentido com a versão nova deles."
    echo
  fi
  requer="$(changelog_entre "$atual" "$alvo" | awk '
    /^## \[/ { versao = $0; next }
    /^### / { dentro = ($0 ~ /Requer atenção/); if (dentro) print "**" substr(versao, 4) "**"; next }
    dentro { print }')"
  if [ -n "$(printf '%s' "$requer" | tr -d '[:space:]')" ]; then
    echo "### 📌 O original pede atenção de quem opera a VPS"
    echo
    printf '%s\n' "$requer"
    echo
  fi
  if [ -n "$numeros_colididos" ]; then
    echo "### 🛑 Colisão de número de migration"
    echo
    echo "O original criou migrations com o mesmo número (NNNN) que migrations suas: **$(echo $numeros_colididos)**. A sua precisa ser renumerada antes do merge — e o apêndice correspondente no \`${ARQ_BASELINE}\` revisto."
    echo
  fi
  echo "<details><summary>Novidades do original (CHANGELOG)</summary>"
  echo
  changelog_entre "$atual" "$alvo"
  echo
  echo "</details>"
  echo
  echo "<details><summary>Arquivos alterados no original (${n_mudados})</summary>"
  echo
  printf '%s\n' "$mudados_original" | awk 'NR <= 400' | sed 's#^#- `#; s#$#`#'
  [ "$n_mudados" -gt 400 ] && echo "- … e mais $((n_mudados - 400))."
  echo
  echo "</details>"
  echo
  echo "Comparação completa: https://github.com/${UPSTREAM_REPO}/compare/${atual}...${alvo}"
} > /tmp/tarefa.md

# O GitHub recusa corpo acima de 65.536 caracteres; o changelog é o que cresce.
if [ "$(wc -c < /tmp/tarefa.md)" -gt 60000 ]; then
  python3 -c "import sys; sys.stdout.write(open('/tmp/tarefa.md',encoding='utf-8').read()[:58000])" > /tmp/tarefa.cortada.md
  printf '\n\n… (cortado pelo tamanho — veja a comparação completa no link acima)\n</details>\n' >> /tmp/tarefa.cortada.md
  mv /tmp/tarefa.cortada.md /tmp/tarefa.md
fi

if [ -n "$SECO" ]; then
  echo "── modo seco: junção ${juncao}; nada foi criado ──"
  cat /tmp/tarefa.md
  git branch -D "$branch" >/dev/null 2>&1 || true
  exit 0
fi

url_issue="$(gh_bot issue create --title "$titulo" --label "$ROTULO" --body-file /tmp/tarefa.md)"
num_issue="${url_issue##*/}"
echo "Tarefa aberta: ${url_issue}"

if [ "$juncao" = "limpa" ]; then
  git push --force origin "refs/heads/${branch}"
  {
    echo "Incorpora **${alvo}** do original, preservando as modificações deste fork."
    echo
    echo "Detalhes, novidades e pontos de atenção na tarefa: Closes #${num_issue}"
  } > /tmp/pr.md
  url_pr="$(gh pr create --base main --head "$branch" --title "$titulo" --label "$ROTULO" --body-file /tmp/pr.md)"
  gh_bot issue comment "$num_issue" --body "PR com a atualização: ${url_pr}"
  echo "PR aberto: ${url_pr}"
fi
