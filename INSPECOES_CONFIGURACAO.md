# ANFEER - Inspeções

## Publicado neste repositório
- `/plano_inspecao/`: cadastro, múltiplos parâmetros, versões (só última ativa).
- `/inspecao/`: seleção de processo > apontamento aberto/máquina > formulário mobile-first > salvar.
- `/inspecao/config.js`: configuração da URL do Apps Script.
- `/apps-script/Inspecao.gs`: backend e validação das inspeções.

Banco Google Sheets: https://docs.google.com/spreadsheets/d/1bpVNM857IN_ymqF_zV3Moy6XRvjTD2KNIIV-r3yXgW0/edit

## Ativação obrigatória do backend
1. Abra https://script.google.com e crie um **projeto independente**, NÃO cole no mesmo projeto do apontamento/PLR.
2. Copie todo o arquivo `apps-script/Inspecao.gs` para `Código.gs` no novo projeto.
3. Em **Configurações do projeto > Propriedades do script** crie `INSPECAO_PIN` com um PIN forte. Não coloque esse valor no GitHub.
4. **Implantar > Nova implantação > Aplicativo da Web**. Executar como **Eu**. Acesso: **Qualquer pessoa**, pois o backend faz validação de PIN. No ambiente de produção considere autenticação mais robusta.
5. Copie a URL `https://script.google.com/macros/s/.../exec` e cole em `inspecao/config.js` no valor de `API_SHEETS`.
6. Abra os links do projeto e teste uma peça e uma inspeção. O backend reconsulta o CPS antes de gravar, inclusive validade dos instrumentos e apontamento aberto.

## Modelo de dados
- PLANOS: versão nova para cada publicação; versão anterior desativada.
- PARAMETROS: infinitos parâmetros dentro dos limites práticos da planilha; tipos COTA, CALIBRADOR e VISUAL. CALIBRADOR permitido somente em BROCHAMENTO.
- INSPECOES: cada inspeção individual, mesmo apontamento pode ter várias.
- RESULTADOS: valores medidos ou aprovado/reprovado e instrumentos.
- HISTORICO: publicação de versões.

## Notas
- Cotas são armazenadas no banco, mas o formulário do operador NÃO envia o nominal/limites ao DOM.
- O resultado é conferido no Apps Script, não é confiado ao navegador.
- O endpoint `/aponta_aberto` da amostra não inclui identificador único do apontamento. O sistema vincula por máquina, funcionário, peça e processo; se houver ID no futuro, integrar `ID_APONTAMENTO` ou `GUID_APONTAMENTO`.
- O Google Sheets foi criado na pasta `BANCO_DADOS` do Drive.
- A URL do backend está vazia propositalmente. Até implantar e configurar, os formulários exibem aviso e não gravam dados.
