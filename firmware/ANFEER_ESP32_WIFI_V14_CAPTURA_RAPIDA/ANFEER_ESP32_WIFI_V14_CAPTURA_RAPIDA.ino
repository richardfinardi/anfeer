/*
  ANFEER / AUVRIUN - ESP32 WIFI UNIVERSAL - V14 CAPTURA RAPIDA
  ------------------------------------------------------
  Funcoes desta etapa:
    - Configuracao inicial pelo celular: AP temporario, http://192.168.4.1
    - Salva Wi-Fi, identificador do ESP32 e codigo global da maquina na NVS
    - Recuperacao pelo botao BOOT (GPIO 0), segurando por 5 segundos COM A PLACA LIGADA
    - Leitura real de corrente do SCT-013-030 pelo ADS1115 no GPIO21/22
    - Pagina web local de diagnostico e endpoint GET /api/status
    - Chave individual do ESP32, configurada somente pelo AP, salva na NVS
    - Envio de corrente em HTTPS validado ao Cloudflare (POST /v1/leituras)
    - Sem buzzer; LEDs GPIO 16, 17, 18, 19
    - Teste sequencial dos 4 LEDs na inicializacao
    - Captura local rapida em JSON dos 3 ciclos, sem limite fixo de 12 segundos
    - Download de calibracao /v1/calibracao (autenticado por dispositivo)
    - Salva ultima calibracao validada na memoria nao volatil do ESP32
    - Classifica corrente por faixa e acende vermelho / amarelo / verde
    - LED azul apenas no autoteste (inspecao nao implementada nesta etapa)

  IMPORTANTE:
    - Firmware de comissionamento: NAO conta ciclos nem autoriza producao.
    - Nao ha alertas de inspecao nesta etapa; LEDs mostram estados de corrente.
    - Fora da captura, continua transmitindo somente leituras; nenhum evento de OS e gerado.
    - Durante a captura, o HTTPS e pausado para preservar as amostras RMS locais.
    - A sequencia recebida e armazenada mas nao conta ciclos nesta etapa.
    - O reconhecimento de ciclos V10 ainda precisara ser validado na maquina.
    - A gravacao substitui o aplicativo atual; mantenha ANFEER_ESP32_BACKUP.bin.
    - Nao ligar sensor/placa diretamente a condutores energizados.

  Dependencias Arduino IDE:
    ESP32 by Espressif Systems, Adafruit ADS1X15 (e Adafruit BusIO), ArduinoJson (v7).
  Hardware:
    ADS1115 VDD=3V3, GND=GND, SDA=GPIO21, SCL=GPIO22, ADDR=GND;
    SCT-013-030 de saida 30A/1V com polarizacao de referencia em ~1,65V
    e sinal entre A0 e referencia (conforme circuito ja testado).
    LEDs: GPIO16 vermelho; GPIO17 amarelo; GPIO18 verde; GPIO19 azul.
*/

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <WebServer.h>
#include <Preferences.h>
#include <Adafruit_ADS1X15.h>
#include <ArduinoJson.h>
#include <esp_system.h>

static const char *APP_VERSION = "14.0.0-captura-local";
static const char *API_LEITURAS = "https://anfeer-brochadeira-api.auvriun-monitor.workers.dev/v1/leituras";
static const char *API_CALIBRACAO = "https://anfeer-brochadeira-api.auvriun-monitor.workers.dev/v1/calibracao";
static const uint32_t REVISAR_CALIBRACAO_MS = 60000;
static const uint32_t TELEMETRIA_MS = 2000;
// Certificados raiz publicos. NUNCA usar setInsecure() ao enviar o token.
static const char CA_CERTS[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDXzCCAkegAwIBAgILBAAAAAABIVhTCKIwDQYJKoZIhvcNAQELBQAwTDEgMB4G
A1UECxMXR2xvYmFsU2lnbiBSb290IENBIC0gUjMxEzARBgNVBAoTCkdsb2JhbFNp
Z24xEzARBgNVBAMTCkdsb2JhbFNpZ24wHhcNMDkwMzE4MTAwMDAwWhcNMjkwMzE4
MTAwMDAwWjBMMSAwHgYDVQQLExdHbG9iYWxTaWduIFJvb3QgQ0EgLSBSMzETMBEG
A1UEChMKR2xvYmFsU2lnbjETMBEGA1UEAxMKR2xvYmFsU2lnbjCCASIwDQYJKoZI
hvcNAQEBBQADggEPADCCAQoCggEBAMwldpB5BngiFvXAg7aEyiie/QV2EcWtiHL8
RgJDx7KKnQRfJMsuS+FggkbhUqsMgUdwbN1k0ev1LKMPgj0MK66X17YUhhB5uzsT
gHeMCOFJ0mpiLx9e+pZo34knlTifBtc+ycsmWQ1z3rDI6SYOgxXG71uL0gRgykmm
KPZpO/bLyCiR5Z2KYVc3rHQU3HTgOu5yLy6c+9C7v/U9AOEGM+iCK65TpjoWc4zd
QQ4gOsC0p6Hpsk+QLjJg6VfLuQSSaGjlOCZgdbKfd/+RFO+uIEn8rUAVSNECMWEZ
XriX7613t2Saer9fwRPvm2L7DWzgVGkWqQPabumDk3F2xmmFghcCAwEAAaNCMEAw
DgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQFMAMBAf8wHQYDVR0OBBYEFI/wS3+o
LkUkrk1Q+mOai97i3Ru8MA0GCSqGSIb3DQEBCwUAA4IBAQBLQNvAUKr+yAzv95ZU
RUm7lgAJQayzE4aGKAczymvmdLm6AC2upArT9fHxD4q/c2dKg8dEe3jgr25sbwMp
jjM5RcOO5LlXbKr8EpbsU8Yt5CRsuZRj+9xTaGdWPoO4zzUhw8lo/s7awlOqzJCK
6fBdRoyV3XpYKBovHd7NADdBj+1EbddTKJd+82cEHhXXipa0095MJ6RMG3NzdvQX
mcIfeg7jLQitChws/zyrVQ4PkX4268NXSb7hLi18YIvDQVETI53O9zJrlAGomecs
Mx86OyXShkDOOyyGeMlhLxS67ttVb9+E7gUJTb0o2HLO02JQZR7rkpeDMdmztcpH
WD9f
-----END CERTIFICATE-----
)PEM";
static const uint8_t PIN_LED_VERMELHO = 16;
static const uint8_t PIN_LED_AMARELO  = 17;
static const uint8_t PIN_LED_VERDE    = 18;
static const uint8_t PIN_LED_AZUL     = 19;
static const uint8_t PIN_RECUPERAR    = 0;  // botao BOOT da placa (se presente)
static const uint8_t I2C_SDA          = 21;
static const uint8_t I2C_SCL          = 22;
static const uint8_t ADS_I2C         = 0x48;

