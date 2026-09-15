# Histórias de usuário

| ID | História | Aceite observável |
| --- | --- | --- |
| US-01 | Como convidado, quero ativar meu acesso | E-mail verificado e senha definida permitem acessar apenas organizações autorizadas |
| US-02 | Como RH, quero cadastrar uma candidatura | Vaga e candidato são vinculados; recarregar preserva a linha |
| US-03 | Como RH, quero reutilizar um candidato | A mesma pessoa participa de outra vaga sem duplicar seus contatos |
| US-04 | Como RH, quero editar na grade | Célula válida salva; erro identifica a falha e não altera o banco |
| US-05 | Como administrador, quero configurar colunas | Tipo, opções, padrão e regras passam a valer no backend e frontend |
| US-06 | Como RH, quero localizar candidaturas | Filtros e ordenações abrangem dados fora da página atual |
| US-07 | Como equipe, queremos editar simultaneamente | Alteração remota aparece; versão desatualizada gera conflito sem sobrescrita |
| US-08 | Como RH, quero colar e desfazer um lote | Lote válido aplica integralmente; desfazer não apaga alterações posteriores |
| US-09 | Como administrador, quero importar planilhas | Prévia e relatório permitem decidir antes de aplicar linhas prontas |
| US-10 | Como administrador, quero excluir e restaurar | A candidatura sai da grade padrão e pode voltar se suas referências forem válidas |
| US-11 | Como administrador, quero rastrear alterações | Consigo consultar autor, origem, correlação e valores, com consulta auditada |
| US-12 | Como administrador, quero acompanhar atividade | Totais de operações e distribuição por dia/pessoa/ação são apresentados |
| US-13 | Como responsável pelo tratamento, quero atender um titular | Exportação é autorizada; eliminação limpa contatos, campos e valores históricos |

## Limites de interação

Editar contatos compartilhados exige confirmação contextual. Colagem não cria linhas implicitamente e não pode ultrapassar a página. Desfazer cobre apenas a última edição/colagem da sessão, não importações, exclusões ou configuração. Importações ambíguas devem ser corrigidas no arquivo/cadastro e revalidadas; não há mescla automática de pessoas por e-mail.

Histórias US-01–US-13 são rastreadas pelas suites de validação, integração e navegador e pelos critérios em `acceptance-criteria.md`. Usuários comuns não precisam nem podem acessar configurações, importação, auditoria ou privacidade administrativa.
