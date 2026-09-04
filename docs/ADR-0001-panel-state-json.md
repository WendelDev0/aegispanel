# ADR-0001 — O estado do painel fica em um único JSON

**Status:** aceito · **Data:** 2026-09-04 · **Contexto:** [PRD-AEGIS-INFRA-PRO](./PRD-AEGIS-INFRA-PRO.md) fase 4

## Contexto

Todo o estado do AegisPanel — usuários, apps, bancos, domínios, backups, cron,
nós, sessões, configurações — vive em `DATA_DIR/panel_db.json`: um documento
carregado inteiro em memória na subida e reescrito inteiro a cada mutação, com
escrita atômica (arquivo temporário + `fsync` + `rename`).

Isso levanta a pergunta óbvia: por que não Postgres? Ou pelo menos SQLite?

## Decisão

**Fica JSON.** Um processo, um documento, escrita atômica.

E, explicitamente: **nunca Postgres nem qualquer banco em rede** para o estado do
painel. Se o gatilho abaixo disparar, o destino é **SQLite** (`better-sqlite3`),
com `JsonStorage` mantido como fachada e migração 1:1 por coleção.

## Por quê

**O painel é um processo só, por construção.** Ele monta o socket do Docker e
gerencia contêineres da máquina onde roda; duas instâncias sobre o mesmo
`DATA_DIR` não são um modo de operação suportado — o lock em
`utils/panel-lock.ts` recusa a segunda. Sem concorrência entre processos, o
principal argumento a favor de um banco desaparece.

**Postgres para o estado do painel inverte a dependência.** O painel provisiona
bancos; fazer o painel depender de um banco que ele mesmo gerencia significa que
uma falha no Postgres tira do ar a ferramenta que existe para consertá-lo. O
operador perderia o terminal, os logs e o restore — tudo ao mesmo tempo, e por
causa do componente que quebrou.

**O custo real do JSON é conhecido e limitado.** Serializar e `fsync` de alguns
MB por mutação é irrelevante nas dezenas de apps que uma VPS comporta. Cresce com
o estado total, não com o tamanho da mudança — e é exatamente por isso que o
gatilho abaixo mede em vez de supor.

**As falhas que o JSON tem, já foram fechadas:**

| Risco | Mitigação |
|---|---|
| Escrita pela metade | `tmp` + `fsync` + `rename` atômico |
| JSON corrompido | Quarentena `.corrupt-<ts>` e abortar a subida, nunca resetar para default |
| Dois escritores | Lock file com heartbeat (`utils/panel-lock.ts`) |
| Save válido mas errado | Snapshots em `DATA_DIR/state-history/` + rollback em 1 clique |
| Crescimento sem limite | Logs de build fora do JSON, prune de deploys, monitor de tamanho |

## Gatilho para migrar para SQLite

Migrar quando **qualquer um** for verdade **em produção**, não em teoria:

| Métrica | Limite |
|---|---|
| Tamanho de `panel_db.json` | > 8 MB |
| Apps + bancos somados | > 150 |
| p95 de `save()` | > 200 ms |

`GET /api/system/storage-health` reporta os três em `migrationTrigger`, com o
valor atual ao lado do limite. A decisão é tomada com o número na tela.

## Consequências

- Um export do estado é `cp panel_db.json` — o backup do painel e o DR ficam
  triviais, e o formato é legível por um humano numa emergência.
- Toda escrita passa pelo singleton `dbStorage`. Escrever o arquivo por fora
  deixa o processo servindo estado velho; é por isso que `dr-restore` e
  `reset-admin` exigem o backend parado.
- Consultas relacionais não existem. Se alguma tela precisar de agregação de
  verdade sobre o estado, isso é sinal a favor da migração — anotar aqui, não
  contornar com laços aninhados.
- Coleção nova entra em `DEFAULT_DATA` **e** em `DatabaseSchema` juntas; o merge
  de um nível no `load()` é o que permite um arquivo antigo ganhar campos novos.
