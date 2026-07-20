# WhatsApp reminder template (Meta WhatsApp Cloud API)

This is the **utility** message template to submit for approval in Meta Business
Manager → WhatsApp Manager → **Message templates → Create template**. The HFOS
reminder sender (`web/src/server/notify.ts`) fills its five body variables in
order, so submit it exactly as below.

---

## Template settings

| Field | Value |
|---|---|
| **Name** | `payment_due_reminder` |
| **Category** | **Utility** |
| **Language** | English — `en` (set `WHATSAPP_TEMPLATE_LANG=en`, or `en_US` if you pick US English) |

Set the GitHub secret `WHATSAPP_TEMPLATE=payment_due_reminder` so the sender uses it.

## Header (optional, Text)

```
HFOS payment reminder
```

## Body  (copy verbatim, including the {{n}} placeholders)

```
Hi {{1}}, here's your HFOS payment update for {{2}}. You have {{3}} outstanding — {{4}} overdue and {{5}} due soon. Open HFOS to review and settle these before their due dates.
```

### Sample values (Meta asks for an example of each variable)

| Variable | Meaning (filled by HFOS) | Sample to enter |
|---|---|---|
| `{{1}}` | Recipient's name | `Grace` |
| `{{2}}` | Household name | `The Mutibura Household` |
| `{{3}}` | Total outstanding (currency-formatted) | `ZAR 12,450.00` |
| `{{4}}` | Number of overdue payments | `2` |
| `{{5}}` | Number of payments due soon (≤3 days) | `1` |

## Footer (optional, Text)

```
Manage reminders and channels in HFOS → Settings.
```

## Buttons (optional but recommended) — one "Visit website" URL button

| Field | Value |
|---|---|
| Type | Visit website (static URL) |
| Button text | `Open Payments` |
| URL | `https://hfos.geemutibura.workers.dev/payments` |

A **static** URL button needs no runtime parameter, so the sender doesn't pass a
button component — nothing else to configure.

---

## Why this shape

- WhatsApp template **body variables can't contain newlines, tabs, or 4+ spaces**,
  so the reminder is a concise single-line summary (total + counts). The itemised
  list of each payment stays in the **email** digest, which has no such limit.
- Variables are never adjacent and never at the very start/end of the body — both
  are Meta requirements that would otherwise fail review.
- **Utility** (not Marketing) is correct: these are updates about the recipient's
  own obligations, which keeps them eligible for utility pricing and avoids
  marketing opt-out handling.

## After approval

1. Meta approval is usually minutes to a few hours.
2. Add the GitHub secrets: `WHATSAPP_PROVIDER=meta`, `WHATSAPP_TOKEN`,
   `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE=payment_due_reminder`.
3. In HFOS → Settings, add each person's WhatsApp number and toggle **WhatsApp** on.
4. Use **Send me a test reminder** to verify end to end.

> Note: outside the 24-hour customer-service window, WhatsApp only delivers the
> **approved template** (not free text). Within an open session (e.g. right after
> the recipient messages your number) free text also works, which is handy for
> sandbox testing before the template is approved.
