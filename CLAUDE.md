# Moura RSVP — Instruções para Claude

## Comportamento obrigatório

- Sempre fale com o usuário em **português**.
- O usuário **não é desenvolvedor** — é um empreendedor construindo o sistema. Use linguagem simples, sem jargão técnico (e, quando um termo técnico for inevitável, explique o que ele significa). Explique tudo de forma clara e da maneira mais **visual e amigável** possível (listas, exemplos, comparações).
- Ao final de **cada** tarefa, forneça um relatório com: o que foi feito / alterado (arquivos, rotas, comportamentos), o que foi resolvido, o que **não** foi resolvido (pendências, limitações, problemas) e os próximos passos recomendados.
- Sempre que o usuário esquecer uma tarefa importante (algo combinado ou pendente), lembre-o proativamente.
- Sempre crie o PR e faça merge automaticamente (squash) sem esperar confirmação do usuário.
- Nunca inclua o identificador do modelo em commits, PRs, comentários de código ou qualquer artefato do repositório.

## Prévias visuais

- **Não envie prints por padrão.** Capturas de tela consomem tokens e o usuário não quer isso como rotina.
- Envie print **somente** quando houver dúvida real sobre o resultado visual (ex.: layout quebrado, resultado ambíguo) — e justifique brevemente o motivo.
- Mudanças apenas de backend (sem efeito visual) nunca precisam de print.

## Lixeira — regra fixa

- **Nenhuma exclusão é definitiva pela interface.** Tudo que puder ser apagado
  (evento, convidado/participante, usuário, etc.) precisa ir para a Lixeira
  (soft delete: marcar `deleted_at`/`deleted_by`, nunca `DELETE FROM` direto a
  partir de um clique do usuário) e aparecer lá com opção de **Restaurar**. Só
  a Lixeira pode oferecer exclusão definitiva (de preferência restrita a
  admin).
- Ao criar uma tela ou botão novo de "excluir"/"remover"/"apagar", sempre
  verificar se o tipo já está coberto pela Lixeira; se não estiver, adicionar
  o tipo à Lixeira (listagem + restaurar) como parte da mesma entrega.
- Vale para qualquer sistema do ecossistema (moura-eventos, moura-expositor,
  moura-rsvp, moura-checkin).

## PWA — regra fixa

- O botão "Atualizar" do aviso "Nova versão disponível" **sempre** precisa de
  um `setTimeout` de segurança (força `window.location.reload()`, ~3s) além do
  listener de `controllerchange`. Já aconteceu do `controllerchange` não
  disparar e o botão ficar travado em "Atualizando…" para sempre — só o
  listener sozinho não é confiável. Vale para qualquer sistema do ecossistema
  que tenha esse aviso (moura-eventos, moura-expositor, moura-rsvp,
  moura-checkin).
