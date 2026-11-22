import { useMemo } from 'react';
import type { Activity, Actor, Asset, Client, ClientUser, Ticket, TicketStatus } from '../types';
import { useAuth } from '../auth';
import { PORTAL_STATUS_LABEL, STATUS_LABEL } from '../lib/domain';
import { fmtRelative } from '../lib/format';
import { useStore } from '../store';

/** The signed-in client user, their company, and what NXS runs for it. */
export function usePortalUser(): { user: ClientUser | undefined; client: Client | undefined; assets: Asset[]; tickets: Ticket[] } {
  const { session } = useAuth('client');
  const { clients, assets, tickets } = useStore();
  return useMemo(() => {
    const user = clients.flatMap((c) => c.users).find((u) => u.id === session?.userId);
    const client = user ? clients.find((c) => c.id === user.clientId) : undefined;
    // A client only ever sees its own company's tickets and products.
    return {
      user,
      client,
      assets: client ? assets.filter((a) => a.clientId === client.id) : [],
      tickets: client ? tickets.filter((t) => t.clientId === client.id) : [],
    };
  }, [session?.userId, clients, assets, tickets]);
}

/** How a client reads who did something: NXS staff are marked as NXS. */
export function usePortalActorName() {
  const { memberOf, clients } = useStore();
  return (a: Actor, meId?: string) => {
    if (a.type === 'system') return 'NXShield';
    if (a.type === 'team') return `${memberOf(a.id)?.name ?? 'NXS support'}, NXS`;
    if (a.id === meId) return 'You';
    return clients.flatMap((c) => c.users).find((u) => u.id === a.id)?.name ?? 'Your team';
  };
}

/** "just now", "5h ago" or "on 5 Nov 2026": a relative time that reads inside a sentence. */
export function whenText(ts: number, now: number) {
  const r = fmtRelative(ts, now);
  if (r === 'Just now') return 'just now';
  return r.endsWith('ago') ? r : `on ${r}`;
}

/** A status line as a client reads it: their words for the stages. */
export function portalText(a: Activity) {
  let text = a.text;
  for (const s of Object.keys(STATUS_LABEL) as TicketStatus[]) text = text.replaceAll(`to ${STATUS_LABEL[s]}`, `to ${PORTAL_STATUS_LABEL[s]}`).replaceAll(`from ${STATUS_LABEL[s]}`, `from ${PORTAL_STATUS_LABEL[s]}`);
  return text;
}
