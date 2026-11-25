import type {
  Asset,
  Client,
  ClientUser,
  Department,
  NotificationRule,
  SlaPolicy,
  TeamMember,
} from '../types';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/**
 * The prototype runs on a frozen clock: every visit opens on the same moment,
 * Friday 20 November 2026 at 10:00, so countdowns, ages and ticket IDs read the
 * same every time and nothing drifts overdue while someone is reviewing it.
 */
export const LOADED_AT = new Date(2026, 10, 20, 10, 0, 0).getTime();

const BOOTED = Date.now();
/** "Now" for things people do in the prototype: the frozen moment plus the time spent on the page. */
export const clock = () => LOADED_AT + (Date.now() - BOOTED);

/** Who the dashboard opens as when the sign-in email matches nobody on the team: Sarah, a super admin who can take every step. */
export const CURRENT_USER_ID = 'tm-sarah';

export const departments: Department[] = [
  { id: 'support', name: 'Support Desk' },
  { id: 'engineering', name: 'Engineering' },
  { id: 'infra', name: 'Infrastructure' },
  { id: 'data', name: 'Data & Analytics' },
  { id: 'field', name: 'Field Services' },
  { id: 'accounts', name: 'Account Management' },
];

/** NXS, per client: a PM who reviews new tickets, a tester (QA), and a
 *  frontend and a backend developer. Sarah is a super admin, so she can take
 *  every step of the flow herself. */
const all = ['tech', 'business', 'operational'] as TeamMember['skills'];
export const team: TeamMember[] = [
  { id: 'tm-sarah', name: 'Sarah Alifa', title: 'Project Manager, CML', role: 'admin', level: 'L3', departmentId: 'engineering', email: 'sarah.alifa@nxs.example', phone: '+62 811-5550-102', availability: 'available', skills: all },
  { id: 'tm-fajar', name: 'Fajar Saputra', title: 'QA Engineer, CML', role: 'support_agent', level: 'L2', departmentId: 'engineering', email: 'fajar.saputra@nxs.example', phone: '+62 811-5550-110', availability: 'available', skills: all },
  { id: 'tm-alfiana', name: 'Alfiana Cendani', title: 'Frontend Developer, CML', role: 'support_agent', level: 'L2', departmentId: 'engineering', email: 'alfiana.cendani@nxs.example', phone: '+62 811-5550-105', availability: 'available', skills: all },
  { id: 'tm-mega', name: 'Mega Arimerta', title: 'Backend Developer, CML', role: 'support_agent', level: 'L2', departmentId: 'engineering', email: 'mega.arimerta@nxs.example', phone: '+62 811-5550-106', availability: 'available', skills: all },
  { id: 'tm-anton', name: 'Anton Syarif', title: 'Project Manager and QA, Aroma Abadi', role: 'support_lead', level: 'L3', departmentId: 'engineering', email: 'anton.syarif@nxs.example', phone: '+62 811-5550-107', availability: 'available', skills: all },
  { id: 'tm-michael', name: 'Michael Septiadi', title: 'Frontend Developer, Aroma Abadi', role: 'support_agent', level: 'L2', departmentId: 'engineering', email: 'michael.septiadi@nxs.example', phone: '+62 811-5550-108', availability: 'available', skills: all },
  { id: 'tm-guntur', name: 'Guntur Firmansyah', title: 'Backend Developer, Aroma Abadi', role: 'support_agent', level: 'L2', departmentId: 'engineering', email: 'guntur.firmansyah@nxs.example', phone: '+62 811-5550-109', availability: 'available', skills: all },
  { id: 'tm-bhisma', name: 'Bhisma Al', title: 'Managing Director', role: 'admin', level: 'L3', departmentId: 'accounts', email: 'bhisma@nxs.example', phone: '+62 811-5550-103', availability: 'available', skills: all },
  { id: 'tm-riyan', name: 'Riyan Hutomo', title: 'Chief Technology Officer', role: 'admin', level: 'L3', departmentId: 'engineering', email: 'riyan@nxs.example', phone: '+62 811-5550-101', availability: 'available', skills: all },
];

/** One set of service levels for every client, from the SLA table. Times run around the clock for now. */
export const policies: SlaPolicy[] = [
  {
    id: 'pol-standard',
    name: 'NXS service levels',
    description: 'The same for every client.',
    coverage: 'Around the clock, every priority',
    // Orange once half the time is used: on a 1-hour reply that is the last 30 minutes.
    atRiskPercent: 50,
    isDefault: true,
    // From the SLA: first reply within 1 hour for every priority; P2 fixed
    // within 1 day, P3 within 3 days. P1's fix time is set by its diagnosis;
    // until then it runs on 8 hours.
    targets: {
      // The SLA table: reply T+1, initial RCA T+3; fix per priority (P1 from its RCA, 8h until set).
      // The full RCA goes to the client with every fix, so it is due with it. One business day is 24h.
      critical: { firstResponseMins: 60, rcaMins: 180, resolutionMins: 8 * 60 },
      medium: { firstResponseMins: 60, rcaMins: 180, resolutionMins: 24 * 60 },
      low: { firstResponseMins: 60, rcaMins: 180, resolutionMins: 72 * 60 },
    },
  },
];

