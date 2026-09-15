# ADR 0001 — Stack e fronteiras do MVP

Status: **aceita para implementação**, após aprovação do plano. Publicação em produção não está implícita.

## Contexto

O MVP precisa de campos dinâmicos, edição compartilhada, importações confiáveis, isolamento organizacional e auditoria transacional. A equipe escolheu infraestrutura própria, convite e senha, linha por candidatura e escala inicial pequena. A ausência de acesso à Gupy não pode bloquear o núcleo.

## Decisão

Usar TypeScript estrito e pnpm. Frontend React/Vite com React Data Grid; API Fastify; Zod compartilhado; PostgreSQL com Kysely/pg; Keycloak via OIDC e sessão de servidor. CSV Parse e ExcelJS tratam arquivos em parser isolado. API e worker são processos do mesmo domínio. Docker Compose fornece execução local; Mailpit captura e-mails de desenvolvimento.

Entidades centrais são relacionais, valores configuráveis tipados e definições JSONB. HTTP aplica comandos idempotentes com versões; SSE invalida consultas após publicação da outbox. Todas as gravações relevantes passam pelo domínio e pela auditoria. RLS complementa autorização, sem confiar em conexão proprietária das tabelas.

## Interfaces

- `/api/session` e `/auth/*`: identidade e sessão.
- `/api/v1/organizations/:organizationId`: candidaturas, candidatos, campos, vagas, membros, importações, auditoria e atividade.
- Consulta recebe filtros tipados, ordenação e página; retorna linhas, total, campos e versão de esquema.
- Edição em lote recebe versões observadas e `operationId`; conflitos retornam 409.
- Importação: upload, preview, validação assíncrona, confirmação e resultado paginado.
- `CandidateSource.read(cursor)`: fonte externa independente do armazenamento; implementação simulada inicialmente.

## Alternativas e consequências

Supabase auto-hospedado é viável, mas manteria uma API de domínio e acrescentaria configuração da plataforma. A opção escolhida favorece protocolos portáveis e testes diretos, exigindo operar Keycloak e manter a distribuição de eventos. Grade comercial não foi adotada; a alternativa MIT exige comportamento próprio de colagem/desfazer.

Revisitar quando a escala superar o cenário validado, os locks por organização limitarem throughput ou a operação de identidade exigir outra abordagem. Versões efetivas estão no lockfile e Compose. Dependências novas de produção exigem confirmação; mudanças relevantes devem gerar nova ADR.
