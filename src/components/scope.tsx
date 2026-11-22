import { createContext, useContext, useMemo } from 'react';
import type { TicketStatus } from '../types';
import { PORTAL_STATUS_LABEL, STATUSES, STATUS_LABEL, portalStatus } from '../lib/domain';
import { useStore } from '../store';

/* The ticket list, board and calendar serve two audiences: NXS staff, who see
   every client, and a client in the Client Portal, who sees only their own
   brand. The scope says which, so the same views link to the right pages,
   use the right words and leave out what only NXS may do. */

export type TicketsView = 'list' | 'board' | 'calendar';

export interface TicketScope {
  portal: boolean;
  /** In the portal: the only client whose tickets may be shown. */
  clientId?: string;
  clientName?: string;
  ticketPath: (id: string) => string;
  viewPath: Record<TicketsView, string>;
}

const STAFF: TicketScope = {
  portal: false,
  ticketPath: (id) => `/tickets/${id}`,
  viewPath: { list: '/tickets', board: '/tickets/board', calendar: '/tickets/calendar' },
};

export const portalScope = (clientId: string, clientName: string): TicketScope => ({
  portal: true,
  clientId,
  clientName,
  ticketPath: (id) => `/portal/tickets/${id}`,
  viewPath: { list: '/portal', board: '/portal/board', calendar: '/portal/calendar' },
});

export const TicketScopeContext = createContext<TicketScope>(STAFF);
export const useTicketScope = () => useContext(TicketScopeContext);

/** Tickets this scope may show: all of them for staff, one client's in the portal. */
export function useScopedTickets() {
  const { tickets } = useStore();
  const { clientId } = useTicketScope();
  return useMemo(() => (clientId ? tickets.filter((t) => t.clientId === clientId) : tickets), [tickets, clientId]);
}

export const statusLabelFor = (portal: boolean, s: TicketStatus) => (portal ? PORTAL_STATUS_LABEL[s] : STATUS_LABEL[s]);

/** Stage order for lists and boards. A client's own to-do (reviewing a fix) comes first for them. */
export const STAFF_ORDER: TicketStatus[] = STATUSES;
/** Only the stages a client sees: blocked and testing tickets sit under In progress. */
export const PORTAL_ORDER: TicketStatus[] = ['waiting_approval', 'new', 'reopened', 'in_progress', 'resolved', 'canceled'];
/** The stage a ticket is grouped under in the current view. */
export const groupStatusFor = (portal: boolean, s: TicketStatus) => (portal ? portalStatus(s) : s);
