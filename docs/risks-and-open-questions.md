# Riscos e perguntas em aberto

| Risco/decisão externa | Impacto | Tratamento |
| --- | --- | --- |
| Acesso real à Gupy não confirmado | Bloqueia integração real | Manter adaptador simulado; confirmar credenciais, escopos, limites, paginação, contratos e IDs |
| Planilhas podem não ter IDs confiáveis | Deduplicação automática limitada | Usar amostra anonimizada; ambiguidades exigem revisão sem mescla por contato |
| Política LGPD não definida | Bloqueia produção com dados pessoais | Controlador aprova finalidade, base legal, retenção e responsáveis |
| Infraestrutura e SMTP definitivos desconhecidos | Bloqueia publicação | Stack local executável; substituir configurações e ensaiar recuperação |
| Host único | Ponto único de falha | Backup externo, monitoramento e plano de recuperação; HA fora do piloto |
| Bloqueio por organização | Limita throughput de escrita | Medir antes de aumentar concorrência; futuramente granularizar locks |
| Validação de arquivos grandes | Tempo e uso de memória | Limites, parser isolado e avanço por blocos; avaliar staging tabular futuro |
| Auditoria acumula dados pessoais | Exposição e crescimento | Criptografia, autorização, expiração de payloads e eliminação rastreável |
| Dependências e imagens evoluem | Risco operacional e de segurança | Lockfile e versões explícitas; testar atualizações e revisar avisos |
| Fuso/calendário de arquivos | Conversão ambígua | Formato explícito; datetime exige offset |
| Falhas entre API e navegador | Resposta pode se perder após commit | IDs idempotentes, recarga, comparação e testes de retomada |

## Bloqueios que não impedem rodar localmente

Credenciais Gupy, aprovação da política de tratamento e domínio/SMTP de produção são dependências externas. O MVP local usa dados sintéticos, Keycloak próprio e caixa de e-mail de teste. Não inventar credenciais ou prometer acesso à API por existir documentação pública. [Portal da Gupy](https://developers.gupy.io/).

## Defaults adotados

Português, fuso `America/Fortaleza`, organizações provisionadas operacionalmente, campos configuráveis somente na candidatura, acesso compartilhado dentro da organização e administração de vagas/importações por administradores. Sem calendário de entrega contratual; esforço de expansão depende do piloto e de medidas reais.
