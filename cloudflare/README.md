# ANFEER - Proxy de inspeções para celular

## Atualização: conexão direta sem precisar de rota (09/11/2026)
O site publicado em GitHub Pages retornou HTTP 404 na URL `consultoriarf.net/anfeer/inspecao-api`, apesar de a route estar cadastrada no Cloudflare. Isso é consistente com DNS sem proxy Cloudflare ou zona sem delegação efetiva. **Para não alterar DNS do site existente, as telas agora usam diretamente `https://anfeer-inspecao-api.apicolumbia.workers.dev/`.** O Worker já permite via CORS a origem `https://consultoriarf.net`. A rota `consultoriarf.net/anfeer/inspecao-api*` deixa de ser necessária nesse arranjo; pode ser excluída sem interferir no aplicativo. Teste a URL do Worker com `?action=ping` e, depois, o formulário no celular.


## Por que existe
No Android, a leitura direta do Google Apps Script via `<script>` (JSONP) e via `iframe` pode ser barrada por autenticação/cookies/restrições do navegador. Este Worker consulta o Apps Script do lado do servidor e responde no **mesmo domínio** `consultoriarf.net`, evitando dependência dessas chamadas de terceiros.

## Implantar no Cloudflare (conta que controla consultoriarf.net)
1. Acesse Cloudflare > Workers & Pages > Create > Worker > Deploy.
2. Em Edit code, substitua todo o conteúdo pelo arquivo [inspecao-worker.js](./inspecao-worker.js) e clique em Deploy.
3. No Worker: Settings > Domains & Routes > Add > Route.
4. Zona: `consultoriarf.net`. Route: `consultoriarf.net/anfeer/inspecao-api*`. Salve.
5. Abra `https://consultoriarf.net/anfeer/inspecao-api?action=ping` em janela anônima. Deve retornar exatamente `{"ok":true}`.
6. Abra `https://consultoriarf.net/anfeer/inspecao/` no celular e selecione BROCHA > FRESADORA CONVENCIONAL TOSA. A tela já prioriza o Worker automaticamente.

**Não precisa modificar Apps Script nem trocar o link da planilha.** A versão /exec do Apps Script deve estar publicada com acesso **Qualquer pessoa** e execução como **Eu**. Em caso de erro HTML (login Google), revise essas permissões.

## Segurança
Sem PIN, a implantação do Apps Script anterior está publicamente acessível. O Worker verifica o Origin em gravações para reduzir uso indevido pelo navegador, mas **isso não é autenticação**. Para produção, é indispensável proteger as ações de gravação (ex.: Cloudflare Access ou sessão autenticada no backend), preferencialmente sem pedir senha extra ao operador.

## Detalhes técnicos
- `GET /anfeer/inspecao-api?action=plano_operador&peca=4-02-00972&processo=BROCHA` retorna plano *sem* nominal/tolerâncias.
- `GET /anfeer/inspecao-api?action=historico&peca=4-02-00972&processo=BROCHA` retorna histórico.
- `POST /anfeer/inspecao-api` com JSON aceita ações de gravação do backend.
- JSONP e a ponte iframe só são usados como fallback se o Worker ainda não estiver implantado.

## Z-API Omni: alerta automático de inspeção REPROVADA

Canal informado: `01A1C1624E387B6AB07BEFF201530C11`, obtido de `https://api.omni.z-api.io/hermitage/v1/channels/01A1C1624E387B6AB07BEFF201530C11`.
O ID já está configurado no Worker. A URL fornecida é de identificação/gerência do canal; para enviar texto o endpoint documentado pela Omni é **POST `https://api.omni.z-api.io/v1/channels/{channelId}/messages`** com cabeçalho `Authorization: Bearer <secret-key>`.

### No Cloudflare
Worker `anfeer-inspecao-api` > **Settings > Variables and Secrets** > Add:
- `OMNI_SECRET_KEY`: **Secret**. Cole a chave de API/Secret Key da Omni. Nunca cole no GitHub.
- `OMNI_DESTINATARIOS`: **Secret ou Text**. Coloque o(s) WhatsApp que deve(m) receber o alerta com DDI+DDD+número (apenas dígitos), separados por vírgula. Ex.: `5511999999999`.
- `OMNI_CHANNEL_ID` é opcional, porque `01A1C1624E387B6AB07BEFF201530C11` já está no código.

Depois copie a versão mais recente de `cloudflare/inspecao-worker.js` para o editor do Worker e clique em **Deploy**.

### Verificar configuração sem enviar mensagem
Abra `https://anfeer-inspecao-api.apicolumbia.workers.dev/?action=whatsapp_status`.
Retorno esperado, depois de cadastrar os dois Secrets:
`{"ok":true,"configurado":true,"destinatarios":1,"canalConfigurado":true}`.
O campo `configurado` não comprova envio, apenas que os Secrets existem.

### Teste real
Realize uma **nova** inspeção REPROVADA. A inspeção é persistida no Sheets; só então o Worker solicita, em segundo plano, o envio pela Omni.
O texto inclui peça, processo, máquina, funcionário, horário de São Paulo, identificação da inspeção e os parâmetros reprovados quando o Apps Script atualizado estiver implantado.
Para transmitir os parâmetros reprovados, copie `apps-script/Inspecao.gs` atualizado para o projeto Google e publique **nova versão** da mesma implantação.
As inspeções reprovadas anteriores não disparam notificações retroativas.
Acompanhe erros no Cloudflare > Worker > Observability > Logs.

**Atenção:** o Worker e o Apps Script ainda não possuem autenticação robusta nas ações de gravação; o Origin ajuda no controle do navegador, mas não garante identidade. Para produção, proteger a API sem impor nova senha ao operador.