function users(clientId: string, domain: string, list: [string, string, ClientUser['role']][]): ClientUser[] {
  return list.map(([name, title, role], i) => ({
    id: `cu-${clientId}-${i + 1}`,
    clientId,
    name,
    title,
    role,
    email: `${name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.')}@${domain}`,
    phone: `+62 812-77${String(10 + clientId.length * 7 + i).padStart(2, '0')}-${String(2140 + i * 317 + clientId.charCodeAt(0) * 13).slice(-4)}`,
  }));
}

export const clients: Client[] = [
  {
    id: 'cml', name: 'CML', code: 'CML', industry: 'Consumer goods & e-commerce', city: 'Jakarta Selatan',
    logo: { initials: 'CM', bg: '#FCE8EF', fg: '#A8325E' },
    contact: { name: 'Lucky Salim', title: 'Tech PIC', email: 'lucky.salim@cml.example', phone: '+62 812-7710-2140' },
    slaPolicyId: 'pol-standard', accountManagerId: 'tm-sarah', testerId: 'tm-fajar', devs: { frontend: 'tm-alfiana', backend: 'tm-mega' }, since: '2023-04-01',
    // The JTI PICs from the SLA docs, who log tickets for their own category.
    users: users('cml', 'cml.example', [
      ['Lucky Salim', 'Tech PIC', 'client_admin'],
      ['Friza', 'Tech PIC, hardware', 'client_user'],
      ['Bagus', 'Tech PIC, hardware', 'client_user'],
      ['Nathan', 'Business and Operational PIC', 'client_user'],
      ['Kinan', 'Business and Operational PIC', 'client_user'],
    ]),
  },
  {
    id: 'aroma', name: 'Aroma Abadi', code: 'ARA', industry: 'Fragrance & personal care', city: 'Jakarta Barat',
    logo: { initials: 'AA', bg: '#EAEAF7', fg: '#3D3F8F' },
    contact: { name: 'Lucky Salim', title: 'Tech PIC', email: 'lucky.salim@aromaabadi.example', phone: '+62 812-7711-3320' },
    slaPolicyId: 'pol-standard', accountManagerId: 'tm-anton', testerId: 'tm-anton', devs: { frontend: 'tm-michael', backend: 'tm-guntur' }, since: '2024-02-12',
    // Same SLA and the same PIC set as CML for now.
    users: users('aroma', 'aromaabadi.example', [
      ['Lucky Salim', 'Tech PIC', 'client_admin'],
      ['Friza', 'Tech PIC, hardware', 'client_user'],
      ['Bagus', 'Tech PIC, hardware', 'client_user'],
      ['Nathan', 'Business and Operational PIC', 'client_user'],
      ['Kinan', 'Business and Operational PIC', 'client_user'],
    ]),
  },
];

const h = (hoursAgo: number) => LOADED_AT - hoursAgo * HOUR;

export const assets: Asset[] = [
  { id: 'AST-CML-01', ownerId: 'tm-alfiana', clientId: 'cml', name: 'Consumer Website', category: 'consumer_website', url: 'https://www.cml.example', environment: 'Production', status: 'degraded', statusNote: 'Payment confirmation is slow for some orders.', statusChangedAt: h(5.6), uptime30d: 99.62, monitor: { method: 'health_url', endpoint: 'https://www.cml.example/health', intervalMins: 1, hasToken: false } },
  { id: 'AST-CML-02', ownerId: 'tm-mega', clientId: 'cml', name: 'Marketing-Tech Dashboard', category: 'marketing_dashboard', url: 'https://martech.cml.example', environment: 'Production', status: 'operational', statusNote: '', statusChangedAt: h(310), uptime30d: 99.95, monitor: { method: 'status_api', endpoint: 'https://martech.cml.example/api/status', intervalMins: 5, hasToken: true } },
  { id: 'AST-ARA-01', ownerId: 'tm-guntur', clientId: 'aroma', name: 'Omnichannel Dashboard', category: 'omnichannel_dashboard', url: 'https://omni.aromaabadi.example', environment: 'Production', status: 'degraded', statusNote: 'Marketplace orders are syncing late after the connector upgrade.', statusChangedAt: h(1.4), uptime30d: 99.48, monitor: { method: 'status_api', endpoint: 'https://omni.aromaabadi.example/api/status', intervalMins: 1, hasToken: true } },
  { id: 'AST-ARA-02', ownerId: 'tm-michael', clientId: 'aroma', name: 'LMS App', category: 'lms_app', url: 'https://learn.aromaabadi.example', environment: 'Production', status: 'operational', statusNote: '', statusChangedAt: h(520), uptime30d: 99.97, monitor: { method: 'uptime_service', endpoint: 'https://uptime.betterstack.example/api/v2/monitors/48213', intervalMins: 5, hasToken: true } },
];

export const notificationRules: NotificationRule[] = [
  { event: 'ticket_created', enabled: true, recipients: ['support_lead'] },
  { event: 'ticket_assigned', enabled: true, recipients: ['assignee'] },
  { event: 'status_updated', enabled: false, recipients: ['client_contact'] },
  { event: 'sla_approaching', enabled: true, recipients: ['assignee', 'support_lead'] },
  { event: 'sla_breached', enabled: true, recipients: ['assignee', 'support_lead', 'account_manager'] },
  { event: 'ticket_resolved', enabled: true, recipients: ['client_contact'] },
  { event: 'ticket_canceled', enabled: true, recipients: ['client_contact', 'account_manager'] },
  { event: 'progress_update', enabled: true, recipients: ['client_contact'] },
];
