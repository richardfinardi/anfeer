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
O código do Worker usa a API **Omni**, que é diferente da Z-API clássica.
Após salvar uma inspeção, caso o Apps Script devolva `resultado: "REPROVADO"`, o Worker encaminha alerta de WhatsApp somente se a inspeção não for duplicada (`jaRegistrada`).
A gravação permanece válida mesmo que o envio falhe, com logs de erro no Worker.

No painel do Worker `anfeer-inspecao-api` em **Settings > Variables and Secrets**, adicione:

- `OMNI_CHANNEL_ID`: identificador do canal da Z-API Omni (variável ou segredo).
- `OMNI_SECRET_KEY`: Secret Key da Z-API Omni (**Secret**, nunca expor no GitHub).
- `OMNI_DESTINATARIOS`: números com DDI + DDD + número, só dígitos, separados por vírgula. Ex.: `5511999999999` (se preferir, como **Secret**).

Depois de configurar, copie a versão atualizada de `cloudflare/inspecao-worker.js` para o editor do Cloudflare e clique em **Deploy**.
Para usar a hora exata da inspeção em São Paulo, atualize também o Apps Script `apps-script/Inspecao.gs` e faça **Gerenciar implantações > Editar > Nova versão > Implantar**.

O envio é feito por `POST https://api.omni.z-api.io/v1/channels/{channelId}/messages` com Bearer Secret Key no servidor; usa conteúdo TEXT e não expõe credenciais ao usuário. Notifica somente resultado geral REPROVADO.
**Atenção:** o Worker continua sem autenticação real de origem para POST. Proteja a escrita antes de colocá-lo em produção aberta. Não há nenhum envio ativo até configurar os Secrets e publicar o novo Worker.
