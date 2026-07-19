# 🏭 SpindleOps — Guia do Primeiro Teste de Campo

Este guia leva você do zero até ver uma máquina CNC real aparecendo no dashboard.
Siga na ordem, sem pular etapas. Cada comando deve ser digitado exatamente como mostrado.

> **⚠️ IMPORTANTE — faça as Partes 1 a 5 ANTES de ir à fábrica**, em casa ou no
> escritório, com internet boa. A instalação baixa vários arquivos grandes.
> Na fábrica você só fará a Parte 6 (conectar as máquinas), que não precisa de internet.

---

## Parte 0 — O que você precisa

**O computador do teste:**
- Windows 10 ou 11 (64 bits), com pelo menos 8 GB de memória
- Você precisa ser administrador do computador (poder instalar programas)
- Uma entrada de rede (cabo) para ligar na rede das máquinas

**Informações para conseguir com o cliente/manutenção ANTES do teste** (isso é o mais importante do guia):

| # | Informação | Com quem conseguir |
|---|---|---|
| 1 | Marca e modelo do CNC de cada máquina (ex.: Fanuc 0i-MF, Siemens 828D) | Manutenção |
| 2 | O endereço IP de cada máquina na rede (ex.: 192.168.1.101) | Manutenção ou TI |
| 3 | **Fanuc**: confirmar que a opção "FOCAS2 / Ethernet" está habilitada no CNC | Manutenção (sem isso, Fanuc não conecta — é o risco nº 1 do teste) |
| 4 | **Siemens**: usuário e senha do servidor OPC-UA | Manutenção |
| 5 | Liberação do firewall/rede para o seu computador falar com as máquinas | TI |

---

## Parte 1 — Instalar os programas (só na primeira vez)

Instale os 3 programas abaixo, nesta ordem. Em todos, pode aceitar as opções padrão
(ir clicando em "Next/Avançar" até o fim).

1. **Git** — baixe em https://git-scm.com/download/win e instale.
2. **Node.js** — baixe em https://nodejs.org (clique no botão verde escrito **LTS**) e instale.
3. **Docker Desktop** — baixe em https://www.docker.com/products/docker-desktop e instale.
   - Se aparecer uma pergunta sobre **WSL 2**, aceite/instale.
   - O instalador pode pedir para **reiniciar o computador** — reinicie.
   - Depois de reiniciar, **abra o programa "Docker Desktop"** e espere o ícone da
     baleia (canto inferior esquerdo da janela) ficar **verde**. Isso pode levar 2 minutos.

**Conferindo se deu certo:** abra o menu Iniciar, digite `powershell`, abra o
**Windows PowerShell** e digite os 3 comandos abaixo (um por vez, apertando Enter):

```
git --version
node --version
docker --version
```

Cada um deve responder com um número de versão. Se algum responder
"não é reconhecido", feche o PowerShell, abra de novo e tente outra vez.
Se ainda falhar, reinstale aquele programa.

---

## Parte 2 — Baixar o sistema

No mesmo PowerShell, digite (um comando por vez):

```
cd Desktop
git clone https://github.com/jusales3270/spindleops.git
cd spindleops\spindleops
```

Pronto — o sistema está numa pasta chamada `spindleops` na sua Área de Trabalho.

---

## Parte 3 — Configurar (só na primeira vez)

Ainda no PowerShell:

```
cd backend
copy .env.example .env
notepad .env
```

O Bloco de Notas vai abrir. Só uma coisa a fazer nele: na linha
`SPINDLEOPS_SERVICE_TOKEN=troque-por-uma-senha-qualquer`, troque o texto depois do `=`
por qualquer palavra/frase sua (sem espaços). Salve (Ctrl+S) e feche.

Agora instale as dependências e monte os módulos de comunicação
(**este passo demora alguns minutos e precisa de internet** — é ele que você
deve fazer antes de ir à fábrica):

```
npm install
docker compose up -d --build
```

**Conferindo:** digite `docker compose ps` — deve listar 8 serviços, todos com
status começando com **"Up"** (focas, s7, opcua, modbus, heidenhain, mtconnect,
mitsubishi, mazak).

Falta instalar a parte visual (ainda no PowerShell):

```
cd ..\frontend
npm install
```

---

## Parte 4 — Ligar o sistema (toda vez que for usar)

O sistema tem 2 partes e cada uma fica rodando numa janela própria do PowerShell.
**As duas janelas precisam ficar abertas** enquanto o sistema estiver em uso.

**Antes de tudo:** abra o **Docker Desktop** e espere a baleia ficar verde
(os 8 módulos sobem sozinhos com ele).

**Janela 1 — o cérebro (backend):** abra um PowerShell e digite:

```
cd Desktop\spindleops\spindleops\backend
node server.js
```

Deve aparecer: `⚙ SpindleOps backend rodando em http://localhost:3002`. Deixe aberta.

**Janela 2 — a tela (dashboard):** abra OUTRO PowerShell (menu Iniciar → powershell de novo) e digite:

```
cd Desktop\spindleops\spindleops\frontend
npm start
```

Depois de ~1 minuto, o navegador abre sozinho com o dashboard
(se não abrir, entre em **http://localhost:3000**).

---

## Parte 5 — Conferir que está tudo funcionando

No dashboard você deve ver o card **"Simulador (testes)"** com números mudando
(RPM, carga, ferramenta T1–T8...). Se o simulador está se mexendo, **o sistema
está 100% funcional** — qualquer problema daqui pra frente é de rede/máquina, não do sistema.

Clique no card do simulador para ver o painel de detalhe (ferramenta, modo,
posição dos eixos) e visite as abas **Histórico** e **Configurações** para se familiarizar.

---

## Parte 6 — Conectar a primeira máquina real (na fábrica)

### 6.1 Ligue o computador na rede das máquinas
Conecte o cabo de rede. Peça à TI para confirmar que você recebeu um IP da mesma
rede das máquinas.

### 6.2 Teste se a máquina responde
No PowerShell (pode ser uma 3ª janela), digite (troque pelo IP real da máquina):

```
ping 192.168.1.101
```

- **"Resposta de..."** = a máquina está acessível. Siga em frente. ✅
- **"Esgotado o tempo limite"** = problema de rede/firewall. Chame a TI antes de continuar. ❌

### 6.3 Cadastre a máquina no dashboard
No dashboard, vá em **Configurações → Adicionar máquina** e preencha:

- **ID único**: um apelido curto, ex.: `cnc-01`
- **Nome**: o nome que aparecerá na tela, ex.: `Centro de Usinagem 01`
- **Protocolo e Porta** — escolha pela marca do CNC (a porta preenche sozinha):

| Marca do CNC | Protocolo a escolher | Porta |
|---|---|---|
| Fanuc (qualquer série i) | Fanuc FOCAS2 | 8193 |
| Siemens 840D / 828D | Siemens OPC-UA | 4840 |
| Heidenhain (TNC) | Heidenhain LSV2 | 19000 |
| Mazak (Smooth/Matrix) | Mazak (descoberta automática) | 5000 |
| Okuma / Haas / DMG modernos | MTConnect | 5000 |
| Mitsubishi (M7/M8) | Mitsubishi MC Protocol | 5007 |
| CLP / retrofit genérico | Modbus TCP | 502 |

- **Endereço IP**: o IP da máquina (o mesmo do ping)
- **Siemens apenas**: preencha os campos **Usuário OPC-UA** e **Senha OPC-UA**
- Clique em **Salvar**

### 6.4 Teste a conexão
No card da máquina recém-criada (em Configurações), clique em **Testar**.

- **✓ verde com os milissegundos** = CONECTOU! Volte ao Dashboard e veja os dados reais chegando. 🎉
- **✗ vermelho** = veja a tabela da Parte 7.

### 6.5 Confira se os números fazem sentido
Com a máquina usinando, compare o que o dashboard mostra com o painel do CNC:
RPM parecido? Programa certo? Status certo? **Anote qualquer número estranho**
(ex.: "RPM mostra 0 mas a máquina está girando") — isso é informação valiosa de ajuste.

---

## Parte 7 — Se algo der errado

| O que aparece | Causa provável | O que fazer |
|---|---|---|
| Ping não responde | Computador em outra rede, ou firewall | Chamar a TI: liberar as portas da tabela 6.3 |
| Fanuc: ✗ ao testar, mas ping OK | Opção FOCAS2 não habilitada no CNC | Manutenção precisa habilitar (pode exigir código da Fanuc) |
| Siemens: erro com "BadUserAccessDenied" | Usuário/senha OPC-UA errados | Confirmar credenciais com a manutenção |
| Siemens: conecta mas quase tudo "—" | Endereços internos variam por versão | Normal no 1º teste — anote e me traga |
| Card fica "Offline" no dashboard | Módulos Docker não estão rodando | Abrir Docker Desktop, esperar baleia verde; conferir com `docker compose ps` |
| Dashboard não abre no navegador | As 2 janelas do PowerShell fecharam | Repetir Parte 4 |
| Números aparecem trocados/estranhos | Diferença de modelo do CNC | Anotar QUAL campo e QUAL valor — me traga |

**Se travar de vez:** feche as duas janelas do PowerShell e repita a Parte 4.

---

## Parte 8 — O que anotar e me trazer do teste

Para cada máquina testada, anote:

1. Marca + modelo do CNC e o protocolo usado
2. Conectou? (✓/✗) — se ✗, a mensagem de erro exata (foto da tela serve)
3. Quais campos vieram certos e quais vieram vazios ("—") ou estranhos
4. Foto da janela 1 (backend) se aparecer texto vermelho de erro

Com essas anotações eu ajusto o que for necessário — na maioria dos casos são
configurações, não código.

**Ao terminar o dia:** pode simplesmente fechar as janelas. Se quiser deixar
coletando dados, deixe tudo aberto — o histórico acumula sozinho.

Boa sorte no teste! 🚀