static const uint32_t RECUPERACAO_MS = 5000;
static const uint32_t WIFI_TIMEOUT_MS = 12000;
static const uint32_t SAMPLE_PERIOD_MS = 300;
static const uint16_t SAMPLE_COUNT = 170;
static const uint16_t CAPTURA_ADC_AMOSTRAS = 64;
static const uint32_t CAPTURA_PERIODO_MS = 90;
static const size_t CAPTURA_MAX_PONTOS = 1500;
static const float AMP_PER_VRMS = 30.0f; // SCT-013-030 30A/1V (nominal)

Preferences prefs;
WebServer server(80);
Adafruit_ADS1115 ads;
String wifiSsid, wifiPass, deviceId, setupPass, apName, apiToken;
uint32_t maquina = 0;
float corrente = 0.0f, referencia = 0.0f;
uint32_t ultimaMedicao = 0, ultimaTentativaAds = 0;
uint32_t reiniciarEm = 0;
uint32_t botaoDesde = 0;
uint32_t ultimaTentativaWifi = 0, ultimoEnvio = 0, ultimaConexaoApi = 0;
int ultimoHttp = 0;
String statusNuvem = "Ainda nao enviou";
bool adsOk = false, apLigado = false, recuperacaoJaAcionada = false;

// Faixas da calibracao pertencem a maquina, sem cod_empresa.
// Ordem: parada / avanco / retorno / producao.
static const char *NOMES_ESTADOS[4] = {"PARADA", "AVANCO", "RETORNO", "PRODUCAO"};
struct Faixa { float minimo; float maximo; };
Faixa faixas[4] = {};
uint8_t sequenciaSalva[12] = {};
uint8_t comprimentoSequencia = 0;
uint32_t tempoMinimoMs = 300;
uint32_t versaoCalibracao = 0;
bool calibracaoValida = false;
int estadoConfirmado = -1, estadoCandidato = -1;
uint32_t candidatoDesde = 0;
uint32_t ultimaConsultaCalibracao = 0;
int ultimoHttpCalibracao = 0;
String statusCalibracao = "Sem calibracao carregada";

struct PontoCaptura { uint32_t t_ms; float corrente_a; };
static PontoCaptura pontosCaptura[CAPTURA_MAX_PONTOS];
static size_t numeroPontos = 0;
static uint32_t inicioCaptura = 0;
static bool capturaAtiva = false;
static bool capturaPronta = false;

