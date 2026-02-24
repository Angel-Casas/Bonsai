import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY || 'test-key')
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@bonsai.app'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const url = `${APP_URL}/auth/verify?token=${token}`

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Sign in to Bonsai',
    html: `
      <h2>Sign in to Bonsai</h2>
      <p>Click the link below to sign in. This link expires in 15 minutes.</p>
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#E7D27C;color:#0f172a;text-decoration:none;border-radius:8px;font-weight:600;">
        Sign in to Bonsai
      </a>
      <p style="margin-top:16px;color:#666;">If you didn't request this, you can safely ignore this email.</p>
    `,
  })
}
