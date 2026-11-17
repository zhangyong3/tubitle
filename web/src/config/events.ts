/**
 * Product events: things a user did that no other table records — hitting a
 * paywall, picking a plan, being flagged by risk checks. They land in the
 * `user_event` table and show in the admin user timeline (and to agents via
 * `users_timeline`) next to orders, credits and tasks.
 *
 * Register every kind here before using it:
 * - `tone`: timeline dot — green (money in), red (failure / risk), amber (the
 *   user moving toward paying), gray (default).
 * - `client: true` lets the browser report it with `track()` from
 *   `@/lib/track`. Leave it off for anything the user must not be able to
 *   fake (risk flags, anything money-related) and record those on the server
 *   with `recordEvent()` from `@/modules/events/service`.
 *
 * Label: add `admin.user_detail.timeline_<kind>` to messages/{en,zh}.json
 * (falls back to the kind itself).
 *
 * This file is imported by the browser bundle: no server imports here.
 */

export type EventTone = 'green' | 'red' | 'amber' | 'gray';

export interface EventDefinition {
  tone?: EventTone;
  /** Reportable from the browser via track(). */
  client?: boolean;
}

export const userEvents = {
  learning_saved: { tone: 'gray' },
  // Reported by PricingTable when a signed-in user clicks a plan's button.
  plan_selected: { tone: 'amber', client: true },
  // Call track('paywall_hit', { feature }) where a feature needs a paid plan
  // or more credits.
  paywall_hit: { tone: 'amber', client: true },
  // Server only: recordEvent({ userId, kind: 'risk_flagged', detail }).
  risk_flagged: { tone: 'red' },
} satisfies Record<string, EventDefinition>;

export type UserEventKind = keyof typeof userEvents;
export type ClientEventKind = {
  [K in UserEventKind]: (typeof userEvents)[K] extends { client: true }
    ? K
    : never;
}[UserEventKind];

export function getEventDefinition(kind: string): EventDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(userEvents, kind)
    ? (userEvents as Record<string, EventDefinition>)[kind]
    : undefined;
}

/** Flat detail only: up to 10 keys, short strings, numbers or booleans. */
export type EventDetail = Record<string, string | number | boolean | null>;

export const EVENT_DETAIL_LIMITS = {
  maxKeys: 10,
  maxKeyLength: 40,
  maxStringLength: 200,
} as const;
