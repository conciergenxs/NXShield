import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../store';
import { TicketForm } from '../components/TicketForm';
import { Card } from '../components/ui';
import { usePortalUser } from './shared';

/* A client raises a ticket: the category (from the ones their PIC may raise), a title and what happened.
   The AI sets the asset and priority and replies at once; their PM
   reviews it. The form is the one NXS uses to log a ticket for them; only the
   client is fixed here. */
export function PortalNewTicket() {
  const { submitPortalTicket, toast } = useStore();
  const { user, client, assets } = usePortalUser();
  const navigate = useNavigate();
  const location = useLocation();
  if (!user || !client) return null;

  return (
    <div className="page portal-form-page">
      <Card className="portal-form-card">
        <header className="portal-form-head">
          <button type="button" className="portal-form-back" onClick={() => (location.key !== 'default' ? navigate(-1) : navigate('/portal'))}>
            <ArrowLeft size={16} aria-hidden />
            Back to tickets
          </button>
          <h1 className="portal-form-title">Report a problem</h1>
          <p className="portal-form-desc">You get a reply right away, and the Initial RCA Report within 3 hours.</p>
        </header>

        {assets.length === 0 ? (
          <div className="panel-empty">
            <p className="panel-empty-title">No assets yet</p>
            <p className="panel-empty-text">Ask your NXS account manager to add {client.name}’s assets first.</p>
          </div>
        ) : (
          <TicketForm
            clients={[client]}
            chooseClient={false}
            meId={user.id}
            idPrefix="pt"
            submitLabel="Submit ticket"
            cancelTo="/portal"
            onSubmit={(v) => {
              const ticket = submitPortalTicket(v);
              toast(`${ticket.id} submitted`);
              navigate(`/portal/tickets/${ticket.id}`, { replace: true });
            }}
          />
        )}
      </Card>
    </div>
  );
}
