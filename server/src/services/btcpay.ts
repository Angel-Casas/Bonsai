const BTCPAY_URL = process.env.BTCPAY_URL || 'http://localhost:23001'
const BTCPAY_STORE_ID = process.env.BTCPAY_STORE_ID || ''
const BTCPAY_API_KEY = process.env.BTCPAY_API_KEY || ''
const BTCPAY_WEBHOOK_SECRET = process.env.BTCPAY_WEBHOOK_SECRET || ''

export interface CreateInvoiceParams {
  amount: number
  currency: string
  orderId: string
  redirectUrl: string
  metadata: Record<string, string>
}

export interface BtcpayInvoice {
  id: string
  checkoutLink: string
  status: string
}

export async function createInvoice(params: CreateInvoiceParams): Promise<BtcpayInvoice> {
  const res = await fetch(`${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `token ${BTCPAY_API_KEY}`,
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency,
      orderId: params.orderId,
      checkout: { redirectURL: params.redirectUrl },
      metadata: params.metadata,
    }),
  })

  if (!res.ok) {
    throw new Error(`BTCPay invoice creation failed: ${res.status}`)
  }

  return (await res.json()) as BtcpayInvoice
}

export async function verifyWebhookSignature(body: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(BTCPAY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${expected}` === signature
}
