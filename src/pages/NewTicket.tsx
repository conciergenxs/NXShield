import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../store';
import { TicketForm } from '../components/TicketForm';
import { Card } from '../components/ui';

/* NXS logs a ticket for a client who reported it outside the portal: the same
   form the client uses, with the client picked first. */
export function NewTicket() {
  const { clients: allClients, assets, createTicket } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // A ticket needs a client user to raise it and an asset to tie it to.
  const clients = useMemo(() => allClients.filter((c) => c.users.length > 0 && assets.some((a) => a.clientId === c.id)), [allClients, assets]);

  return (
    <div className="page portal-form-page">
      <Card className="portal-form-card">
        <header className="portal-form-head">
          <button type="button" className="portal-form-back" onClick={() => (location.key !== 'default' ? navigate(-1) : navigate('/tickets'))}>
            <ArrowLeft size={16} aria-hidden />
            Back to tickets
          </button>
          <h1 className="portal-form-title">Log ticket for client</h1>
          <p className="portal-form-desc">For an issue the client reported by call, chat or email. It shows up in their portal too.</p>
        </header>
        <TicketForm
          clients={clients}
          chooseClient
          presetClientId={params.get('client')}
          idPrefix="ct"
          submitLabel="Log ticket"
          cancelTo="/tickets"
          onSubmit={(v) => {
            const ticket = createTicket({ ...v, channel: 'manual' });
            navigate(`/tickets/${ticket.id}`, { replace: true });
          }}
        />
      </Card>
    </div>
  );
}