const char PAGINA[] PROGMEM = R"HTML(
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AUVRIUN | Configuracao do sensor</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{background:#0c1017;color:#f4f6fb;margin:0;font:15px system-ui,Segoe UI,Arial,sans-serif}
main{max-width:630px;margin:25px auto;padding:15px}
h1{font-size:25px;margin:4px 0 8px}h2{font-size:18px;margin:0 0 15px}p,small{color:#b6c0cc;line-height:1.5}
.box{background:#171d27;border:1px solid #364252;border-radius:15px;padding:20px;margin:18px 0}
label{display:block;color:#c5cedb;font-weight:700;font-size:13px;margin:14px 0 6px}
input{display:block;width:100%;border:1px solid #526071;border-radius:10px;background:#0a1019;color:white;padding:12px;font:inherit}
button{border:0;background:#d9231d;color:white;padding:13px 20px;font:inherit;font-weight:800;border-radius:9px;margin-top:16px;cursor:pointer}
#alert{padding:12px;border-radius:9px;margin-top:12px;display:none;background:#264634}
.val{font-size:26px;font-weight:800}code{color:#9ac2ff} .muted{color:#92a0b2}
</style></head><body><main>
<h1>AUVRIUN | Sensor industrial</h1>
<p>Configuracao inicial da maquina e conexao ao Wi-Fi da fabrica.</p>
<div class="box"><h2>Diagnostico</h2>
<div><span class="val" id="amps">— A</span> <small id="ads">Carregando...</small></div>
<p>Maquina: <b id="cod">—</b> | ESP32: <b id="ident">—</b></p>
<p>Rede da fabrica: <b id="rede">—</b> | IP: <b id="ip">—</b></p>
<p>Cloudflare: <b id="nuvem">Aguardando...</b></p>
<p>Calibracao: <b id="calibracao">Aguardando...</b> | Estado: <b id="estado">—</b></p>
<p class="muted" id="versao"></p>
</div>
<div class="box" id="capturabox">
<h2>Captura rapida de tres ciclos</h2>
<p>1. Deixe a maquina parada por cerca de 2 segundos. 2. Toque em Iniciar e execute 3 ciclos completos. 3. Finalize e baixe o JSON. 4. Importe no portal ANFEER para analisar e salvar a calibracao.</p>
<p><b id="capstatus">Captura desligada</b></p>
<button type="button" id="capstart">Iniciar captura</button>
<button type="button" id="capstop" style="background:#435269">Finalizar captura</button>
<a id="capdownload" href="/api/captura/dados" download="ANFEER_captura.json" style="display:none;margin:14px 0;padding:13px 18px;color:#fff;background:#176e4d;border-radius:10px;text-decoration:none;font-weight:700">Baixar dados dos ciclos (.json)</a>
<p><small>Leitura RMS local de aproximadamente 10 vezes/segundo, sem enviá-la em alta velocidade ao Cloudflare. Os dados ficam no ESP32 ate uma nova captura ou reinicializacao. Sem contagem de producao.</small></p>
</div>
<div class="box" id="formbox">
<h2>Configurar dispositivo</h2>
<form id="form">
<label for="ssid">Wi-Fi da fabrica (SSID)</label>
<input id="ssid" name="ssid" autocomplete="off" maxlength="32" required placeholder="Nome da rede">
<label for="senha">Senha da rede Wi-Fi</label>
<input id="senha" name="senha" type="password" autocomplete="new-password" maxlength="63" placeholder="Deixe vazia para manter a senha atual">
<small>Ao mudar o nome da rede, informe tambem sua senha. Para rede aberta, deixe em branco.</small>
<label for="mach">Codigo global da maquina no CPS</label>
<input id="mach" name="maquina" type="number" min="1" max="999999999" required placeholder="Ex.: 7">
<label for="device">Identificador do ESP32 no cadastro ANFEER</label>
<input id="device" name="dispositivo" maxlength="48" minlength="8" pattern="[A-Za-z0-9_-]{8,48}" required placeholder="Ex.: maquina7">
<label for="api_token">Chave privada da maquina (Cloudflare)</label>
<input id="api_token" name="api_token" type="password" autocomplete="new-password" spellcheck="false" maxlength="256" placeholder="Cole aqui a chave ANFEER_maquina7_CHAVE.txt">
<small id="tokenInfo">A chave e gravada na memoria do ESP32; nao aparece na pagina e nao sera enviada a outros servicos. Se ja estiver gravada, deixe este campo vazio.</small>
<button type="submit" id="salvar">Salvar e conectar</button>
</form><div id="alert" role="status"></div>
<p><small>Esta configuracao pode ser aberta pelo Wi-Fi temporario do sensor.
Para recuperar, segure BOOT na placa por 5 segundos com ela ligada. A calibracao e feita depois em consultoriarf.net/anfeer/sensores/.</small></p>
</div>
</main><script>
const $=x=>document.getElementById(x);
async function update(){try{const r=await fetch('/api/status',{cache:'no-store'});const s=await r.json();
$('amps').textContent=s.ads_ok ? Number(s.corrente_a).toFixed(2)+' A' : 'ADS1115 indisponivel';
$('ads').textContent=s.ads_ok?'Leitura real do sensor':'Conferir cabos SDA/SCL e alimentacao';
$('cod').textContent=s.cod_maquina||'Nao configurada';$('ident').textContent=s.dispositivo_id||'Nao configurado';
$('rede').textContent=s.wifi_conectado?'Conectado':(s.ssid||'Nao conectado');$('ip').textContent=s.ip||'—';
$('versao').textContent='Firmware '+s.versao;
$('calibracao').textContent=s.calibracao_valida?'Versao '+s.calibracao_versao:(s.status_calibracao||'Nao calibrado');
$('estado').textContent=s.estado||'Nao identificado';
$('nuvem').textContent=(s.token_configurado?'Chave OK. ':'Chave nao configurada. ')+(s.status_nuvem||'')+(s.ultimo_http?' (HTTP '+s.ultimo_http+')':'');
$('tokenInfo').textContent=s.token_configurado?'Chave ja armazenada. Deixe vazio para preservar, ou cole uma nova para substituir.':'Cole uma vez a chave privada criada no Windows. Nao informe o hash SQL.';
$('capstatus').textContent = (s.captura_ativa?'GRAVANDO':'PARADA')+' | '+(s.captura_amostras||0)+' leituras';
$('capstart').disabled=!!s.captura_ativa;
$('capstop').disabled=!s.captura_ativa;
$('capdownload').style.display=(!s.captura_ativa&&s.captura_amostras>=20)?'inline-block':'none';
if(!$('mach').value&&s.cod_maquina)$('mach').value=s.cod_maquina;
if(!$('device').value&&s.dispositivo_id)$('device').value=s.dispositivo_id;
if(!$('ssid').value&&s.ssid)$('ssid').value=s.ssid;
}catch(e){$('ads').textContent='Sem resposta do ESP32';}}
$('form').addEventListener('submit',async e=>{e.preventDefault();$('salvar').disabled=true;
const body=new URLSearchParams(new FormData($('form')));
try{const r=await fetch('/salvar',{method:'POST',body});const j=await r.json();
$('alert').style.display='block';$('alert').style.background=j.ok?'#264634':'#66252c';
$('alert').textContent=j.ok?'Configuracao salva. O ESP32 vai reiniciar e tentar conectar ao Wi-Fi.':j.erro||'Erro ao salvar';
}catch(e){$('alert').style.display='block';$('alert').textContent='Falha ao comunicar com o sensor.';}
finally{$('salvar').disabled=false;}});
async function comandoCaptura(acao){
 try{
  const r=await fetch('/api/captura/'+acao,{method:'POST',cache:'no-store'});
  const j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.erro||'Falha ao controlar captura');
  await update();
 }catch(e){alert('Captura: '+e.message)}
}
$('capstart').addEventListener('click',()=>comandoCaptura('iniciar'));
$('capstop').addEventListener('click',()=>comandoCaptura('parar'));
update();setInterval(update,1500);
</script></body></html>
)HTML";

String criarSenha() {
  const char *chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  String s;
  for (int i = 0; i < 14; ++i) s += chars[esp_random() % strlen(chars)];
  return s;
}

String sufixoMac() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[9];
  snprintf(buf, sizeof(buf), "%06lX", (unsigned long)(mac & 0xFFFFFFUL));
  return String(buf);
}

bool dispositivoValido(const String &s) {
  if (s.length() < 8 || s.length() > 48) return false;
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
  }
  return true;
}

bool chamadaPeloAP() {
  if (!apLigado) return false;
  return server.client().localIP() == WiFi.softAPIP();
}

void enviarResposta(bool ok, int status, const char *erro = nullptr) {
  JsonDocument doc;
  doc["ok"] = ok;
  if (erro) doc["erro"] = erro;
  String resp;
  serializeJson(doc, resp);
  server.send(status, "application/json; charset=utf-8", resp);
}

void salvarConfiguracao() {
  if (!chamadaPeloAP()) { enviarResposta(false, 403, "Conecte-se a rede Wi-Fi temporaria do sensor."); return; }
  String ssid = server.arg("ssid");
  String pass = server.arg("senha");
  String disp = server.arg("dispositivo");
  String cod = server.arg("maquina");
  String novoToken = server.arg("api_token");
  ssid.trim(); disp.trim();cod.trim(); novoToken.trim();
  if (ssid.isEmpty() || ssid.length() > 32 || !dispositivoValido(disp)) {
    enviarResposta(false, 400, "Verifique o nome do Wi-Fi e o identificador (8 a 48 caracteres).");return;
  }
  if (cod.isEmpty() || cod.length() > 9) {
    enviarResposta(false, 400, "Informe o codigo da maquina.");return;
  }
  for (size_t i=0;i<cod.length();i++) if (cod[i] < '0' || cod[i] > '9') {
    enviarResposta(false, 400, "Codigo da maquina invalido.");return;
  }
  uint32_t mach = (uint32_t)cod.toInt();
  if (mach == 0 || mach > 999999999U) {
    enviarResposta(false, 400, "Codigo da maquina invalido.");return;
  }
  if (pass.length() > 63) { enviarResposta(false, 400, "Senha do Wi-Fi muito longa.");return; }
  if (ssid == wifiSsid && pass.isEmpty()) pass = wifiPass;
  if (!novoToken.isEmpty()) {
    if (novoToken.length() < 43 || novoToken.length() > 256) {
      enviarResposta(false, 400, "Chave deve ter no minimo 43 caracteres."); return;
    }
    for (size_t i = 0; i < novoToken.length(); ++i) {
      char c = novoToken[i];
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_')) {
        enviarResposta(false, 400, "Chave possui caracteres invalidos."); return;
      }
    }
  }
  prefs.begin("auvriun", false);
  prefs.putString("ssid", ssid);
  prefs.putString("wifipass", pass);
  prefs.putString("deviceid", disp);
  prefs.putUInt("maquina", mach);
  if (!novoToken.isEmpty()) prefs.putString("api_token", novoToken);
  prefs.end();
  enviarResposta(true, 200);
  Serial.printf("[CONFIG] Maquina %lu / ESP32 %s. Reiniciando...\n", (unsigned long)mach, disp.c_str());
  reiniciarEm = millis() + 1800;
}

void statusJson() {
  JsonDocument doc;
  doc["ok"] = true;
  doc["versao"] = APP_VERSION;
  doc["cod_maquina"] = maquina;
  doc["dispositivo_id"] = deviceId;
  doc["ssid"] = wifiSsid;
  doc["wifi_conectado"] = WiFi.status() == WL_CONNECTED;
  doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  doc["ap_ativo"] = apLigado;
  doc["ads_ok"] = adsOk;
  doc["corrente_a"] = corrente;
  doc["referencia_v"] = referencia;
  doc["uptime_ms"] = millis();
  doc["contagem_ativa"] = false;
  doc["captura_ativa"] = capturaAtiva;
  doc["captura_amostras"] = numeroPontos;
  doc["captura_pronta"] = capturaPronta;
  doc["calibracao_valida"] = calibracaoValida;
  doc["calibracao_versao"] = versaoCalibracao;
  doc["estado"] = estadoConfirmado >= 0 ? NOMES_ESTADOS[estadoConfirmado] : "";
  doc["status_calibracao"] = statusCalibracao;
  doc["ultimo_http_calibracao"] = ultimoHttpCalibracao;
  doc["token_configurado"] = apiToken.length() >= 43;
  doc["status_nuvem"] = statusNuvem;
  doc["ultimo_http"] = ultimoHttp;
  doc["ultima_conexao_api_ms"] = ultimaConexaoApi;
  String resp;
  serializeJson(doc, resp);
  server.send(200, "application/json; charset=utf-8", resp);
}

void ativarAP() {
  if (apLigado) return;
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(apName.c_str(), setupPass.c_str())) {
    Serial.println("[ERRO] Nao foi possivel ativar o Wi-Fi de configuracao."); return;
  }
  apLigado = true;
  Serial.println("=======================================");
  Serial.println("  CONFIGURACAO WIFI DO SENSOR");
  Serial.printf("  REDE:  %s\n", apName.c_str());
  Serial.printf("  SENHA: %s\n", setupPass.c_str());
  Serial.printf("  ABRIR: http://%s\n", WiFi.softAPIP().toString().c_str());
  Serial.println("=======================================");
}

void iniciarWifi() {
  if (wifiSsid.isEmpty()) {
    Serial.println("[WIFI] Primeira configuracao: abrindo Wi-Fi temporario.");
    ativarAP(); return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  Serial.printf("[WIFI] Tentando conectar a %s", wifiSsid.c_str());
  uint32_t t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS) {
    delay(300);Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] Conectado. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WIFI] Nao conectou. Abrindo rede temporaria para recuperar.");
    ativarAP();
  }
}

