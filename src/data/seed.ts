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
 * Mock data is anchored to the moment the app first loads so countdowns stay live.
 * The anchor is kept for the browser session (up to three hours) so ticket IDs
 * and timings survive a page refresh.
 */
function resolveAnchor(): number {
  const key = 'nxshield.anchor';
  const fresh = Date.now();
  try {
    const stored = Number(sessionStorage.getItem(key));
    if (stored && fresh - stored < 3 * 60 * 60_000 && fresh >= stored) return stored;
    sessionStorage.setItem(key, String(fresh));
  } catch {
    // Storage unavailable: fall back to a fresh anchor.
  }
  return fresh;
}

export const LOADED_AT = resolveAnchor();

export const CURRENT_USER_ID = 'tm-raka';

export const departments: Department[] = [
  { id: 'support', name: 'Support Desk' },
  { id: 'engineering', name: 'Engineering' },
  { id: 'infra', name: 'Infrastructure' },
  { id: 'data', name: 'Data & Analytics' },
  { id: 'field', name: 'Field Services' },
  { id: 'accounts', name: 'Account Management' },
];

export const team: TeamMember[] = [
  { id: 'tm-raka', name: 'Raka Pratama', title: 'Support Lead', role: 'admin', level: 'L3', departmentId: 'support', email: 'raka.pratama@nxs.example', phone: '+62 811-5550-101', availability: 'available', skills: ['tech', 'business', 'operational'] },
  { id: 'tm-dinda', name: 'Dinda Maheswari', title: 'Support Agent', role: 'support_agent', level: 'L1', departmentId: 'support', email: 'dinda.maheswari@nxs.example', phone: '+62 811-5550-102', availability: 'available', skills: ['tech', 'operational'] },
  { id: 'tm-yoga', name: 'Yoga Saputra', title: 'Support Agent', role: 'support_agent', level: 'L1', departmentId: 'support', email: 'yoga.saputra@nxs.example', phone: '+62 811-5550-103', availability: 'busy', skills: ['tech', 'operational'] },
  { id: 'tm-tasya', name: 'Tasya Amelia', title: 'Support Agent', role: 'support_agent', level: 'L1', departmentId: 'support', email: 'tasya.amelia@nxs.example', phone: '+62 811-5550-104', availability: 'off_shift', skills: ['operational', 'business'] },
  { id: 'tm-nadia', name: 'Nadia Putri', title: 'Frontend Engineer', role: 'support_agent', level: 'L2', departmentId: 'engineering', email: 'nadia.putri@nxs.example', phone: '+62 811-5550-105', availability: 'available', skills: ['tech'] },
  { id: 'tm-bima', name: 'Bima Santoso', title: 'Backend Engineer', role: 'support_agent', level: 'L2', departmentId: 'engineering', email: 'bima.santoso@nxs.example', phone: '+62 811-5550-106', availability: 'busy', skills: ['tech'] },
  { id: 'tm-andre', name: 'Andre Wijaya', title: 'Principal Engineer', role: 'support_lead', level: 'L3', departmentId: 'engineering', email: 'andre.wijaya@nxs.example', phone: '+62 811-5550-107', availability: 'available', skills: ['tech'] },
  { id: 'tm-kevin', name: 'Kevin Halim', title: 'Infrastructure Engineer', role: 'support_agent', level: 'L3', departmentId: 'infra', email: 'kevin.halim@nxs.example', phone: '+62 811-5550-108', availability: 'available', skills: ['tech', 'hardware'] },
  { id: 'tm-gilang', name: 'Gilang Ramadhan', title: 'Data Analyst', role: 'support_agent', level: 'L2', departmentId: 'data', email: 'gilang.ramadhan@nxs.example', phone: '+62 811-5550-109', availability: 'available', skills: ['operational', 'tech'] },
  { id: 'tm-fajar', name: 'Fajar Nugroho', title: 'Field Technician', role: 'support_agent', level: 'L2', departmentId: 'field', email: 'fajar.nugroho@nxs.example', phone: '+62 811-5550-110', availability: 'away', skills: ['hardware'] },
  { id: 'tm-sari', name: 'Sari Wulandari', title: 'Account Manager', role: 'support_lead', level: 'L2', departmentId: 'accounts', email: 'sari.wulandari@nxs.example', phone: '+62 811-5550-111', availability: 'available', skills: ['business'] },
];

