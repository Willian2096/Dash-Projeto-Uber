# DriveUp — correção da sincronização por versão — 05/10/2026

## Escopo

Correção autorizada da pendência de URLs grandes no salvamento de preferências. Somente a branch `feature/modulos-dashboard`; sem merge, produção ou alterações de dados reais.

`writeRecord`, em `phase1-core.js`, mantém a comparação dos campos alterados com os dados lidos do banco e passa a condicionar o UPDATE ao `updated_at` exato recebido. O timestamp não é convertido para Date nem arredondado, preservando os microssegundos. O conteúdo de preferências é enviado no corpo, não no filtro do endereço.

Tabelas sem timestamp, como `monthly_goals`, mantêm a comparação pelos valores pequenos alterados. Um valor sem versão que geraria filtro extenso interrompe a operação com aviso, sem enviar a gravação.

## Verificações

Consulta somente de leitura confirmou triggers BEFORE UPDATE ativos em `user_settings`, `profiles`, `sessions`, `refuels`, `routines`, `strategies` e `weekly_checklists`, com `new.updated_at = now()` no banco. Nenhuma migration foi necessária.

Foram adicionados 22 testes em `tests/phase1-version.test.cjs`, já executados localmente com sucesso e integrados ao build. Abrangem preferências maiores que 1 MB com URL inferior a 400 caracteres, timestamps com microssegundos, conflito antes da gravação, alteração entre leitura e gravação, mesclagem de campos não conflitantes, metas sem timestamp, falha de rede, isolamento pelos identificadores, preservação dos dados pendentes e hodômetro. A versão anterior falha no teste de URL grande, confirmando a reprodução do problema.

O build continua executando os 90 testes anteriores, mais os 22 novos. `preview-build.json` registra a contagem efetivamente aprovada, o hash SHA-256 do módulo testado e o commit do deployment. Uma falha impede a geração da nova preview.

## Limites

As gravações dos testes são simuladas em memória. Esta correção não representa teste autenticado ponta a ponta com as contas reais nem uma revisão completa de segurança. Não modifica o layout, a regra de combustível, o hodômetro manual, os PDFs ou as metas. As demais pendências documentadas anteriormente não são encerradas por este ajuste.

## Validação manual focada

Após abrir a preview corrigida, salvar uma preferência visual, aguardar sincronização e recarregar para conferir persistência. A proteção contra conflito pode ser conferida com duas abas, mantendo o procedimento já aprovado. Não há necessidade de repetir todo o checklist de combustível ou reimportar PDFs por causa desta alteração.