void fazerMedicao(uint16_t quantidadeAmostras = SAMPLE_COUNT) {
  if (!adsOk) return;
  // 170 amostras @ 860 SPS percorrem varios periodos de uma rede de 50/60 Hz.
  // Welford remove a componente continua de ~1.65 V, deixando apenas o AC RMS.
  double media = 0.0, m2 = 0.0;
  for (int i = 1; i <= quantidadeAmostras; i++) {
    const int16_t adc = ads.readADC_SingleEnded(0);
    const double v = (double)ads.computeVolts(adc);
    double delta = v - media;
    media += delta / i;
    m2 += delta * (v - media);
  }
  const double vrms = sqrt(m2 / quantidadeAmostras);
  corrente = (float)(vrms * AMP_PER_VRMS);
  referencia = (float)media;
  // A medicao sem carga tem pequeno ruido natural, nao impor zero artificial.
  if (!isfinite(corrente) || corrente < 0 || corrente > 1000) {
    adsOk = false; corrente = 0;
    Serial.println("[ADS] Medicao invalida, verifique sensor/ligacoes.");
  }
}


// Acoes dos LEDs sao limitadas aos estados realmente reconhecidos.
// LED azul fica reservado para inspecao, que NAO esta habilitada na V13.
void atualizarLeds() {
  digitalWrite(PIN_LED_VERMELHO, estadoConfirmado == 0 ? HIGH : LOW);
  digitalWrite(PIN_LED_AMARELO, (estadoConfirmado == 1 || estadoConfirmado == 2) ? HIGH : LOW);
  digitalWrite(PIN_LED_VERDE, estadoConfirmado == 3 ? HIGH : LOW);
  digitalWrite(PIN_LED_AZUL, LOW);
}

