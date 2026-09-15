# Estado da implementação

Atualizado em **14/09/2026**.

## Objetivo e limite deste checkpoint

Implementar um MVP web colaborativo para RH, substituindo planilhas de candidatos provenientes da Gupy. Cada linha representa uma candidatura vinculada a um candidato e a uma vaga. O produto deve oferecer autenticação, isolamento por organização, campos tipados, grade editável persistida, colaboração, concorrência otimista, importação CSV/XLSX, auditoria e dashboard.

**Estado geral: implementação parcial, ainda não validada de ponta a ponta e não pronta para produção.** Há código de frontend, backend, migração e testes unitários. A primeira execução da migração no PostgreSQL falhou. Não confundir código escrito com funcionalidade demonstrada.

Este checkpoint atende à instrução de criar somente este arquivo. Não corrige nem amplia a implementação. A continuação do desenvolvimento fica pausada após seu registro.

## Decisões arquiteturais tomadas

- **Stack:** Node.js, TypeScript com `strict: true`, pnpm, React/Vite, React Data Grid, Fastify, Zod, PostgreSQL, Kysely/`pg`, Keycloak e `openid-client`.
- **Estrutura:** pacote privado na raiz, com módulos em `src/server`, `src/shared` e `src/web`; API e worker possuem entradas separadas.
- **Identidade:** convite e senha via Keycloak/OIDC, PKCE, estado e nonce; sessão opaca armazenada no servidor, cookies HttpOnly e proteção CSRF. Papéis por organização ficam no banco da aplicação.
- **Permissões:** usuários consultam, criam e editam; administradores também gerenciam campos, vagas, membros, importações, exclusões e auditoria.
- **Modelo:** candidato, candidatura e vaga separados; contatos do candidato são compartilhados entre suas candidaturas. Campos configuráveis pertencem à candidatura.
- **Persistência híbrida:** entidades relacionais, valores configuráveis em colunas tipadas, seleções múltiplas em tabela associativa e definições em JSONB.
- **Isolamento:** referências compostas por organização e entidade, RLS nas tabelas de domínio e papel de aplicação sem superusuário, propriedade das tabelas ou BYPASSRLS.
- **Consultas:** paginação, busca, filtros e até três ordenações no servidor. Padrão de 50 linhas, máximo de 200.
- **Escritas:** controle por versão, identificador idempotente de operação, auditoria e outbox na mesma transação. Escritas usam bloqueio da organização; o impacto dessa serialização ainda precisa ser medido.
- **Colaboração:** HTTP para gravações; SSE e notificações PostgreSQL para invalidação. Reconexão e consulta periódica reconciliam a grade.
- **Grade:** edição de células, colagem TSV limitada à página e desfazer a última edição/lote da sessão com verificação de versões. Sem arraste, fórmulas ou edição offline.
- **Importação:** CSV/XLSX com prévia, mapeamento, validação e aplicação por linha. Parser isolado em worker thread; execução das linhas confirmadas por worker de aplicação.
- **Auditoria:** valores anteriores/novos criptografados com AES-256-GCM; logs técnicos sem corpos ou valores pessoais completos.
- **Integração:** interface `CandidateSource` e adaptador Gupy simulado; acesso real à Gupy não foi presumido.
- **Escala de referência:** até 10 organizações, 50 mil candidaturas e 20 editores simultâneos por organização. Capacidade ainda não demonstrada.
- **Dependências:** a implementação interpretou “Implement the plan” como aprovação das dependências propostas. Novas dependências de produção fora desse conjunto exigem confirmação.

## Arquivos criados ou modificados

Os arquivos da implementação permanecem **não rastreados no Git**; nenhum commit foi criado. `AGENTS.md` já existia quando esta implementação começou e foi preservado.

