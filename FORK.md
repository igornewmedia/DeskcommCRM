# Este é um fork — igornewmedia/DeskcommCRM

Este repositório é o [DeskcommCRM original](https://github.com/melgarafael/DeskcommCRM)
**mais as modificações do Igor**. Ele acompanha as versões do original sem perder
as modificações, e publica as próprias imagens Docker para a VPS.

## O ciclo, em uma tela

```
toda segunda 08:17 ──► o original lançou versão nova?
                           │ não → nada acontece
                           ▼ sim
                 abre uma Issue (a tarefa) com:
                   • as novidades (CHANGELOG)
                   • o que o original pede de atenção na VPS
                   • os arquivos que você mudou e o original também
                           │
            ┌──────────────┴───────────────┐
     junção limpa                     junção com conflito
            │                               │
   abre o PR pronto                mande a Issue ao Claude:
            │                      ele junta, testa e abre o PR
            └──────────────┬───────────────┘
                           ▼
              os testes rodam no PR;
              você confere e aprova o merge
                           ▼
          publica sozinho: tag → imagens → release
                           ▼
          na VPS: bash hostgator-setup-kit/update.sh
```

## O que é deste fork (e por que nunca dá conflito)

| Arquivo | Para quê |
|---|---|
| `.fork/versao-original` | A última versão do original incorporada aqui (ex.: `v1.85.0`) |
| `.fork/sincronizar.sh` | Compara versões, monta a tarefa, tenta a junção numa branch à parte |
| `.fork/publicar.sh` | Cria a tag, espera as imagens ficarem prontas e só então cria a release |
| `.fork/comum.sh` | Funções que os dois scripts usam |
| `.github/workflows/fork-sincronizar.yml` | Roda a sincronização toda segunda (ou na hora, em Actions → Run workflow) |
| `.github/workflows/fork-publicar.yml` | Publica a versão quando um PR de sincronização entra na `main` |

O original nunca toca nesses arquivos. As únicas mudanças em arquivos **dele**
são as três linhas que apontam as imagens para `ghcr.io/igornewmedia`
(`hostgator-setup-kit/_common.sh`, `docker-compose.prod.yml`,
`.env.hostgator.example`), exatamente onde o próprio original manda um fork mexer.

Os testes de governança do original (`tests/unit/gatilho-dos-jobs-de-entrega.test.ts`
e irmãos) vigiam os workflows **dele**. Os workflows do fork escrevem `jobs: # fork`
para ficar fora dessa varredura — assim nenhum teste do original precisa ser
editado aqui. Se um dia esses testes passarem a enxergar os workflows do fork,
o PR de sincronização vai mostrar o vermelho, e o conserto é acrescentar os dois
jobs aos mapas desses testes.

## Versões

- A versão do fork **tem o mesmo número** da versão do original que ela contém:
  `v1.86.0` aqui = `v1.86.0` do original + as suas modificações.
- Publicou uma correção sua entre duas versões do original? Ela sai como patch:
  `v1.86.1`, `v1.86.2`… (Actions → **Fork — publicar versão** → Run workflow).
- O fork **recusa publicar** se a `main` tiver código do original que ainda não
  saiu em versão lançada. Ele entrega versões do original, nunca o meio do caminho.
- As tags do original ficam em `refs/upstream-tags/*`, separadas das tags do fork.

## Fazendo uma modificação sua

1. Crie uma branch a partir da `main`, faça a mudança, abra o PR, deixe os testes rodarem e faça o merge.
2. Se quiser na VPS já: Actions → **Fork — publicar versão** → Run workflow. Senão, ela vai junto na próxima sincronização.

Para sofrer menos com conflitos: prefira **arquivos novos** a editar os existentes,
e quando editar, mexa no mínimo. Migration nova segue a doutrina do original
(`CLAUDE.md` › Migrations): arquivo em `supabase/migrations/` **e** apêndice no
`supabase/baseline.sql`. A tarefa semanal avisa quando o original usar o mesmo
número de migration que você.

**Migrations do fork usam a faixa 9001 em diante** (`<timestamp>_9001_<slug>.sql`,
depois 9002, 9003…). O original numera em sequência (0703 em 20/10/2026, cerca
de dez por dia), então um número logo acima do dele colide na versão seguinte.
O teste do projeto só proíbe número repetido, não lacuna. Para saber o próximo
livre do fork: `ls supabase/migrations | grep -oE '_9[0-9]{3}_' | sort | tail -1`.
No apêndice do `baseline.sql`, o rótulo acompanha: `-- ---- <coisa> (migration 9001) ----`.

## Primeira execução

O fork nasce sem tags e sem release, e um teste do original (`invariants`,
via `scripts/conferir-isolamento-do-kit.sh`) compara o instalador com a última
release **deste** repositório — então ele falha até o fork ter uma. A primeira
execução de **Fork — sincronizar com o original** resolve isso sozinha: traz as
tags do original até a versão incorporada (os mesmos commits) e cria a release
inicial, que é o original puro. Rode-a uma vez, à mão, logo depois de instalar.

## A chave FORK_TOKEN

O GitHub proíbe o token padrão do Actions (`GITHUB_TOKEN`) de enviar commits ou
tags que mexem em `.github/workflows` — e as versões do original mexem. Por isso
as duas automações do fork escrevem com uma chave do dono do repositório,
guardada no segredo `FORK_TOKEN`. De quebra, PR e tag enviados com ela disparam
os testes e o build sozinhos.

Para criar (ou renovar quando vencer):

1. github.com → foto → **Settings** → **Developer settings** → **Personal access tokens**
   → **Fine-grained tokens** → **Generate new token**.
2. Nome: `deskcomm-fork`. Validade: a mais longa que aparecer (anote para renovar).
3. **Repository access** → *Only select repositories* → `igornewmedia/DeskcommCRM`.
4. **Permissions** → *Repository permissions*, todas em **Read and write**:
   `Actions`, `Contents`, `Issues`, `Pull requests`, `Workflows`.
5. **Generate token** e copie a chave (ela aparece uma vez só).
6. No repositório: **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret** → nome `FORK_TOKEN`, valor = a chave → **Add secret**.

Sem o segredo, as automações param no primeiro passo com uma mensagem dizendo isso.

## Configuração única no GitHub (já feita, guardada aqui para referência)

- Actions ligado no fork.
- Settings › Actions › General › Workflow permissions: **Read and write** e
  **Allow GitHub Actions to create and approve pull requests** marcado.
- Workflows do original desligados aqui por não servirem a um fork
  (Actions › workflow › ⋯ › Disable): `release`, `vigia-de-colisao`.
- Pacotes no GHCR **públicos** (para a VPS baixar sem senha): github.com/igornewmedia?tab=packages
  → cada um dos 4 pacotes → Package settings → Change visibility → Public.

## Trocar a VPS para as imagens do fork (uma vez)

Só depois que existir a primeira release do fork. Dentro da pasta do projeto na VPS:

```bash
git remote set-url origin https://github.com/igornewmedia/DeskcommCRM.git
# As tags locais vieram do original e têm os MESMOS nomes das do fork, apontando
# para commits diferentes — precisam sair, senão a VPS faria checkout do código
# do original com as imagens do fork.
git tag -l 'v*' | xargs -r git tag -d
git fetch --tags origin
bash hostgator-setup-kit/update.sh
```

O `update.sh` faz backup do banco antes, como sempre.

**Voltar para o original** (mesmo caminho, ao contrário):

```bash
git remote set-url origin https://github.com/melgarafael/DeskcommCRM.git
git tag -l 'v*' | xargs -r git tag -d
git fetch --tags origin
# O código do original já está contido no do fork, então o update.sh acharia que
# é "voltar no tempo" e recusaria. Diga a versão e confirme com --force:
bash hostgator-setup-kit/update.sh --to vX.Y.Z --force   # a última versão do original
```

Atenção: voltar só funciona sem perda se as suas modificações **não** tiverem
criado tabela ou coluna no banco. Se criaram, a volta exige cuidado — peça ajuda antes.