void testeInicialLeds() {
  Serial.println("[LED] Testando vermelho, amarelo, verde, azul em sequencia.");
  const uint8_t leds[] = {PIN_LED_VERMELHO, PIN_LED_AMARELO, PIN_LED_VERDE, PIN_LED_AZUL};
  for (uint8_t pin : leds) {
    digitalWrite(pin, HIGH);
    delay(350);
    digitalWrite(pin, LOW);
    delay(120);
  }
}

int indiceEstado(const String &nome) {
  for (int i = 0; i < 4; ++i) if (nome == NOMES_ESTADOS[i]) return i;
  return -1;
}

// Aplica uma configuracao somente se TODOS os campos forem validos.
// A nuvem continua como fonte, e a ultima versao boa fica na NVS para uso offline.
bool aplicarCalibracao(const String &json, uint32_t versao, bool gravarNvs) {
  if (json.isEmpty() || json.length() > 4096 || versao == 0) return false;
  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) return false;
  JsonVariantConst cfg = doc.as<JsonVariantConst>();
  JsonVariantConst grupo = cfg["estados"];
  if (grupo.isNull()) return false;
  Faixa temporarias[4];
  for (int i = 0; i < 4; ++i) {
    JsonVariantConst faixa = grupo[NOMES_ESTADOS[i]];
    if (faixa.isNull() || faixa["min_a"].isNull() || faixa["max_a"].isNull()) return false;
    float vmin = faixa["min_a"].as<float>();
    float vmax = faixa["max_a"].as<float>();
    if (!isfinite(vmin) || !isfinite(vmax) || vmin < 0 || vmax > 1000 || vmin >= vmax) return false;
    temporarias[i] = {vmin, vmax};
  }
  // Proibe faixas que se sobrepoem. Encostar nos limites nao gera um estado unico.
  for (int a = 0; a < 4; ++a) for (int b = a+1; b < 4; ++b) {
    if (min(temporarias[a].maximo, temporarias[b].maximo) >
        max(temporarias[a].minimo, temporarias[b].minimo)) return false;
  }
  int tempo = cfg["tempo_minimo_ms"].as<int>();
  if (tempo < 50 || tempo > 30000) return false;
  JsonArrayConst steps = cfg["sequencia"].as<JsonArrayConst>();
  if (steps.isNull() || steps.size() < 2 || steps.size() > 12) return false;
  uint8_t seqTmp[12] = {};
  uint8_t size = 0;
  for (JsonVariantConst step : steps) {
    const int idx = indiceEstado(step.as<String>());
    if (idx < 0) return false;
    seqTmp[size++] = (uint8_t)idx;
  }

  for (int i = 0; i < 4; ++i) faixas[i] = temporarias[i];
  for (int i = 0; i < size; ++i) sequenciaSalva[i] = seqTmp[i];
  comprimentoSequencia = size;
  tempoMinimoMs = (uint32_t)tempo;
  versaoCalibracao = versao;
  calibracaoValida = true;
  estadoConfirmado = -1;
  estadoCandidato = -1;
  candidatoDesde = millis();
  atualizarLeds();
  if (gravarNvs) {
    prefs.begin("auvriun", false);
    prefs.putString("cal_json", json);
    prefs.putUInt("cal_ver", versao);
    prefs.end();
  }
  Serial.printf("[CAL] Calibracao versao %lu aplicada (%s).\n", (unsigned long)versao, gravarNvs?"nuvem":"memoria local");
  return true;
}

