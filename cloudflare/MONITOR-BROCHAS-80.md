# ANFEER | Alerta automático no WhatsApp ao atingir 80% das horas

Não existe página, botão ou necessidade de deixar o navegador aberto. Um Cloudflare Worker consulta a API das brochas em um agendamento automático, compara a execução e chama a Central AUVRIUN WhatsApp.

## Fontes e destino
- Consulta: `GET https://anfeer.consultoriarf.net/brochas`
- Envio: `POST https://auvriun-whatsapp.auvriun-monitor.workers.dev/whatsapp/v1/send`
- Corpo da mensagem: `app=anfeer_brochas`, `event=notificacao`, texto da OS e `reference` único por empresa e OS.
- Destinatários: os que já estão **ativos** na aplicação `anfeer_brochas` da Central AUVRIUN. Não cadastrar números no código.

## Implantação uma única vez na conta Cloudflare
1. Criar banco **D1** chamado `anfeer-monitor-brochas` (Workers & Pages > D1 SQL Database). Nenhuma tabela manual: o próprio Worker cria as tabelas.
2. Criar um **Worker** chamado `anfeer-monitor-brochas` e colar o código de `cloudflare/monitor-brochas-80-worker.js`.
3. Em **Bindings**, vincular o D1 criado, com variável exatamente **`DB`**.
4. Em **Variables and Secrets**, cadastrar o **Secret** `WHATSAPP_APP_KEY` com a chave da aplicação `anfeer_brochas` gerada na Central AUVRIUN. A chave não deve ser publicada no GitHub.
5. Em **Triggers > Cron Triggers**, configurar **`*/5 * * * *`** (consulta a cada 5 minutos). Salvar e fazer deploy.
6. Consultar **Observability > Logs** no Worker para conferir execução. A primeira leitura grava a situação atual e **não envia mensagens antigas** de OS que já estavam acima de 80%.

## Regras
- Dispara quando `PERCENTUAL_EXECUCAO >= 80`. Vale inclusive para OS com `STATUS_HORAS=ESTOUROU` e percentual limitado a 95.
- Chave por **EMPRESA + N_OS**, evitando várias mensagens se houver diversos itens de orçamento ou várias consultas da mesma OS.
- Não volta a enviar para a mesma OS depois do primeiro aceite, mesmo que as horas sejam corrigidas.
- Se a Central falhar, retenta com espera crescente, até 5 tentativas; as falhas ficam no D1 e nos Logs.
- Para evitar uma enxurrada de notificações no dia de ativação, todas as OS já >= 80% na **primeira** leitura ficam como `BASELINE` e não são notificadas.
- Quando uma nova OS aparecer após essa primeira leitura com >= 80%, é enviada uma notificação.
- O código não contém números de telefone nem credenciais.
- Um HTTP 200 da Central significa aceite para processamento, não necessariamente entrega final no WhatsApp.

## Mensagem automática
```text
ANFEER | ALERTA DE HORAS: 80%

Empresa: ANF1
OS: 121
Título: ...
Orçamento: 127/
Cliente: ...
Previsão de entrega: 20/05/2022

Horas previstas: 10,00 h
Horas realizadas: 8,20 h
Execução: 82,00%
Situação: NORMAL

A OS atingiu ou ultrapassou 80% das horas previstas.
```

## Observações
- O agendamento é executado em UTC pelo Cloudflare e, com `*/5 * * * *`, roda em todos os fusos a cada cinco minutos.
- O Worker não precisa de rota HTTP nem interface web. A lógica fica no `scheduled()`.
- Necessário habilitar Cron, criar o binding D1 e o secret no Cloudflare. Commit no GitHub **não faz deploy** do Worker automaticamente.
