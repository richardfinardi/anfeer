# Relatório de Inspeções ANFEER

Página: `https://consultoriarf.net/anfeer/relatorio_inspecoes/`.

Acesso pelo menu **Relatórios de Inspeção**, sem tela de senha adicional. O login do portal ANFEER passa a emitir uma sessão assinada pelo Worker, válida por até 12 horas. Usuários com login antigo em cache precisam **entrar normalmente uma vez** após a atualização para obter essa sessão. Nunca liberar dados com base apenas em `localStorage` ou na API `/me` consultada por nome.

## Como publicar

1. No projeto **Google Apps Script das inspeções**, substitua o código pelo arquivo atualizado [apps-script/Inspecao.gs](../apps-script/Inspecao.gs).
2. Em **Configurações do projeto → Propriedades do script**, adicione a propriedade `ANFEER_RELATORIO_BACKEND_KEY` com uma string aleatória forte de pelo menos 24 caracteres. Esta chave protege a consulta dos relatórios no Apps Script e deve **ser diferente da chave administrativa do portal**.
3. Clique em **Implantar → Gerenciar implantações → Editar → Nova versão → Implantar**. A URL `/exec` existente precisa manter o mesmo ID, conforme o Worker já publicado.
4. No Worker `anfeer-inspecao-api` do Cloudflare, adicione um Secret `ANFEER_RELATORIO_BACKEND_KEY` com **exatamente o mesmo valor** da propriedade do passo 2. Como alternativa de configuração, se esse Secret não existir, o Worker usa o Secret `ANFEER_NOTIFICACOES_ADMIN_KEY` já existente; neste caso, a propriedade do Apps Script deve conter o mesmo valor da chave administrativa atual. O valor não deve aparecer na interface.
5. No editor do Worker, publique o arquivo atualizado [cloudflare/inspecao-worker.js](../cloudflare/inspecao-worker.js) e clique em **Deploy**. A publicação HTML ocorre pelo GitHub Pages.
6. Faça login normalmente em `https://consultoriarf.net/anfeer/` e clique em **Relatórios de Inspeção**. Não existe chave extra na tela. Pesquise e clique em **Gerar PDF** numa inspeção. Caso tenha um login antigo em cache, saia e entre novamente uma única vez.

## Dados e pesquisa

- Pesquisa textual pelo código da peça, descrição `TITULO` e número da OS (`NUM_OS`).
- Filtros por processo, resultado e período.
- PDFs individuais com nominal, tolerâncias mín./máx., medição encontrada, resultado de cada parâmetro, **código e nome do instrumento utilizado**, além da validade do instrumento quando registrada.
- Dados são lidos das abas `INSPECOES`, `RESULTADOS` e `PARAMETROS` no Google Sheets. Nenhum registro anterior é apagado.
- O número da OS passa a ser gravado nas **novas** inspeções, a partir da API `/aponta_aberto`. Inspeções antigas podem não ter OS; não inventar nem presumir um código para esses registros.
- Para inspeções antigas o código do instrumento está preservado. Se o nome ainda não estava gravado, tenta-se obter a descrição atual no endpoint `/INSTRUMENTOS`. Caso não esteja disponível, o PDF mostra o código.
- Em `/plano_inspecao/`, o campo de pesquisa localiza por código da peça, processo ou nome da verificação.

## Segurança

- A API de relatórios no Cloudflare exige **Bearer token de sessão**, emitido somente após a validação do usuário/senha pelo endpoint `/login` da ANFEER. O token tem assinatura HMAC e validade de 12 horas. Login do portal não depende da chave administrativa das notificações; esta permanece privada no Worker para assinar sessões.
- Não é suficiente ter `anfeer_user` em localStorage para acessar os relatórios. O Worker verifica a sessão assinada em cada consulta.
- O Apps Script **não permite** ler listagem/detalhe de relatórios pelo `doGet`, JSONP ou bridge. O Worker envia a consulta pelo `doPost`, com `ANFEER_RELATORIO_BACKEND_KEY` autenticada contra as propriedades privadas do Script.
- Não colocar segredos em HTML, GitHub ou prints.
- As rotinas já existentes de salvar inspeção e disparar alertas não precisam ser reconfiguradas.