void desligarCalibracao(bool limparCache) {
  calibracaoValida = false;
  versaoCalibracao = 0;
  estadoConfirmado = -1;
  estadoCandidato = -1;
  atualizarLeds();
  if (limparCache) {
    prefs.begin("auvriun", false);
    prefs.remove("cal_json");
    prefs.remove("cal_ver");
    prefs.end();
  }
}

int reconhecerEstado(float amperes) {
  if (!calibracaoValida || !adsOk) return -1;
  int encontrado = -1;
  for (int i = 0; i < 4; ++i) {
    if (amperes >= faixas[i].minimo && amperes <= faixas[i].maximo) {
      if (encontrado >= 0) return -1;  // Corrente ambigua.
      encontrado = i;
    }
  }
  return encontrado;
}

void atualizarEstado() {
  const int lido = reconhecerEstado(corrente);
  uint32_t agora = millis();
  if (lido != estadoCandidato) {estadoCandidato = lido; candidatoDesde = agora;}
  if (lido < 0) {
    if (estadoConfirmado != -1) {
      estadoConfirmado = -1;
      atualizarLeds();
      Serial.println("[ESTADO] Corrente fora de qualquer faixa calibrada. LEDs apagados.");
    }
    return;
  }
  if ((agora - candidatoDesde) < tempoMinimoMs) return;
  if (estadoConfirmado != lido) {
    estadoConfirmado = lido;
    atualizarLeds();
    Serial.printf("[ESTADO] %s | %.3f A\n", NOMES_ESTADOS[estadoConfirmado], corrente);
  }
}

void sincronizarCalibracao() {
  if (maquina == 0 || !dispositivoValido(deviceId) || apiToken.length() < 43 || WiFi.status() != WL_CONNECTED) return;
  if (time(nullptr) < 1735689600) {statusCalibracao = "Aguardando hora NTP"; return;}
  WiFiClientSecure client;
  client.setCACert(CA_CERTS);
  client.setTimeout(8);
  HTTPClient http;
  http.setTimeout(8000);
  http.setReuse(false);
  const String url = String(API_CALIBRACAO) + "?cod_maquina=" + String(maquina);
  if (!http.begin(client, url)) {statusCalibracao = "Falha ao iniciar HTTPS"; return;}
  http.addHeader("Authorization", String("Bearer ") + apiToken);
  const int code = http.GET();
  ultimoHttpCalibracao = code;
  if (code == 200) {
    const String resposta = http.getString();
    JsonDocument payload;
    if (deserializeJson(payload, resposta) == DeserializationError::Ok && payload["ok"].as<bool>()) {
      JsonVariantConst sensor = payload["sensor"];
      if (sensor.isNull() || sensor["dispositivo_id"].as<String>() != deviceId) {
        statusCalibracao = "Sensor/identificador divergente";
      } else if (!payload["configurado"].as<bool>() || sensor["calibracao"].isNull()) {
        if (calibracaoValida) desligarCalibracao(true);
        statusCalibracao = "Sem calibracao salva na web";
        Serial.println("[CAL] Aguardando calibracao pela pagina web.");
      } else {
        const uint32_t v = sensor["versao"].as<uint32_t>();
        if (v == versaoCalibracao && calibracaoValida) {
          statusCalibracao = "Sincronizada com a nuvem";
        } else {
          String calib;
          serializeJson(sensor["calibracao"], calib);
          if (aplicarCalibracao(calib, v, true)) statusCalibracao = "Sincronizada com a nuvem";
          else statusCalibracao = "Calibracao remota invalida (mantida a ultima versao local)";
        }
      }
    } else statusCalibracao = "JSON de calibracao invalido";
  } else if (code == 401) statusCalibracao = "Chave rejeitada na consulta de calibracao";
  else if (code < 0) statusCalibracao = "Cloudflare indisponivel (cache local preservado)";
  else statusCalibracao = String("HTTP ") + code + " na consulta de calibracao";
  http.end();
  Serial.printf("[CAL] HTTP %d | %s\n", ultimoHttpCalibracao, statusCalibracao.c_str());
}


