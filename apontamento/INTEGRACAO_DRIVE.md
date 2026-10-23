# ANFEER PLR — ativação da conexão Google Drive e e-mails

O banco **ANFEER_PLR_BANCO**, na pasta **BANCO_DADOS**, já existe e contém: `FERIAS`, `REGRAS`, `FAIXAS`, `FUNCIONARIOS`, `ENVIOS`, `CONFIG`.

## Implantação obrigatória no Google Apps Script

O conector Google Drive desta integração não disponibiliza ações para criar/implantar projetos Apps Script. O responsável pela conta Google precisa fazer **uma implantação**, sem instalar nada no servidor ANFEER:

1. Abra **ANFEER_PLR_BANCO** no Google Drive e use **Extensões > Apps Script**.
2. Substitua o conteúdo de `Code.gs` pelo arquivo deste repositório `apps-script/Code.gs`. Adicione um segundo arquivo chamado `Relatorios.gs` com o conteúdo de `apps-script/Relatorios.gs`. Salve.
3. Execute a função **instalarPLR()** e autorize o acesso a Sheets, Docs, Drive, Gmail e URL Fetch solicitado pelo projeto. Copie a **CHAVE_PLR** exibida no registro de execução. **Não publique a chave**.
4. Execute **instalarAgendamentoPLR()** e autorize, criando o disparo mensal por volta de 08:00 de São Paulo, no dia 1.
5. Clique **Implantar > Nova implantação > Aplicativo da Web**, escolha **Executar como eu** e **Quem tem acesso: Qualquer pessoa**. Publique e copie a URL terminada em `/exec`. Não compartilhe URL e chave publicamente.
6. Abra a aplicação ANFEER na aba **Status Apontamento**, insira URL e chave e clique **Conectar Drive**. Se existirem férias e metas cadastradas anteriormente apenas no navegador, clique **Migrar meus cadastros locais**.
7. Na aba **Gerencial**, selecione o mês encerrado e use **Enviar 4 PDFs por e-mail** para testar. Confira a aba **ENVIOS** e os e-mails recebidos.

## O que fica integrado

- Férias e funcionários: cadastro compartilhado, edição, exclusão e migração dos registros locais.
- Meta diária, status e vigência: leitura/gravação compartilhada.
- Brochamento: **fator próprio desativado inicialmente** (usa a eficiência da Ferramentaria), com botão para reativar/desativar. Depois da conexão com o Drive, o modo é compartilhado.
- E-mails: quatro relatórios (Abaixo, Atenção, Excelente, Gerencial), para os três destinatários especificados, com histórico na aba ENVIOS e prevenção de duplicidade no envio automático.

## Segurança e limites

- A aplicação pública não traz senhas ou tokens no repositório; a chave fica em Script Properties no Google e no armazenamento do navegador autorizado.
- O Apps Script precisa ser implantado/autorizado para as rotinas funcionarem. Apenas criar a planilha não ativa o envio.
- Os PDFs gerados pelo Apps Script são relatórios consolidados por funcionário, com tabelas e indicadores do mês anterior; o layout **não é idêntico** ao PDF interativo exportado pelo navegador.
- Enquanto não houver implantação, a geração de PDF local e os cálculos PLR permanecem operacionais, mas o e-mail manual e a sincronização de cadastros ainda não funcionam.
- O teste definitivo (login, gravação por outra máquina, disparo/recebimento de e-mail, validação dos quatro anexos) deve ser realizado após a implantação.