| Área | Arquivos |
| --- | --- |
| Projeto e dependências | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.gitignore` |
| Ferramentas | `tsconfig.json`, `tsconfig.server.json`, `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`, `index.html` |
| Regras compartilhadas | `src/shared/domain.ts`, `src/shared/clipboard.ts` |
| Configuração e persistência | `src/server/config.ts`, `src/server/db.ts`, `src/server/crypto.ts`, `src/server/migrate.ts`, `src/server/bootstrap.ts`, `migrations/001_initial.sql` |
| API e identidade | `src/server/main.ts`, `src/server/app.ts`, `src/server/auth.ts` |
| Domínio e colaboração | `src/server/records.ts`, `src/server/realtime.ts` |
| Importação e processamento | `src/server/imports.ts`, `src/server/parse-file.ts`, `src/server/worker.ts`, `src/server/worker-main.ts` |
| Interface | `src/web/main.tsx`, `src/web/App.tsx`, `src/web/screens.tsx`, `src/web/ui.tsx`, `src/web/api.ts`, `src/web/styles.css` |
| Testes e preparação | `tests/validation.test.ts`, `tests/import-parser.test.ts`, `scripts/setup-test-db.ts` |
| Este checkpoint | `IMPLEMENTATION_STATUS.md` |

Arquivos locais ignorados pelo Git: `.local/postgres-test.env` e `.local/test.env`, com credenciais temporárias geradas aleatoriamente. Não copiar seus conteúdos para documentação, logs ou commits.

## O que já foi concluído

### Preparação confirmada

- Inspeção do repositório e leitura das instruções existentes.
- Configuração inicial de TypeScript estrito, pnpm, ESLint, Vite e Vitest.
- Dependências presentes em `node_modules` e lockfile gerado; script de instalação do esbuild autorizado na configuração do pnpm.
- Docker confirmado disponível: versão do servidor `28.1.1` na última verificação operacional.
- Container temporário `codex-rh-postgres-test` iniciado com `postgres:16-alpine`, banco `rh_test` e porta publicada apenas em `127.0.0.1:55432`.
- **Lint deste checkpoint aprovado:** `pnpm lint`, saída 0. O lint não corrige arquivos automaticamente.

### Código escrito, ainda dependente de validação funcional

- Migração de organizações, vínculos, candidatos, vagas, candidaturas, campos, valores, importações, auditoria, outbox e RLS.
- Validação compartilhada dos 12 tipos, obrigatoriedade, padrões, limites e opções arquivadas.
- API de cadastro, edição em lote, consultas, exclusão lógica, restauração, campos, membros, convites, importação, auditoria, atividade e privacidade.
- Integração OIDC, sessão de servidor e fluxo de convite por Keycloak.
- Controle otimista de versões, idempotência, gravação auditada e desfazer protegido.
- Parser CSV/XLSX, limites de arquivos, rejeição de fórmulas, preparação de linhas, deduplicação por IDs externos e adaptador simulado.
- Worker de importação/outbox, SSE e rotinas de limpeza de dados temporários.
- Interface em português: login, grade, filtros, cadastro, conflitos, detalhes do registro, campos, vagas, membros, importações e atividade.
- Testes unitários escritos para tipos/validação, TSV, criptografia, parsers e fonte simulada. **Esses testes ainda não foram executados.**

## O que ainda falta implementar ou concluir

1. Corrigir a migração SQL e demonstrar a persistência com o papel restrito de aplicação.
2. Criar a suíte de integração com PostgreSQL real: autorização, RLS, concorrência, atomicidade, idempotência, importação, auditoria e eliminação de dados.
3. Criar configuração e cenários Playwright; o comando `test:e2e` existe, mas os testes de navegador ainda não.
4. Criar Dockerfile, Compose, configuração/importação do realm Keycloak, ambiente de exemplo, provisionamento de papéis e instruções de execução. Não há Keycloak do projeto provisionado ou validado.
5. Validar login, convite, recuperação de senha e revogação com o provedor real e SMTP de teste.
6. Executar build, checagem de tipos completa, testes e inspeção visual da interface; corrigir falhas encontradas.
7. Concluir e verificar os comportamentos ainda incompletos em relação ao plano:
   - distinguir importações sem alteração de atualizações efetivas;
   - testar reimportação, candidatos repetidos em vagas diferentes e mudanças entre prévia e confirmação;
   - avaliar mover a validação completa das importações para processamento assíncrono: hoje ela percorre as linhas dentro da requisição/transação;
   - implementar a aplicação efetiva de `RETENTION_DAYS` para a política aprovada; hoje existe configuração, limpeza de temporários e eliminação administrativa, mas não o ciclo completo de retenção dos candidatos;
   - completar cobertura de auditoria dos eventos relevantes de identidade e operação;
   - verificar filtros, ordenações e apresentação de datas conforme o fuso organizacional;
   - verificar recuperação de conflitos, preservação de rascunhos e desfazer após falhas de rede;
   - implementar e ensaiar procedimento de backup/restauração com reaplicação do registro de eliminações.
8. Produzir `README.md` e os 12 documentos solicitados em `docs/`: `product-brief.md`, `requirements.md`, `user-stories.md`, `architecture-options.md`, `data-model.md`, `realtime-and-conflicts.md`, `import-strategy.md`, `security-lgpd.md`, `risks-and-open-questions.md`, `implementation-roadmap.md`, `acceptance-criteria.md` e `adr/0001-technology-stack.md`. Nenhum desses documentos foi gravado ainda.
9. Medir o cenário de carga aprovado. Latência, capacidade e recuperação ainda não foram aferidas.

## Problemas encontrados

| Problema | Estado e consequência |
| --- | --- |
| Docker inicialmente inativo | Resolvido após o usuário iniciar o daemon; PostgreSQL temporário passou a usar Docker. |
| Tentativa de download PostgreSQL por apt | A tentativa inicial falhou por resolução de DNS. Não houve instalação local. O usuário proibiu novas tentativas via apt; usar somente Docker. Nenhum processo `apt-get download postgresql` foi encontrado na verificação posterior. |
| Restrições do sandbox | Instalação pnpm, acesso ao socket Docker e conexão TCP ao banco exigiram execução autorizada fora do sandbox. Não confundir essas falhas com defeitos da aplicação. |
| Instalação pnpm interrompida pelo esbuild | Script explicitamente autorizado em `pnpm-workspace.yaml`; sua execução posterior terminou com sucesso. |
| Erros iniciais de TypeScript | Referências possivelmente indefinidas em autenticação/bootstrap e tipo de retorno da importação foram corrigidos. A última checagem anterior aos novos testes não apontou erros; o estado atual completo ainda precisa ser rechecado. |
| Erro de lint por import não utilizado | Corrigido antes deste checkpoint. A execução atual de lint passou. |
| Migração inicial falhou | PostgreSQL retornou `42601: syntax error at end of input`, posição `4863`, ao executar `migrations/001_initial.sql`. O erro permanece sem correção. |
| Preparação do banco incompleta | `scripts/setup-test-db.ts` chegou à migração e falhou. A migração usa transação, portanto não considerar tabelas ou políticas aplicadas. A criação prévia do papel de teste pode ter persistido; conferir ao retomar. |
| Validação incompleta | Nenhum teste de integração/E2E nem fluxo completo com banco e identidade foi concluído. O build de produção não foi demonstrado. |
| Dependências com avisos | A instalação mostrou avisos de depreciação, inclusive ESLint e dependências transitivas do conjunto instalado. Revisão de manutenção/vulnerabilidades permanece pendente. |

Não há credenciais confirmadas da Gupy, política organizacional de retenção/base legal aprovada ou configuração final de publicação. Esses pontos bloqueiam seus respectivos usos em produção, não o desenvolvimento com dados sintéticos.

## Próximos passos exatos

Executar somente quando o usuário retomar a implementação:

1. Ler este arquivo e `AGENTS.md`; inspecionar `git status --short`. Preservar alterações do usuário e não instalar novas dependências de produção sem aprovação.
2. Verificar `docker info` e o estado de `codex-rh-postgres-test`. Reutilizar o container temporário se disponível. Não executar `apt-get` para PostgreSQL e não recriar credenciais locais sem necessidade.
3. Inspecionar o trecho da migração em torno da posição `4863`, especialmente a função de validação de tipos e seus blocos condicionais. Corrigir a sintaxe SQL e confirmar a aplicação transacional.
4. Reexecutar `node --env-file=.local/test.env --import tsx scripts/setup-test-db.ts` com acesso autorizado ao banco local. Confirmar tabelas, papel de aplicação restrito, grants e políticas RLS, sem imprimir credenciais.
5. Executar `pnpm typecheck`, `pnpm test`, `pnpm build` e `pnpm lint`. Incluir `scripts/` na cobertura de checagem de tipos, pois o `tsconfig.json` atual não inclui esse diretório. Corrigir as falhas antes de ampliar a validação.
6. Adicionar testes de integração usando duas organizações e usuários de papéis distintos. Verificar primeiro: isolamento, escrita persistida, duas gravações com a mesma versão, rollback de lote inválido e auditoria atômica.
7. Prover Keycloak e configuração de execução por Docker; testar identidade e conectar API, worker e frontend. Demonstrar cadastro/edição após recarregar e colaboração em duas sessões.
8. Testar importação CSV/XLSX, deduplicação, retomada do worker, conflitos e desfazer; concluir as lacunas listadas acima.
9. Adicionar E2E, verificar visualmente a grade e os fluxos administrativos, produzir os documentos e procedimentos operacionais.
10. Executar a validação final e atualizar este status com evidências reais, separando funcionalidades aprovadas de limitações e bloqueios de produção. Não publicar nem criar commits sem instrução pertinente.

## Correção de inicialização do login — 14/09/2026

- O erro de correlação `12e9171d-a83c-41ef-86ff-d507755a6c8e` ocorreu antes de o Keycloak concluir sua inicialização. Após a inicialização, `/auth/login` retornou 302 e a descoberta OIDC retornou 200.
- `compose.yaml` passou a verificar a descoberta OIDC e aguardar o Keycloak saudável antes de iniciar a aplicação. A correção foi aplicada à stack local sem apagar os volumes.
- `src/server/auth.ts` agora responde 503 com mensagem específica quando a descoberta está indisponível; novas tentativas repetem a descoberta.
- `README.md` esclarece que o Compose usa `.local/dev.env`, e que alterar a senha inicial no arquivo não redefine a senha já persistida.
- Typecheck, lint, build e teste automatizado de indisponibilidade passaram. O navegador conseguiu autenticar e acessar as configurações; o teste E2E completo parou depois, num seletor do formulário de campos, e ainda precisa ser ajustado.
- Os itens abaixo representam o checkpoint anterior, não uma nova execução da suíte completa.

## Resumo das evidências do checkpoint anterior

| Verificação | Resultado conhecido |
| --- | --- |
| Lint no checkpoint de 14/09/2026 | **Passou** |
| Docker na última verificação operacional | **Disponível; PostgreSQL temporário iniciado** |
| Migração PostgreSQL | **Falhou; correção pendente** |
| Typecheck atual completo, incluindo novos testes/scripts | **Pendente** |
| Testes unitários | **Escritos, execução pendente** |
| Integração e E2E | **Implementação e execução pendentes** |
| Build e inspeção visual | **Pendentes** |
| Publicação/produção | **Não realizada** |