void iniciarCapturaLocal() {
  if (!chamadaPeloAP()) { enviarResposta(false,403,"Conecte na rede temporaria AUVRIUN para controlar a captura."); return; }
  if (!adsOk) { enviarResposta(false,503,"ADS1115 indisponivel."); return; }
  numeroPontos = 0;
  inicioCaptura = millis();
  capturaAtiva = true;
  capturaPronta = false;
  ultimaMedicao = millis() - CAPTURA_PERIODO_MS;
  Serial.println("[CAPTURA] Inicio da gravacao rapida. Execute 3 ciclos e finalize.");
  enviarResposta(true,200);
}
void pararCapturaLocal() {
  if (!chamadaPeloAP()) { enviarResposta(false,403,"Conecte na rede temporaria AUVRIUN."); return; }
  capturaAtiva = false;
  capturaPronta = numeroPontos >= 20;
  Serial.printf("[CAPTURA] Fim. %u leituras gravadas.\n",(unsigned)numeroPontos);
  enviarResposta(true,200);
}
void baixarCapturaLocal() {
  if (!chamadaPeloAP()) { enviarResposta(false,403,"Acesso permitido somente pela rede temporaria AUVRIUN."); return; }
  if (capturaAtiva) { enviarResposta(false,409,"Finalize a captura antes de baixar."); return; }
  if (!capturaPronta || numeroPontos < 20) { enviarResposta(false,422,"Menos de 20 leituras disponiveis."); return; }
  String arquivo = String("ANFEER_maquina") + String(maquina) + "_captura.json";
  server.sendHeader("Content-Disposition", String("attachment; filename=\"") + arquivo + "\"");
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200,"application/json; charset=utf-8","");
  server.sendContent(String("{\"formato\":\"ANFEER_CAPTURA_V1\",\"cod_maquina\":") + String(maquina) +
    ",\"dispositivo_id\":\"" + deviceId + "\""+
    ",\"pontos\":[");
  String buffer;
  buffer.reserve(950);
  for (size_t i=0; i<numeroPontos; ++i) {
    char trecho[55];
    snprintf(trecho,sizeof(trecho),"%s{\"t_ms\":%lu,\"corrente_a\":%.3f}",
        i ? "," : "",(unsigned long)pontosCaptura[i].t_ms,pontosCaptura[i].corrente_a);
    if (buffer.length()+strlen(trecho) > 900) {server.sendContent(buffer);buffer="";}
    buffer += trecho;
    if (i % 60 == 0) yield();
  }
  if (buffer.length()) server.sendContent(buffer);
  server.sendContent("]}");
  server.sendContent("");
  Serial.println("[CAPTURA] JSON disponibilizado ao celular.");
}
void verificarBotao() {
  if (digitalRead(PIN_RECUPERAR) == LOW) {
    if (botaoDesde == 0) botaoDesde = millis();
    else if (!recuperacaoJaAcionada && millis() - botaoDesde >= RECUPERACAO_MS) {
      recuperacaoJaAcionada = true;
      Serial.println("[BOTAO] Recuperacao Wi-Fi solicitada.");
      ativarAP();
    }
  } else {botaoDesde = 0; recuperacaoJaAcionada = false;}
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ANFEER/AUVRIUN] Firmware V14 - captura local rapida.");
  for (uint8_t pin: {PIN_LED_VERMELHO,PIN_LED_AMARELO,PIN_LED_VERDE,PIN_LED_AZUL}) {
    pinMode(pin, OUTPUT); digitalWrite(pin, LOW);
  }
  testeInicialLeds();
  pinMode(PIN_RECUPERAR, INPUT_PULLUP);
  prefs.begin("auvriun", false);
  wifiSsid = prefs.getString("ssid", "");
  wifiPass = prefs.getString("wifipass", "");
  deviceId = prefs.getString("deviceid", "");
  maquina = prefs.getUInt("maquina", 0);
  apiToken = prefs.getString("api_token", "");
  setupPass = prefs.getString("ap_pass", "");
  String calPersistida = prefs.getString("cal_json", "");
  uint32_t versaoPersistida = prefs.getUInt("cal_ver", 0);
  if (setupPass.length() < 12) {
    setupPass = criarSenha(); prefs.putString("ap_pass", setupPass);
  }
  prefs.end();
  if (!calPersistida.isEmpty() && versaoPersistida > 0) {
    if (aplicarCalibracao(calPersistida, versaoPersistida, false))
      statusCalibracao = "Carregada do cache local; aguardando nuvem";
    else Serial.println("[CAL] Cache local invalido. Esperando nova calibracao.");
  }
  apName = "AUVRIUN-SENSOR-" + sufixoMac();

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000);
  adsOk = ads.begin(ADS_I2C, &Wire);
  if (adsOk) {
    ads.setGain(GAIN_ONE);
    ads.setDataRate(RATE_ADS1115_860SPS);
    Serial.println("[ADS] ADS1115 encontrado no endereco 0x48.");
  } else Serial.println("[ADS] ADS1115 nao encontrado. Revise fios/energia.");

  iniciarWifi();
  if (WiFi.status() == WL_CONNECTED) configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  server.on("/", HTTP_GET, []() {
    if (!chamadaPeloAP()) {server.send(403, "text/plain; charset=utf-8", "Abra a configuracao via Wi-Fi AUVRIUN-SENSOR-... no endereco 192.168.4.1");return;}
    server.send_P(200, "text/html; charset=utf-8", PAGINA);
  });
  server.on("/api/status", HTTP_GET, statusJson);
  server.on("/salvar", HTTP_POST, salvarConfiguracao);
  server.on("/api/captura/iniciar", HTTP_POST, iniciarCapturaLocal);
  server.on("/api/captura/parar", HTTP_POST, pararCapturaLocal);
  server.on("/api/captura/dados", HTTP_GET, baixarCapturaLocal);
  server.onNotFound([](){server.send(404,"text/plain; charset=utf-8","Pagina nao encontrada");});
  server.begin();
  Serial.println("[HTTP] Servidor de configuracao iniciado.");
  Serial.println("[OBS] Telemetria/estados ativos. Contagem de ciclos e inspecao seguem DESATIVADAS.");
}

