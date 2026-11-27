import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth';
import { Layout } from './components/Layout';
import { ForgotPassword, Login } from './pages/Login';
import { Empty } from './components/ui';
import { Board } from './pages/Board';
// Hidden for now: import { CalendarView } from './pages/Calendar';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';
import { NewTicket } from './pages/NewTicket';
import { TicketDetail } from './pages/TicketDetail';
import { Tickets } from './pages/Tickets';
import { PortalLayout } from './portal/PortalLayout';
import { PortalNewTicket } from './portal/PortalNewTicket';
import { PortalHome } from './portal/PortalHome';
import { PortalTicket } from './portal/PortalTicket';
import { InitialReportPage, ReportPage } from './portal/ReportPage';

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

      {/* The RCA reports as pages anyone with the link can read, opened in a new tab: the full one, and the initial one. */}
      <Route path="report/:id" element={<ReportPage />} />
      <Route path="report/:id/initial" element={<InitialReportPage />} />

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
        {/* Calendar is hidden for now. */}
        <Route path="tickets/calendar" element={<Navigate to="/tickets" replace />} />
        <Route path="tickets/new" element={<NewTicket />} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        {/* Settings, one module at a time: /settings is the profile. */}
        <Route path="settings" element={<Settings />} />
        <Route path="settings/workspace" element={<Navigate to="/settings/clients" replace />} />
        <Route path="settings/:section" element={<Settings />} />
        <Route path="settings/:section/:id" element={<Settings />} />
        {/* Older addresses from before the navigation was simplified. */}
        <Route path="clients/*" element={<Navigate to="/settings/clients" replace />} />
        <Route path="assets/*" element={<Navigate to="/settings/clients" replace />} />
        <Route path="sla" element={<Navigate to="/settings" replace />} />
        <Route path="team" element={<Navigate to="/settings/team" replace />} />
        <Route path="reports" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      </Route>
    </Routes>
  );
}
