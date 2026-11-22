# NXShield

Internal complaint and ticket management dashboard for NXS Agency. This phase covers the NXS internal dashboard only; the Client Portal is not built yet.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check and production build into dist/
```

Routing uses the History API, so a static host needs a fallback to `index.html`.

## What's in the app

| Area | Route |
| --- | --- |
| Overview: KPIs, ticket activity, SLA monitoring, asset health | `/` |
| Tickets, list view (search, filters, sort, pagination, CSV export) | `/tickets` |
| Tickets, board view (Kanban with workflow rules) | `/tickets/board` |
| Ticket workspace | `/tickets/:id` |
| Clients; client detail holds that client's assets | `/clients`, `/clients/:id` |
| Asset detail | `/assets/:id` |
| Settings: SLA policies, team availability, AVA WhatsApp notifications | `/settings`, `?tab=team`, `?tab=notifications` |

The old addresses `/assets`, `/sla`, `/team` and `/reports` redirect to their new homes.

## Structure

```
src/
  types.ts            Domain model (tickets, clients, assets, SLA, roles, notifications)
  data/               Mock data: seed.ts (clients, assets, team, policies, rules), tickets.ts
  lib/
    domain.ts         Labels, workflow transitions, severity suggestion, role permissions
    sla.ts            SLA clock calculation
    notifications.ts  Event -> in-app notification + AVA WhatsApp message (channel adapter)
    stats.ts          Time series and aggregates
  store.tsx           App state and every action (status changes, assignment, SLA edits...)
  components/         UI kit, charts, ticket table, dialogs, app shell
  pages/              One file per screen
  styles.css          Design tokens and all styles
```

## Things to know

- **Mock data is in memory.** It is anchored to the time the app first loads in a browser session, so SLA countdowns are live. Changes reset when the session ends. Replacing `store.tsx` actions with API calls is the integration point for a backend.
- **Where tickets come from.** Clients normally submit tickets themselves in the Client Portal (`source.channel: 'portal'`). "Log ticket for client" is for issues reported by WhatsApp, email or phone: it records the channel, the client user who reported it, and the team member who logged it (`source.loggedBy`).
- **Workflow rules** live in `TRANSITIONS` in `src/lib/domain.ts`. The board, the ticket page and the store all read from it.
- **Closing a ticket** needs the `ticket.close` permission and a reason; both are enforced in `changeStatus` in the store, and the closure is written to the activity history.
- **Internal notes** carry `visibility: 'internal'`. `clientVisibleActivity()` in `src/lib/domain.ts` is the only view of a ticket's history that the Client Portal should ever use.
- **Multi-tenant and roles.** Every ticket, asset and client user carries a `clientId`. Client roles (`client_admin`, `client_user`) already exist in `ROLE_PERMISSIONS` with no access to internal notes.
- **Assignment suggestions** come from the rules in `assignmentRules` (`src/data/seed.ts`). They are not editable in the UI in this version.
- **SLA** targets are per policy and per severity, and each client points to a policy. Targets are measured in elapsed time; coverage hours are stored but countdowns do not pause outside them yet.
- **AVA** is a delivery channel only and runs in sandbox mode: messages are composed and logged, not sent. To go live, implement `avaWhatsApp.deliver` in `src/lib/notifications.ts`.
