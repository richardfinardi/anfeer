# ANFEER - Proxy de inspeções para celular

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
