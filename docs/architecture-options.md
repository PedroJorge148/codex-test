# Alternativas de arquitetura

## Comparação

| Dimensão | A: API modular, PostgreSQL e Keycloak | B: Supabase auto-hospedado e API de domínio |
| --- | --- | --- |
| Custo | Containers, SMTP, armazenamento, backups e manutenção | Mesmas categorias, mais operação dos componentes da plataforma |
| Complexidade | Eventos, integração OIDC e regras explícitos na aplicação | Auth/Realtime integrados; regras de negócio e políticas continuam necessárias |
| Maturidade | Componentes consolidados e protocolos padronizados | PostgreSQL consolidado e distribuição integrada, com atualizações coordenadas |
| Colaboração | SSE/outbox próprios, validação e reconciliação controladas | Realtime WebSocket pronto; conflitos e reconciliação permanecem no domínio |
| Autenticação | Keycloak e sessões de servidor via OIDC | Supabase Auth e configuração de identidade da plataforma |
| Operação | API, worker, identidade, banco e proxy | Plataforma com múltiplos serviços, API e worker |
| Testes | Domínio, HTTP e banco testáveis diretamente | Também testar configuração da plataforma e suas políticas |
| Dependência de fornecedor | PostgreSQL, HTTP e OIDC permitem substituição gradual | Banco portátil, maior acoplamento às APIs de Auth/Realtime |

São avaliações de engenharia para este escopo, não benchmarks nem orçamentos. Auto-hospedagem transfere manutenção, backups e disponibilidade à equipe. [Supabase: responsabilidades operacionais](https://supabase.com/docs/guides/self-hosting).

## Decisão

Adotar **A**. Importação, campos dinâmicos, auditoria atômica e concorrência exigem uma camada de domínio substancial independentemente da plataforma. Centralizá-la em uma API permite testar as invariantes e manter as mesmas regras em todas as entradas. A decisão prioriza controle transacional, portabilidade e operação compreensível, não apenas prototipação rápida.

O custo é manter o fluxo de eventos e o serviço de identidade. Keycloak em produção demanda configuração de hostname, TLS e proxy; `start-dev` é exclusivamente local. [Guia oficial](https://www.keycloak.org/server/configuration-production).

## Componentes e licenças

React/Vite, React Data Grid, Fastify, Zod, Kysely/pg, OpenID Client, CSV Parse e ExcelJS compõem a aplicação. React Data Grid e ExcelJS usam MIT. [Licença da grade](https://raw.githubusercontent.com/Comcast/react-data-grid/main/LICENSE), [ExcelJS](https://github.com/exceljs/exceljs/blob/master/LICENSE).

AG Grid Enterprise é alternativa comercial: clipboard exige licença paga, cujo preço deve ser cotado/aprovado. A implementação usa a alternativa MIT e mantém colagem/desfazer na camada de domínio. [Clipboard Enterprise](https://www.ag-grid.com/javascript-data-grid/clipboard/), [preços](https://www.ag-grid.com/license-pricing/).

Mailpit e Playwright são componentes locais de teste; não substituem SMTP real ou observabilidade de produção. Versões JavaScript estão fixadas no lockfile. Atualizações de imagens e dependências devem passar pelas suites antes de implantação.
