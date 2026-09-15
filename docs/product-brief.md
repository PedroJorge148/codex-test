# Visão do produto

## Problema e objetivo

A equipe de RH gerencia candidatos provenientes da Gupy em planilhas Excel. O Entre centraliza essas informações em uma grade persistida, validada e compartilhada. O objetivo é reduzir cópias divergentes, sobrescritas silenciosas e dificuldade de atribuir alterações.

## Público e unidade de trabalho

Usuários de RH consultam, cadastram e editam. Administradores configuram campos, vagas, acessos, importações, exclusões e histórico. Cada linha é uma **candidatura**; um **candidato** pode participar de várias **vagas**, compartilhando nome e contatos entre essas participações.

## Escopo do MVP

- Convite e senha, organizações separadas e dois papéis.
- Grade com teclado, edição de células, colagem tabular e desfazer protegido.
- Campos configuráveis dos 12 tipos acordados, com validação no cliente e no servidor.
- Filtros, ordenação e paginação no servidor.
- Atualizações em tempo real, detecção de conflitos e preservação de rascunhos.
- CSV/XLSX com prévia, mapeamento, validação, deduplicação e relatório.
- Auditoria de negócio, dashboard de atividade e operações de privacidade.
- Interface de integração e fonte Gupy simulada.

Não inclui fórmulas, arraste para preenchimento, refazer, colaboração offline, Kanban, IA, gráficos configuráveis, automações complexas ou aplicativo móvel.

## Sucesso e hipóteses

O usuário consegue cadastrar e editar uma candidatura, recarregar e encontrar os mesmos dados. Duas sessões colaboram sem apagar mudanças silenciosamente. Importações apresentam resultados por linha e sua repetição não duplica aplicações confirmadas. As consultas respeitam integralmente a organização.

A referência inicial é até 10 organizações, 50 mil candidaturas e 20 editores simultâneos por organização. Metas de desempenho precisam ser aferidas no ambiente de implantação; não são garantia contratual. Infraestrutura própria, interface em português e fuso organizacional padrão `America/Fortaleza` são as hipóteses adotadas.
