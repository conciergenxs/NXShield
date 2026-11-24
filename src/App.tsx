import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth';
import { Layout } from './components/Layout';
import { ForgotPassword, Login } from './pages/Login';
import { Empty } from './components/ui';
import { Board } from './pages/Board';
import { CalendarView } from './pages/Calendar';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';
import { NewTicket } from './pages/NewTicket';
import { TicketDetail } from './pages/TicketDetail';
import { Tickets } from './pages/Tickets';
import { PortalLayout } from './portal/PortalLayout';
import { PortalNewTicket } from './portal/PortalNewTicket';
import { PortalHome } from './portal/PortalHome';
import { PortalTicket } from './portal/PortalTicket';
import { ReportPage } from './portal/ReportPage';

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

      {/* A full RCA as a page anyone with the link can read: opened in a new tab from the portal. */}
      <Route path="report/:id" element={<ReportPage />} />

      {/* Client Portal: client users only, with their own sign in. */}
      <Route path="portal/login" element={<Login kind="client" />} />
      <Route path="portal/login/forgot" element={<ForgotPassword kind="client" />} />
      <Route path="portal" element={<RequireAuth kind="client" />}>
        <Route element={<PortalLayout />}>
          {/* The client's own home: what needs them, then everything open. */}
          <Route index element={<PortalHome />} />
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
        <Route path="settings" element={<Settings />} />
        <Route path="settings/workspace" element={<Settings />} />
        {/* Clients and assets are managed in Settings now. */}
        <Route path="clients/*" element={<Navigate to="/settings/workspace" replace />} />
        <Route path="assets/*" element={<Navigate to="/settings/workspace" replace />} />
        {/* Older addresses from before the navigation was simplified. */}
        <Route path="sla" element={<Navigate to="/settings" replace />} />
        <Route path="team" element={<Navigate to="/settings" replace />} />
        <Route path="reports" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      </Route>
    </Routes>
  );
}
