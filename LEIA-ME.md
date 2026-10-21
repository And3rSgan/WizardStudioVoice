# WizardStudioVoice

Clonagem de voz, criação de vozes, dublagem e transcrição — rodando 100% no seu PC.
Versão personalizada do VoiceStudio (open source, licença AGPL-3.0), sem propagandas e sem telemetria.

## Instalar (primeira vez)

1. Feche o VoiceStudio antigo, se estiver aberto.
2. Dê dois cliques em **`INSTALAR-WizardStudioVoice.cmd`**.
3. Aguarde. Na primeira vez ele instala o que faltar (Node.js, Bun, uv/Python),
   baixa o PyTorch e as bibliotecas de voz (vários GB) e compila o app.
4. No final ele cria o atalho **WizardStudioVoice** na Área de Trabalho e no Menu Iniciar.

## Usar no dia a dia

- Abra pelo atalho **WizardStudioVoice** (ou dois cliques em `INICIAR-WizardStudioVoice.vbs`).
- O primeiro início demora um pouco (o motor de voz carrega). Depois é rápido.
- Se não abrir, veja o arquivo `logs\ultimo-inicio.log`.

## Depois de mexer no código

Rode `INSTALAR-WizardStudioVoice.cmd` de novo — ele só recompila e refaz os atalhos.

Para desenvolver com recarga automática: abra o PowerShell nesta pasta e rode `bun run dev`.

## Onde ficam suas vozes

- Vozes, projetos e configurações: `%APPDATA%\OmniVoice`
- Modelos baixados: `%LOCALAPPDATA%\OmniVoice\hf_cache`

Essas pastas são as mesmas do VoiceStudio antigo, então as vozes já clonadas continuam aparecendo.
Ao desinstalar o VoiceStudio antigo, **não** apague essas pastas.
A pasta `%APPDATA%\VoiceStudio\runtime` (ambiente Python do app antigo, vários GB) pode ser apagada
depois que o WizardStudioVoice estiver funcionando.

## O que foi alterado em relação ao original

- Nome do app: VoiceStudio → WizardStudioVoice (janela, menus e textos em todos os idiomas).
- Removido: rodapé de patrocinadores/“anuncie aqui”, botão “Get Pro”, estrela do GitHub,
  página de planos Pro, página de doações, pedidos de doação, avatares de contribuidores na tela inicial.
- Telemetria (PostHog) desligada.
- Ícone novo do WizardStudioVoice (janela, barra de tarefas, bandeja, atalhos e dentro do app).
- Idioma **Português (Brasil)** adicionado: mesmo modelo de voz, mas números e porcentagens são lidos no padrão brasileiro (dezesseis, dezenove, bilhões).
- Atualização automática não acontece (o app roda do código-fonte, então nunca é sobrescrito pela versão oficial).
- Os arquivos originais de tudo que foi alterado estão em `_original_backup\`.

## Gerar por partes (estilo ElevenLabs)

Na tela **Clonar**, a chave **Gerar por partes** (ligada por padrão) divide o roteiro em partes
(por parágrafo ou por frase). Cada parte é gerada separadamente, com o progresso de cada uma na aba
**Partes**. No final tudo é juntado num único arquivo, que aparece em "Última tomada" para baixar.

- Dá para ouvir e **refazer só uma parte** (botão ↺), e ele junta tudo de novo sozinho.
- Se você mudar o texto e gerar de novo, só as partes que mudaram são refeitas.
- As partes não entram no histórico de tomadas, só o arquivo final entra.

## Gerar o instalador .exe para outras pessoas

O instalador é gerado pelo GitHub (GitHub Actions), não no seu PC.

1. Dê dois cliques em **`PUBLICAR-NO-GITHUB.cmd`** (envia suas alterações para o GitHub).
2. Abra https://github.com/And3rSgan/WizardStudioVoice/actions → **Gerar instalador Windows** → **Run workflow**.
3. Em uns 15–25 minutos o arquivo `WizardStudioVoice-Setup-<versão>-win-x64.exe` aparece em
   **Releases** (https://github.com/And3rSgan/WizardStudioVoice/releases). Esse link pode ser compartilhado.

Quem instalar: na primeira abertura o app baixa o motor de voz (alguns GB). O instalador não é
assinado, então o Windows pode avisar "O Windows protegeu o computador" → **Mais informações** →
**Executar assim mesmo**. A versão instalada não se atualiza sozinha pela versão oficial do VoiceStudio.

## Licença

Baseado no VoiceStudio © Palash Debnath e colaboradores, licença GNU AGPL-3.0 (ver `LICENSE` e `LICENSE-NOTICE.md`).
O modelo padrão k2-fsa/OmniVoice tem pesos sob licença CC-BY-NC (uso não comercial).
