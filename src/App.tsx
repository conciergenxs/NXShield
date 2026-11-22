import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth';
import { Layout } from './components/Layout';
import { ForgotPassword, Login } from './pages/Login';
import { Empty } from './components/ui';
import { Board } from './pages/Board';
import { CalendarView } from './pages/Calendar';
import { AssetRedirect, ClientDetail, Clients } from './pages/Clients';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';
import { NewTicket } from './pages/NewTicket';
import { TicketDetail } from './pages/TicketDetail';
import { Tickets } from './pages/Tickets';
import { PortalLayout } from './portal/PortalLayout';
import { PortalNewTicket } from './portal/PortalNewTicket';
import { PortalTicket } from './portal/PortalTicket';

function NotFound() {
  return (
    <div className="page">
      <Empty title="This page doesn't exist" action={<Link to="/" className="btn btn-secondary">Go to overview</Link>}>
        The link may be outdated. Use the navigation to find what you need.
      </Empty>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="login/forgot" element={<ForgotPassword />} />

      {/* Client Portal: client users only, with their own sign in. */}
      <Route path="portal/login" element={<Login kind="client" />} />
      <Route path="portal/login/forgot" element={<ForgotPassword kind="client" />} />
      <Route path="portal" element={<RequireAuth kind="client" />}>
        <Route element={<PortalLayout />}>
          {/* The same list, board and calendar as the dashboard, scoped to the client. */}
          <Route index element={<Tickets />} />
          <Route path="board" element={<Board />} />
          <Route path="calendar" element={<CalendarView />} />
          <Route path="tickets/new" element={<PortalNewTicket />} />
          <Route path="tickets/:id" element={<PortalTicket />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Route>
      </Route>

      {/* NXS dashboard. */}
      <Route element={<RequireAuth />}>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="tickets/board" element={<Board />} />
        <Route path="tickets/calendar" element={<CalendarView />} />
        <Route path="tickets/new" element={<NewTicket />} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="assets/:id" element={<AssetRedirect />} />
        <Route path="settings" element={<Settings />} />
        {/* Older addresses from before the navigation was simplified. */}
        <Route path="assets" element={<Navigate to="/clients" replace />} />
        <Route path="sla" element={<Navigate to="/settings" replace />} />
        <Route path="team" element={<Navigate to="/settings" replace />} />
        <Route path="reports" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      </Route>
    </Routes>
  );
}