void enviarLeituraCloudflare() {
  if (!adsOk || maquina == 0 || !dispositivoValido(deviceId) || apiToken.length() < 43) {
    statusNuvem = "Aguardando maquina / identificador / chave";
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {statusNuvem = "Wi-Fi desconectado"; return;}
  // Valida o certificado HTTPS com o relogio do ESP32 sincronizado por NTP.
  if (time(nullptr) < 1735689600) {statusNuvem = "Aguardando horario NTP"; return;}
  if (!isfinite(corrente) || corrente < 0 || corrente > 1000) {
    statusNuvem = "Corrente invalida";return;
  }

  JsonDocument doc;
  doc["dispositivo_id"] = deviceId;
  doc["cod_maquina"] = maquina;
  doc["corrente_a"] = roundf(corrente * 1000.0f) / 1000.0f;
  if (calibracaoValida && estadoConfirmado >= 0) doc["estado"] = NOMES_ESTADOS[estadoConfirmado];
  // Sem calibracao ou fora de faixa nao inventar um estado.
  String body;
  serializeJson(doc, body);

  WiFiClientSecure client;
  client.setCACert(CA_CERTS);
  client.setTimeout(8);
  HTTPClient http;
  http.setTimeout(8000);
  http.setReuse(false);
  if (!http.begin(client, API_LEITURAS)) {
    statusNuvem = "Falha ao iniciar HTTPS";return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + apiToken);
  const int code = http.POST(body);
  ultimoHttp = code;
  if (code == 201) {
    const String resposta = http.getString();
    JsonDocument respostaJson;
    if (deserializeJson(respostaJson, resposta) == DeserializationError::Ok && respostaJson["ok"].as<bool>()) {
      ultimaConexaoApi = millis();
      statusNuvem = "Leitura recebida pela API";
    } else statusNuvem = "Resposta inesperada da API";
  } else if (code == 401) statusNuvem = "Chave recusada: conferir cadastro ou token";
  else if (code == 403) statusNuvem = "Dispositivo nao vinculado a esta maquina";
  else if (code < 0) statusNuvem = String("HTTPS falhou: ") + HTTPClient::errorToString(code);
  else statusNuvem = String("Erro HTTP ") + code;
  http.end();
  Serial.printf("[NUVEM] HTTP %d | %s\n", ultimoHttp, statusNuvem.c_str());
  // Por seguranca, nao imprimir o token nem dados secretos no serial.
}

void loop() {
  server.handleClient();
  verificarBotao();
  if (reiniciarEm && (int32_t)(millis() - reiniciarEm) >= 0) ESP.restart();
  if (adsOk && millis() - ultimaMedicao >= (capturaAtiva ? CAPTURA_PERIODO_MS : SAMPLE_PERIOD_MS)) {
    ultimaMedicao = millis();
    fazerMedicao(capturaAtiva ? CAPTURA_ADC_AMOSTRAS : SAMPLE_COUNT);
    atualizarEstado();
    if (capturaAtiva && adsOk && isfinite(corrente)) {
      if (numeroPontos < CAPTURA_MAX_PONTOS) {
        pontosCaptura[numeroPontos++] = {millis() - inicioCaptura, corrente};
      } else {
        capturaAtiva = false;
        capturaPronta = true;
        Serial.println("[CAPTURA] Limite de 1500 leituras. Baixe o JSON.");
      }
    }
    if (!capturaAtiva || numeroPontos % 15 == 0)
      Serial.printf("[CORRENTE] %.2f A | referencia %.3f V | ADS %s | WIFI %s | captura %u\n",
        corrente, referencia, adsOk?"OK":"FALHOU", WiFi.status()==WL_CONNECTED?"OK":"OFFLINE", (unsigned)numeroPontos);
  }
  // Baixa a configuracao ao iniciar e depois a cada minuto. Falhas preservam cache.
  // HTTPS e bloqueante: contagem de ciclos continuara DESATIVADA nesta etapa.
  if (!capturaAtiva && WiFi.status() == WL_CONNECTED && (ultimaConsultaCalibracao == 0 || millis() - ultimaConsultaCalibracao >= REVISAR_CALIBRACAO_MS)) {
    ultimaConsultaCalibracao = millis();
    sincronizarCalibracao();
  }
  // Nao fazer HTTPS no meio da medicao: evita corromper o RMS.
  if (!capturaAtiva && millis() - ultimoEnvio >= TELEMETRIA_MS) {
    ultimoEnvio = millis();
    enviarLeituraCloudflare();
  }
  if (!adsOk && millis() - ultimaTentativaAds > 30000) {
    ultimaTentativaAds = millis();
    adsOk = ads.begin(ADS_I2C, &Wire);
    if (adsOk) {ads.setGain(GAIN_ONE);ads.setDataRate(RATE_ADS1115_860SPS);}
    else {estadoConfirmado = -1;estadoCandidato = -1;atualizarLeds();}
  }
  if (!wifiSsid.isEmpty() && WiFi.status() != WL_CONNECTED && millis() - ultimaTentativaWifi > 15000) {
    ultimaTentativaWifi = millis();WiFi.reconnect();
    if (WiFi.status() == WL_CONNECTED) configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
    if (!apLigado && millis() > 120000) ativarAP();
  }
  delay(capturaAtiva ? 1 : 5);
}