# Disaster recovery — AegisPanel

Uma página. Use isto quando o disco da VPS morreu e o bucket offsite ainda existe.

O painel cifra cada dump com `ENCRYPTION_KEY` **antes** do upload. Sem a chave antiga o bucket é inútil. Uma chave nova gerada pelo instalador **não** abre os objetos.

## O que você precisa

1. URI do prefixo: `s3://SEU_BUCKET/SEU_PREFIXO` (o mesmo `prefix` da tela Backups → Destino; padrão `aegis`).
2. `ENCRYPTION_KEY` da instalação que gerou os backups.
3. Credenciais S3-compatíveis com leitura nesse bucket:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION` (use `auto` no R2)
   - `AWS_ENDPOINT_URL` se não for AWS (R2, B2, MinIO)

## Restore numa VPS nova

```bash
export ENCRYPTION_KEY='chave-antiga-hex'
export AWS_ACCESS_KEY_ID='...'
export AWS_SECRET_ACCESS_KEY='...'
export AWS_REGION='auto'
# export AWS_ENDPOINT_URL='https://xxx.r2.cloudflarestorage.com'

curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | \
  bash -s -- --restore-from s3://SEU_BUCKET/aegis
```

O instalador sobe o compose e, com o backend saudável, executa:

`docker compose exec -T backend node dist/scripts/dr-restore.js --from s3://SEU_BUCKET/aegis`

Esse script: baixa o `panel_state` mais recente → valida o JSON → `importState` → recria cada banco com a **mesma imagem** do painel → restaura o dump mais recente daquele `dbId` → sincroniza o Caddyfile.

## Dry-run (não escreve estado)

Já com a stack no ar e as mesmas variáveis no `.env`:

```bash
docker compose exec -T backend node dist/scripts/dr-restore.js \
  --from s3://SEU_BUCKET/aegis --dry-run
```

Lista o snapshot e os dumps que seriam aplicados.

## Restore de um objeto pelo painel

Com o painel ainda vivo: **Backups → Objetos no bucket → Restaurar**. Isso baixa, confere o SHA-256, descriptografa e aplica o magic check já existente. Dump de banco exige o container em execução; snapshot do painel substitui `panel_db.json`.

Apagar `data/backups` no disco **não** impede o restore se o objeto estiver no bucket e o registro local tiver `offsiteKey` — ou se você restaurar pela lista remota.

## Ensaio mensal (sem DR de verdade)

Em **Agendador**, ative `Ensaio mensal de restore` (`0 4 1 * *`, desligado por padrão). Ele valida o schema do snapshot do painel **sem importar** e sobe um container efêmero por banco. O dashboard fica vermelho se o último ensaio tem mais de 45 dias ou falhou.

## Ensaio trimestral humano

Numa VPS descartável, rode o `install.sh --restore-from` acima e confirme login + um `SELECT 1` em cada banco. Isso não é automatizado de propósito.

## Falhas comuns

| Sintoma | Causa |
| --- | --- |
| `Checksum SHA-256 do download não confere` | Objeto truncado ou gravado por outro processo |
| `Arquivo não é um dump cifrado pelo AegisPanel` | Objeto antigo em claro, ou `ENCRYPTION_KEY` errada |
| `Este valor foi criptografado com outra chave` | Senhas dos bancos no snapshot não abrem com a chave atual |
| Upload `completed_local_only` | Bucket inalcançável ou `LOCAL_MODE` sem `AEGIS_ALLOW_OFFSITE_BACKUP=true` |
