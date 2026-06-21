# Moura RSVP — Instruções para Claude

## Comportamento obrigatório

- Sempre fale com o usuário em **português**.
- O usuário **não é desenvolvedor** — é um empreendedor construindo o sistema. Use linguagem simples, sem jargão técnico (e, quando um termo técnico for inevitável, explique o que ele significa). Explique tudo de forma clara e da maneira mais **visual e amigável** possível (listas, exemplos, comparações).
- Ao final de **cada** tarefa, forneça um relatório com: o que foi feito / alterado (arquivos, rotas, comportamentos), o que foi resolvido, o que **não** foi resolvido (pendências, limitações, problemas) e os próximos passos recomendados.
- Sempre que o usuário esquecer uma tarefa importante (algo combinado ou pendente), lembre-o proativamente.
- Sempre crie o PR e faça merge automaticamente (squash) sem esperar confirmação do usuário.
- Nunca inclua o identificador do modelo em commits, PRs, comentários de código ou qualquer artefato do repositório.

## Prévias visuais

- Sempre que a tarefa alterar a interface (telas — HTML/CSS/JS), ao final **suba o app localmente, capture prints das telas afetadas** (navegador headless) e **envie as imagens** ao usuário antes de concluir a tarefa.
- Quando fizer sentido, mostre o **antes e depois**.
- Mudanças apenas de backend (sem efeito visual) não precisam de print.
