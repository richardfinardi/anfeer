# ANFEER | Captura de três ciclos inteiramente pelo portal

## Arquitetura e arquivos
- Página: \`sensores/index.html\` em https://consultoriarf.net/anfeer/sensores/
- Firmware: \`firmware/ANFEER_ESP32_WIFI_V15_CAPTURA_NUVEM/ANFEER_ESP32_WIFI_V15_CAPTURA_NUVEM.ino\`
- API de captura: \`cloudflare/brochadeira-captura-worker.js\`

A API anterior **anfeer-brochadeira-api** permanece intocada. O Worker novo é um canal de controle e transferência de blocos dos sensores; usa **o mesmo D1** e a mesma identidade \`maquina7\` / token individual já configurado no ESP32. **Não exige novo token** nem executar SQL manualmente.

## Implantação única no Cloudflare
1. Em **Workers & Pages > Create Worker**, usar o nome exato **anfeer-brochadeira-captura** na conta cujo subdomínio é \`auvriun-monitor.workers.dev\`.
2. No editor, substituir todo o código pelo arquivo \`cloudflare/brochadeira-captura-worker.js\` e publicar.
3. Em **Settings > Bindings > Add > D1 database**, adicionar binding **BROCHA_DB**, apontando para o **mesmo D1** que está no Worker \`anfeer-brochadeira-api\`. Não criar banco novo.
4. Confirmar no navegador \`https://anfeer-brochadeira-captura.auvriun-monitor.workers.dev/health\`: \`"ok":true\`, \`"database_configured":true\`. As duas tabelas de captura serão criadas no primeiro acesso de captura autenticado.

**Atenção:** o nome da conta Workers e o nome do Worker precisam corresponder à URL acima, usada no firmware e no portal. Se o domínio resultante for outro, atualizar a constante \`API_CAPTURA\` no .ino e \`CAPTURE_API\` no HTML.

## Gravação do ESP32 (depois da compilação)
1. Abrir o arquivo .ino V15 no Arduino IDE. Bibliotecas: Adafruit ADS1X15 + BusIO e ArduinoJson v7. Placa ESP32 Dev Module.
2. Verificar (✓) e gravar (→) na COM7 se esse ainda for o número da porta.
3. As credenciais de Wi-Fi, identificador \`maquina7\` e token privado permanecem na NVS existente. Não reconfigurar.
4. Observar no Monitor Serial a linha \`[CAPTURA NUVEM]\`.

## Usar
1. Em \`https://consultoriarf.net/anfeer/sensores/\`, selecionar a máquina 7.
2. Clicar **Iniciar captura**. Aguardar indicador **Capturando ciclos**.
3. Deixar a máquina parada por 2 segundos; executar **3 ciclos completos**.
4. Clicar **Finalizar captura**. Aguardar **Recebendo amostras** e **Captura concluída**.
5. As correntes e sugestões aparecem no assistente. **Conferir** associação de estados antes de clicar **Aplicar faixas sugeridas** e **Salvar calibração na nuvem**.

## Segurança
- Portal: sessão ANFEER validada pelo endpoint de portal existente.
- ESP32: token individual verificado por SHA-256 contra \`brochadeira_dispositivo_chaves\` e por vínculo com \`brochadeira_sensores\`.
- TLS validado por CAs. Não há \`setInsecure\`. A chave não aparece em HTML, logs nem GitHub.
- Os blocos guardados no D1 estão limitados a 1.500 amostras por máquina/captura. Ao iniciar outra captura, removem-se os blocos anteriores da mesma máquina.
- **Sem contagem de produção e sem acionamento de inspeção na V15.** A calibração precisa ser testada em operação antes de automatizar ciclos e alertas.

## Diagnóstico rápido
- Portal exibe **Aguardando ESP32**: confira Wi-Fi, firmware V15 e \`/health\` do novo Worker.
- Portal exibe **Sem conexão com serviço de captura**: Worker não implantado, D1 não vinculado ou sessão inválida.
- Portal exibe **Falha na captura**: veja a mensagem e o Monitor Serial.
- Dados não aparecem: confira status \`[CAPTURA NUVEM] Bloco N: HTTP 201\` e a conexão à rede.
