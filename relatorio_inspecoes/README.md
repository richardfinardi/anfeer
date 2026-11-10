# Relatório de Inspeções ANFEER

Página: `https://consultoriarf.net/anfeer/relatorio_inspecoes/`.

Acesso pelo menu **Relatórios de Inspeção**, sem tela de senha adicional. O login do portal ANFEER passa a emitir uma sessão assinada pelo Worker, válida por até 12 horas. Usuários com login antigo em cache precisam **entrar normalmente uma vez** após a atualização para obter essa sessão. Nunca liberar dados com base apenas em `localStorage` ou na API `/me` consultada por nome.

## Como publicar

1. No projeto **Google Apps Script das inspeções**, substitua o código pelo arquivo atualizado [apps-script/Inspecao.gs](../apps-script/Inspecao.gs).
2. Em **Configurações do projeto → Propriedades do script**, adicione a propriedade `ANFEER_RELATORIO_BACKEND_KEY` com uma string aleatória forte de pelo menos 24 caracteres. Esta chave protege a consulta dos relatórios no Apps Script e deve **ser diferente da chave administrativa do portal**.
3. Clique em **Implantar → Gerenciar implantações → Editar → Nova versão → Implantar**. A URL `/exec` existente precisa manter o mesmo ID, conforme o Worker já publicado.
4. No Worker `anfeer-inspecao-api` do Cloudflare, adicione um Secret `ANFEER_RELATORIO_BACKEND_KEY` com **exatamente o mesmo valor** da propriedade do passo 2. Como alternativa de configuração, se esse Secret não existir, o Worker usa o Secret `ANFEER_NOTIFICACOES_ADMIN_KEY` já existente; neste caso, a propriedade do Apps Script deve conter o mesmo valor da chave administrativa atual. O valor não deve aparecer na interface.
5. No editor do Worker, publique o arquivo atualizado [cloudflare/inspecao-worker.js](../cloudflare/inspecao-worker.js) e clique em **Deploy**. A publicação HTML ocorre pelo GitHub Pages.
6. Faça login normalmente em `https://consultoriarf.net/anfeer/` e clique em **Relatórios de Inspeção**. Não existe chave extra na tela. Pesquise e clique em **Gerar PDF** no conjunto de empresa, OS e peça. Caso tenha um login antigo em cache, saia e entre novamente uma única vez.

## Dados e pesquisa

- Pesquisa textual pelo código da peça, descrição `TITULO` e número da OS (`NUM_OS`).
- Filtros por processo, resultado e período.
- **Um PDF consolidado por `COD_EMPRESA + NUM_OS + COD_PECAS`**, contendo todas as inspeções da mesma OS e peça, em ordem cronológica, com resultado e máquina/funcionário de cada execução. Inclui nominal, tolerâncias, valor encontrado, instrumento (código, nome e validade) e resultado por parâmetro.
- Dados são lidos das abas `INSPECOES`, `RESULTADOS` e `PARAMETROS` no Google Sheets. Nenhum registro anterior é apagado.
- `NUM_OS` e `COD_EMPRESA` passam a ser gravados nas **novas** inspeções a partir da API `/aponta_aberto`. O endpoint deve retornar os dois campos. Na consulta, as inspeções antigas podem ter a identidade complementada quando houver correspondência única pelo ID do apontamento, ou por máquina, peça, processo e funcionário, com empresa e OS unívocas. Registros sem OS/empresa confirmadas ficam **separados**, sem misturar grupos.
- Para inspeções antigas o código do instrumento está preservado. Se o nome ainda não estava gravado, tenta-se obter a descrição atual no endpoint `/INSTRUMENTOS`. Caso não esteja disponível, o PDF mostra o código.
- Em `/plano_inspecao/`, o campo de pesquisa localiza por código da peça, processo ou nome da verificação.

## Segurança

- A API de relatórios no Cloudflare exige **Bearer token de sessão**, emitido somente após a validação do usuário/senha pelo endpoint `/login` da ANFEER. O token tem assinatura HMAC e validade de 12 horas. Login do portal não depende da chave administrativa das notificações; esta permanece privada no Worker para assinar sessões.
- Não é suficiente ter `anfeer_user` em localStorage para acessar os relatórios. O Worker verifica a sessão assinada em cada consulta.
- O Apps Script **não permite** ler listagem/detalhe de relatórios pelo `doGet`, JSONP ou bridge. O Worker envia a consulta pelo `doPost`, com `ANFEER_RELATORIO_BACKEND_KEY` autenticada contra as propriedades privadas do Script.
- Não colocar segredos em HTML, GitHub ou prints.
- As rotinas já existentes de salvar inspeção e disparar alertas não precisam ser reconfiguradas.

## Publicação da consolidação (novembro 2026)

- Atualizar [apps-script/Inspecao.gs](../apps-script/Inspecao.gs) e **implantar uma nova versão** no mesmo `/exec`. O Apps Script cria as colunas novas no Sheets sem apagar histórico quando grava novas inspeções.
- Atualizar [cloudflare/inspecao-worker.js](../cloudflare/inspecao-worker.js) e clicar em **Deploy**. As ações novas `relatorio_grupos` e `relatorio_grupo_detalhe` exigem sessão do portal.
- A página HTML do GitHub Pages é publicada automaticamente. Depois, sair/entrar no portal se a sessão expirar e atualizar com Ctrl+F5.
- Validar se `/aponta_aberto` envia o número da OS e `COD_EMPRESA` para todos os apontamentos. Se o nome do campo da OS diferir de `N_OS`, `NUM_OS`, `NUMERO_OS`, `NRO_OS`, `OS`, `COD_OS` etc., incluir a chave real em `insOsValue()`.
