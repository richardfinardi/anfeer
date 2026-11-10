# Relatório de Inspeções ANFEER

Página: `https://consultoriarf.net/anfeer/relatorio_inspecoes/`.

Acesso pelo menu **Relatórios de Inspeção** (usa a chave administrativa `ANFEER_NOTIFICACOES_ADMIN_KEY`, que já é usada no cadastro de destinatários).

## Como publicar

1. No projeto **Google Apps Script das inspeções**, substitua o código pelo arquivo atualizado [apps-script/Inspecao.gs](../apps-script/Inspecao.gs).
2. Em **Configurações do projeto → Propriedades do script**, adicione a propriedade `ANFEER_RELATORIO_BACKEND_KEY` com uma string aleatória forte de pelo menos 24 caracteres. Esta chave protege a consulta dos relatórios no Apps Script e deve **ser diferente da chave administrativa do portal**.
3. Clique em **Implantar → Gerenciar implantações → Editar → Nova versão → Implantar**. A URL `/exec` existente precisa manter o mesmo ID, conforme o Worker já publicado.
4. No Worker `anfeer-inspecao-api` do Cloudflare, adicione um Secret `ANFEER_RELATORIO_BACKEND_KEY` com **exatamente o mesmo valor** da propriedade do passo 2.
5. No editor do Worker, publique o arquivo atualizado [cloudflare/inspecao-worker.js](../cloudflare/inspecao-worker.js) e clique em **Deploy**. A publicação HTML ocorre pelo GitHub Pages.
6. Entre no endereço do relatório, informe a chave administrativa existente e faça uma busca. Clique em **Gerar PDF** numa inspeção.

## Dados e pesquisa

- Pesquisa textual pelo código da peça, descrição `TITULO` e número da OS (`NUM_OS`).
- Filtros por processo, resultado e período.
- PDFs individuais com nominal, tolerâncias mín./máx., medição encontrada, resultado de cada parâmetro, **código e nome do instrumento utilizado**, além da validade do instrumento quando registrada.
- Dados são lidos das abas `INSPECOES`, `RESULTADOS` e `PARAMETROS` no Google Sheets. Nenhum registro anterior é apagado.
- O número da OS passa a ser gravado nas **novas** inspeções, a partir da API `/aponta_aberto`. Inspeções antigas podem não ter OS; não inventar nem presumir um código para esses registros.
- Para inspeções antigas o código do instrumento está preservado. Se o nome ainda não estava gravado, tenta-se obter a descrição atual no endpoint `/INSTRUMENTOS`. Caso não esteja disponível, o PDF mostra o código.
- Em `/plano_inspecao/`, o campo de pesquisa localiza por código da peça, processo ou nome da verificação.

## Segurança

- A API de relatórios no Cloudflare exige `X-ANFEER-ADMIN-KEY`, a chave do cadastro de notificações.
- O Apps Script **não permite** ler listagem/detalhe de relatórios pelo `doGet`, JSONP ou bridge. O Worker envia a consulta pelo `doPost`, com `ANFEER_RELATORIO_BACKEND_KEY` autenticada contra as propriedades privadas do Script.
- Não colocar segredos em HTML, GitHub ou prints.
- As rotinas já existentes de salvar inspeção e disparar alertas não precisam ser reconfiguradas.
