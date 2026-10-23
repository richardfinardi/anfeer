# ANFEER — PDFs originais no e-mail (mesmo layout do site)

O sistema usa **exatamente os mesmos geradores jsPDF** da página ANFEER para download, e-mail manual e e-mail mensal automático. A geração antiga no Google Docs foi removida.

## Ativar a versão atualizada do Apps Script

1. Na planilha `ANFEER_PLR_BANCO`, clique em **Extensões > Apps Script**.
2. Substitua os arquivos existentes pelos conteúdos atualizados do GitHub:
   - [Code.gs](../apps-script/Code.gs)
   - [Relatorios.gs](../apps-script/Relatorios.gs)
3. Salve. Execute `instalarAgendamentoPLR` **uma única vez para remover o gatilho ANTIGO**, que enviava PDFs simples.
4. Em **Implantar > Gerenciar implantações > Editar**, crie uma **nova versão** do Web App. A URL `/exec` normalmente permanece a mesma.

## Ativar o disparo do dia 1 pelo GitHub Actions

Abra as configurações do repositório **Settings > Secrets and variables > Actions**. Cadastre dois **Repository secrets**:
- `ANFEER_PLR_WEBAPP_URL` = URL `/exec` do Apps Script.
- `ANFEER_PLR_WEBAPP_KEY` = chave retornada por `instalarPLR()` (não cole a chave em arquivos públicos).

Depois, na aba **Actions > ANFEER - PLR PDFs originais > Run workflow**, faça primeiro um teste com **dry_run=true**. O teste gera e valida os quatro PDFs, sem enviar e-mails. Depois marque **dry_run=false** e execute o envio de teste, se desejar. O automático ocorre no **dia 1 de cada mês às 08h (São Paulo)**, com os dados do mês anterior.

> **Atenção:** enquanto os dois secrets não forem configurados e o Web App atualizado não for implantado, o automático não poderá enviar. Não há envio de relatórios substitutos ou com layout diferente.

## O que os PDFs apresentam

- **ABAIXO:** Indicadores PLR filtrados no próprio painel por aproveitamento abaixo de 70%.
- **ATENÇÃO:** Indicadores PLR filtrados entre 70% e menos de 90%.
- **EXCELENTE:** Indicadores PLR filtrados em 90% ou mais.
- **GERENCIAL:** PDF Gerencial completo do painel, sem filtro de faixa.

As férias, metas, faixas de status e fator próprio de Brochamento vêm da planilha **ANFEER_PLR_BANCO**. O sistema consulta os dados da API ANFEER em tempo real ao gerar os relatórios. Após o envio de quatro PDFs válidos, o Apps Script envia para os três destinatários cadastrados e registra o resultado na aba **ENVIOS**, impedindo disparo duplicado da mesma competência.

## Manual

Na aba **Gerencial**, selecione a competência e clique **Enviar 4 PDFs por e-mail**. O mesmo código jsPDF da aplicação gera os arquivos, e o Apps Script só os encaminha. O sistema confere a planilha ENVIOS antes de reenviar.

## Segurança e observações

- Não armazene URL de Web App nem chave em código público.
- GitHub Actions precisa do Chrome headless via Playwright; o workflow já instala o navegador.
- O antigo `enviarRelatoriosMensaisPLR` foi desativado para não gerar PDFs em formato inadequado.
- Não foi realizado envio de teste nesta alteração. A verificação real depende da nova implantação e dos Secrets.
