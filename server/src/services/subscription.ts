export type Plan = 'monthly' | 'yearly'
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled'

export const PLAN_PRICES: Record<Plan, number> = {
  monthly: 5,
  yearly: 48,
}

export function getPeriodEnd(start: Date, plan: Plan): Date {
  const end = new Date(start)
  if (plan === 'monthly') {
    end.setDate(end.getDate() + 30)
  } else {
    end.setFullYear(end.getFullYear() + 1)
  }
  return end
}

export function isSubscriptionActive(sub: { status: string; currentPeriodEnd: Date }): boolean {
  return sub.status === 'active' && sub.currentPeriodEnd > new Date()
}
