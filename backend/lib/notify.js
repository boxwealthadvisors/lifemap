import { sendMail } from './mailer.js'

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Best-effort email: never throws. Returns true when the mailer accepted the message.
 * `text` is plain text; HTML is derived from it (escaped) with optional link auto-wrapping.
 */
export async function notifyEmail(to, subject, text) {
  if (!to || !String(to).trim()) return false
  try {
    const html = escapeHtml(text)
      .split(/\n{2,}/)
      .map((para) =>
        `<p>${para
          .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
          .replace(/\n/g, '<br/>')}</p>`
      )
      .join('')
    await sendMail({ to, subject, text, html })
    return true
  } catch (error) {
    console.error('[notify] email failed:', subject, error.message)
    return false
  }
}
