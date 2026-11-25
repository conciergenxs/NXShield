import type { Asset, AssetCategory, Category, Client, Severity, TaskType } from '../types';

/*
 * The AI's first read of a ticket, the moment a client sends it in with only
 * a title and a description: which asset it is about, what kind of issue, how
 * serious, what kind of work, and who should do it. QA checks all of it
 * before anything moves. Simulated from the ticket's words; a real version
 * would ask a model the same questions.
 */

const ASSET_WORDS: Record<AssetCategory, RegExp> = {
  consumer_website: /checkout|cart|website|product page|homepage|hero|banner|store locator|outlet|menu|order|payment|bank transfer|promo|price|bundle|search|thumbnail|review|faq|voucher/i,
  marketing_dashboard: /dashboard widget|ads|spend|roas|campaign|attribution|meta|tiktok|google|marketing|conversion/i,
  omnichannel_dashboard: /marketplace|shopee|tokopedia|stock|warehouse|chat|whatsapp|inbox|store filter|sales by channel|loyalty|member|omnichannel/i,
  lms_app: /advisor|quiz|module|lesson|training|certificate|completion|lms|course/i,
};

/** The client's asset the words point to most; their first one when nothing matches. */
export function guessAsset(text: string, assets: Asset[]): Asset | undefined {
  const scored = assets.map((a) => ({ a, score: (text.match(new RegExp(ASSET_WORDS[a.category].source, 'gi')) ?? []).length + (text.toLowerCase().includes(a.name.toLowerCase()) ? 3 : 0) }));
  scored.sort((x, y) => y.score - x.score);
  return scored[0]?.a;
}

/** Business: money, points and numbers. Operational: content and setup the client asks for. Tech: everything that breaks. */
export function guessCategory(title: string, description: string): Category {
  const text = `${title} ${description}`;
  if (/price|promo|voucher|discount|loyalty|points|roas|revenue|attribution|commission|invoice|refund|sales by channel/i.test(text)) return 'business';
  if (/^(please|add|upload|replace|update|set up|publish|import|remove|change|request)\b/i.test(title) || /store locator|outlets|banner|hero|faq|content|module|store filter/i.test(title)) return 'operational';
  return 'tech';
}

/** Critical when something is down or losing money or data; medium when part of it fails; low otherwise. */
export function guessSeverity(title: string, description: string): Severity {
  const text = `${title} ${description}`;
  if (/blank page|\bdown\b|cannot|can't|unable|stopped|losing|outage|crash|not loading|leak|exposed|no new .* orders/i.test(text)) return 'critical';
  if (/\bsome\b|slow|delay|time(s)? out|timeout|error|fail|missing|wrong|duplicat|not sync|twice/i.test(text)) return 'medium';
  return 'low';
}

/** Who works on it: the client's frontend or backend developer, by the kind of work. */
export const routeTo = (client: Pick<Client, 'devs'>, taskType: TaskType): string => client.devs[taskType];

/** Who checks and tests it: the client's QA. */
export const testerFor = (client: Pick<Client, 'testerId'>) => client.testerId;

/** Who reviews a new ticket's properties first: the client's PM. */
export const pmFor = (client: Pick<Client, 'accountManagerId'>) => client.accountManagerId;
