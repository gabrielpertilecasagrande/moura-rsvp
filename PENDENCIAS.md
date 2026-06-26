# Pendências — Moura RSVP

## Status do check-in

### ✅ Extração concluída

O check-in (porta do evento) foi **extraído** para um serviço independente: **moura-checkin**.
A limpeza dentro do moura-rsvp está completa.

### O que permanece neste serviço (intencional)

| Item | Status | Motivo |
|------|--------|--------|
| Coluna `qr_token` em `participants` | ✅ Mantida e ativa | Gerada ao confirmar presença; exibida ao convidado; lida pelo moura-checkin na sincronização. |
| Função `genQrToken()` em `src/utils/qrToken.js` | ✅ Mantida e ativa | Necessária para gerar o token na confirmação. |
| Índice `idx_participants_qr` em `src/db.js` | ✅ Mantido | Performance na sincronização do moura-checkin. |
| Rota `/api/admin/checkin` (`checkin-bridge.routes.js`) | ✅ Mantida e ativa | Ponte de sincronização — fornece convidados confirmados ao moura-checkin. |

### O que foi removido / não existe mais

- `public/checkin/` — removido ✅
- `src/routes/checkin.routes.js` e `checkin-admin.routes.js` — removidos ✅
- Coluna `checked_in_at` — removida do schema ✅ (era legado; nunca escrita aqui)

### Fluxo completo (referência)

```
Convidado confirma presença (moura-rsvp)
  → qr_token gerado e exibido ao convidado
  → convidado chega ao evento com o QR
  → operador no moura-checkin sincroniza a lista (/api/sync/...)
  → moura-checkin lê o qr_token via bridge e armazena localmente
  → operador escaneia o QR → checked_in_at registrado no moura-checkin
```
