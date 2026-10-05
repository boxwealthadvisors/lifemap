async function sendViaResend({ from, to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || 'Resend rejected the message')
  }
}

async function sendViaSmtp({ from, to, subject, text, html }) {
  const nodemailer = await import('nodemailer')
  const createTransport = nodemailer.createTransport || nodemailer.default?.createTransport
  if (!createTransport) throw new Error('nodemailer is not available')
  const transporter = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  })
  await transporter.sendMail({ from, to, subject, text, html })
}

export async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || process.env.MAIL_FROM || 'LifeMap <noreply@lifemap.finance>'
  if (process.env.RESEND_API_KEY) {
    await sendViaResend({ from, to, subject, text, html })
    return
  }
  if (process.env.SMTP_HOST) {
    await sendViaSmtp({ from, to, subject, text, html })
    return
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Email delivery is not configured')
  }
  console.log('[mailer] no SMTP/Resend configured; message logged only')
  console.log('[mailer]', { to, subject, text })
}
