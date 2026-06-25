# Pendências — Moura RSVP

## Status do check-in

### O que foi feito
O check-in (porta do evento) foi **extraído** para um serviço independente: **moura-checkin**.

### O que existe neste serviço (moura-rsvp) relacionado a check-in

| Item | Status | Motivo para manter |
|------|--------|--------------------|
| Coluna `qr_token` em `participants` | ✅ Mantida e ativa | É gerada ao confirmar presença e exibida ao convidado. O moura-checkin a lê via sincronização para identificar o convidado na porta. |
| Função `genQrToken()` em `src/utils/qrToken.js` | ✅ Mantida e ativa | Necessária para gerar o token na confirmação de presença. |
| Índice `idx_participants_qr` em `src/db.js` | ✅ Mantido | A API de sincronização do moura-checkin faz busca por `qr_token`. |
| Coluna `checked_in_at` em `participants` | ⚠️ Legado — nunca usada aqui | O registro de entrada real vive no banco do moura-checkin. Pode ser removida em uma futura recreação do banco, mas é inofensiva como está (sempre NULL). |

### O que NÃO deve ser removido deste serviço
- `qr_token` — removê-lo quebraria o QR Code do convidado e a sincronização com moura-checkin
- `genQrToken` — removê-lo quebraria a geração do QR na confirmação de presença
- `idx_participants_qr` — o moura-checkin depende deste índice para performance na sincronização

### Fluxo completo (referência)
```
Convidado confirma presença (moura-rsvp)
  → qr_token gerado e exibido ao convidado
  → convidado chega ao evento com o QR
  → operador no moura-checkin sincroniza a lista de convidados (/api/sync/...)
  → moura-checkin lê o qr_token do moura-rsvp e armazena localmente
  → operador escaneia o QR → checked_in_at registrado no moura-checkin
```