/** One set of service levels for every client, from the SLA table. Times run around the clock for now. */
export const policies: SlaPolicy[] = [
  {
    id: 'pol-standard',
    name: 'NXS service levels',
    description: 'The same for every client.',
    coverage: 'P1 around the clock; P2 to P4 in business hours',
    atRiskPercent: 75,
    isDefault: true,
    targets: {
      critical: { firstResponseMins: 60, resolutionMins: 8 * 60 },
      high: { firstResponseMins: 4 * 60, resolutionMins: 24 * 60 },
      medium: { firstResponseMins: 24 * 60, resolutionMins: 72 * 60 },
      low: { firstResponseMins: 48 * 60, resolutionMins: 120 * 60 },
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
    contact: { name: 'Andreas Wibisono', title: 'Head of Digital Marketing', email: 'andreas.wibisono@cml.example', phone: '+62 812-7710-2140' },
    slaPolicyId: 'pol-standard', accountManagerId: 'tm-sari', since: '2023-04-01',
    users: users('cml', 'cml.example', [
      ['Andreas Wibisono', 'Head of Digital Marketing', 'client_admin'],
      ['Nabila Rahmawati', 'E-commerce Manager', 'client_user'],
      ['Teguh Prasetyo', 'Marketing Analyst', 'client_user'],
    ]),
  },
  {
    id: 'aroma', name: 'Aroma Abadi', code: 'ARA', industry: 'Fragrance & personal care', city: 'Jakarta Barat',
    logo: { initials: 'AA', bg: '#EAEAF7', fg: '#3D3F8F' },
    contact: { name: 'Melissa Hartanto', title: 'Head of Omnichannel', email: 'melissa.hartanto@aromaabadi.example', phone: '+62 812-7711-3320' },
    slaPolicyId: 'pol-standard', accountManagerId: 'tm-sari', since: '2024-02-12',
    users: users('aroma', 'aromaabadi.example', [
      ['Melissa Hartanto', 'Head of Omnichannel', 'client_admin'],
      ['Dewi Kartika', 'Training & Development Manager', 'client_user'],
      ['Budi Santosa', 'Retail Operations Lead', 'client_user'],
      ['Siska Amalia', 'CRM & Loyalty Specialist', 'client_user'],
    ]),
  },
];

const h = (hoursAgo: number) => LOADED_AT - hoursAgo * HOUR;

export const assets: Asset[] = [
  { id: 'AST-CML-01', ownerId: 'tm-nadia', clientId: 'cml', name: 'Consumer Website', category: 'consumer_website', url: 'https://www.cml.example', environment: 'Production', status: 'degraded', statusNote: 'Payment confirmation is slow for some orders.', statusChangedAt: h(5.6), uptime30d: 99.62, monitor: { method: 'health_url', endpoint: 'https://www.cml.example/health', intervalMins: 1, hasToken: false } },
  { id: 'AST-CML-02', ownerId: 'tm-gilang', clientId: 'cml', name: 'Marketing-Tech Dashboard', category: 'marketing_dashboard', url: 'https://martech.cml.example', environment: 'Production', status: 'operational', statusNote: '', statusChangedAt: h(310), uptime30d: 99.95, monitor: { method: 'status_api', endpoint: 'https://martech.cml.example/api/status', intervalMins: 5, hasToken: true } },
  { id: 'AST-ARA-01', ownerId: 'tm-bima', clientId: 'aroma', name: 'Omnichannel Dashboard', category: 'omnichannel_dashboard', url: 'https://omni.aromaabadi.example', environment: 'Production', status: 'degraded', statusNote: 'Marketplace orders are syncing late after the connector upgrade.', statusChangedAt: h(1.4), uptime30d: 99.48, monitor: { method: 'status_api', endpoint: 'https://omni.aromaabadi.example/api/status', intervalMins: 1, hasToken: true } },
  { id: 'AST-ARA-02', ownerId: 'tm-yoga', clientId: 'aroma', name: 'LMS App', category: 'lms_app', url: 'https://learn.aromaabadi.example', environment: 'Production', status: 'operational', statusNote: '', statusChangedAt: h(520), uptime30d: 99.97, monitor: { method: 'uptime_service', endpoint: 'https://uptime.betterstack.example/api/v2/monitors/48213', intervalMins: 5, hasToken: true } },
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
