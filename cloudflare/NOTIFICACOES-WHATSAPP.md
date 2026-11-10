# ANFEER — Cadastro de destinatários WhatsApp

## Objetivo
Permitir que a administração mantenha os destinatários dos alertas de **inspeção reprovada** no próprio portal, em `/notificacoes/`, sem alterar o Worker a cada número.

## Pré-requisitos (uma única vez, no Cloudflare)

1. Em **Workers & Pages → KV**, crie um namespace KV (por exemplo, `anfeer-config`).
2. Em **Workers & Pages → anfeer-inspecao-api → Settings → Bindings**, adicione um vínculo **KV namespace** com o nome de variável **`ANFEER_CONFIG`**, apontando ao namespace criado.
3. Em **Settings → Variables and Secrets**, crie um novo **Secret** chamado **`ANFEER_NOTIFICACOES_ADMIN_KEY`**. Use uma chave aleatória forte, com no mínimo 24 caracteres. Não a coloque no repositório nem em prints.
4. Publique a versão atualizada de `cloudflare/inspecao-worker.js` e a nova página `notificacoes/index.html` (bem como o menu principal).
5. Acesse `https://consultoriarf.net/notificacoes/`, informe a chave administrativa e cadastre nome, telefone completo com DDI + DDD e status **Ativo**.

**Atenção:** `ANFEER_NOTIFICACOES_ADMIN_KEY` é independente da `OMNI_SECRET_KEY` de envio e da `OMNI_WEBHOOK_SIGNING_SECRET` de recebimento. Nunca divulgue esses segredos.

## Compatibilidade com a configuração atual

- Antes do primeiro salvamento no portal, o Worker continua lendo a variável `OMNI_DESTINATARIOS` e enviando para os números atuais.
- Após o primeiro salvamento, o cadastro no KV passa a ser a fonte oficial. O envio considera **somente destinatários ativos**.
- Uma lista vazia ou com todos desativados deixa o envio de alertas sem destinatários.
- O limite é de 15 telefones distintos; o telefone é validado com 10 a 15 dígitos, usando DDI + DDD + número. Os dígitos dos telefones completos são exibidos apenas a quem conhece a chave administrativa.
- O KV oferece consistência eventual: uma alteração pode levar algum tempo para aparecer em todas as regiões. Não execute uma inspeção crítica assumindo propagação imediata.

## Segurança

- O Worker exige a chave administrativa no cabeçalho `X-ANFEER-ADMIN-KEY` para ler ou modificar a lista.
- A tela não salva a chave no navegador; ela permanece somente em memória até fechar ou recarregar a página.
- O login atual do portal não concede por si só acesso ao cadastro, pois a API existente de sessão do portal não fornece ao Worker uma comprovação de autorização administrativa.
- Recomendado complementar com limite de requisições de autenticação, política de rotação da chave e, se disponível, Cloudflare Access.

## Diagnóstico

- Se aparecer **“Vincule o KV namespace ANFEER_CONFIG ao Worker”**, faltou o vínculo do KV.
- Se aparecer **“Defina ANFEER_NOTIFICACOES_ADMIN_KEY”**, faltou criar o Secret ou ele tem menos de 24 caracteres.
- Se aparecer **“Chave administrativa inválida”**, confira a senha cadastrada, sem expô-la.
- Se aparecer erro de CORS ou resposta inválida, confira o deploy do Worker e o domínio de origem (`consultoriarf.net` ou `www.consultoriarf.net`).
- `whatsapp_status` retorna a quantidade de destinatários ativos; essa consulta não confirma entrega no WhatsApp.

## Arquivos alterados

- `cloudflare/inspecao-worker.js`
- `notificacoes/index.html`
- `index.html`
