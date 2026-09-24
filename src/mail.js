import nodemailer from 'nodemailer';
import { config } from './config.js';

function resetUrl(token) {
  return new URL(`/admin/reset-password?token=${encodeURIComponent(token)}`, config.publicBaseUrl).toString();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendPasswordResetEmail({ user, token }) {
  const url = resetUrl(token);
  const displayName = user.name || user.username;

  if (!config.smtpHost || !config.smtpFrom) {
    return { sent: false, url };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser && config.smtpPassword
      ? { user: config.smtpUser, pass: config.smtpPassword }
      : undefined,
  });

  await transporter.sendMail({
    from: config.smtpFrom,
    to: user.email,
    subject: 'Recuperacion de acceso',
    text: [
      `Hola ${displayName},`,
      '',
      'Recibimos una solicitud para restablecer tu clave del panel.',
      `Abre este enlace para crear una nueva clave: ${url}`,
      '',
      'El enlace expira en 1 hora y solo puede usarse una vez.',
      'Si no solicitaste este cambio, ignora este correo.',
    ].join('\n'),
    html: `
      <p>Hola ${escapeHtml(displayName)},</p>
      <p>Recibimos una solicitud para restablecer tu clave del panel.</p>
      <p><a href="${escapeHtml(url)}">Crear nueva clave</a></p>
      <p>El enlace expira en 1 hora y solo puede usarse una vez.</p>
      <p>Si no solicitaste este cambio, ignora este correo.</p>
    `,
  });

  return { sent: true, url };
}
