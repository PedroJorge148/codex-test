# Roadmap de entregas verticais

A captura de auditoria integra a primeira escrita. Sua interface vem após importação, evitando um período de alterações sem histórico.

| Entrega | Demonstração | Dependências | Aceite/testes | Risco |
| --- | --- | --- | --- | --- |
| E1 Grade persistida | Login, organização, vaga, candidato e edição após recarregar | Stack/identidade/banco | Persistência, autorização, auditoria atômica | Integração entre camadas |
| E2 Consulta e ciclo de vida | Buscar, filtrar, ordenar, paginar, excluir e restaurar | E1 | Consulta global, excluídos fora da grade padrão | Índices e referências |
| E3 Campos configuráveis | Administrador cria tipos/regras | E2 | Matriz dos 12 tipos; regras incompatíveis recusadas | Integridade dos dados antigos |
| E4 Colaboração | Duas sessões recebem atualizações | E3/outbox | Versão antiga gera conflito; SSE após commit | Perda/duplicação de eventos |
| E5 Colagem e desfazer | Lote atômico e reversão protegida | E4 | Rollback integral e proteção contra alterações posteriores | Apagar trabalho alheio |
| E6 CSV | Prévia, mapeamento, validação, confirmação e relatório | E5 | Idempotência, deduplicação e conflitos após prévia | Identidade externa |
| E7 XLSX/fonte simulada | Importação de planilha e páginas simuladas | E6 | Fórmulas recusadas, limites e falhas | Arquivos malformados |
| E8 Auditoria consultável | Histórico por operação/entidade | E7 | Valores autorizados e consulta auditada | Exposição de informações |
| E9 Atividade | Indicadores fixos de operações e autores | E8 | Contagem por operação, sem multiplicação por campo | Métricas enganosas |
| E10 Operação local/piloto | Docker, convite real, backup/restauração | Anteriores | E2E, isolamento, recuperação e carga | Prontidão operacional |

## Execução e evidências

As suites ficam em `tests/validation.test.ts`, `tests/import-parser.test.ts`, `tests/integration.test.ts` e `tests/e2e/`. O estado executado e os resultados efetivos estão em `IMPLEMENTATION_STATUS.md`; este roadmap descreve critérios, não substitui evidência.

Rodar lint, checagem estrita, testes unitários, integração com PostgreSQL e build. E2E usa a stack Docker com Keycloak e SMTP local. O ensaio de restauração sempre usa um banco isolado. Atualizações da documentação e da operação fazem parte de cada entrega relevante.

Não apresentar duração como certeza. Reavaliar após demonstrações, dados reais anonimizados e métricas do piloto. Produção depende separadamente de domínio/TLS, SMTP, responsáveis, política LGPD e recuperação aprovada; integração real da Gupy depende de acesso confirmado.
