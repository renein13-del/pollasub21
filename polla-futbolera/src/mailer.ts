import { Resend } from "resend";

// Envío de correos vía Resend — https://resend.com
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "La Polla <no-responder@lapolla.app>";

export function isMailerConfigured(): boolean {
  return Boolean(RESEND_API_KEY);
}

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

function resetPasswordHtml(nickname: string, resetUrl: string): string {
  return `
<body style="margin:0;padding:0;background-color:#08090D;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#08090D;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background-color:#12141C;border:1px solid rgba(237,240,245,0.14);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:22px 28px;border-bottom:2px solid rgba(242,183,5,0.35);">
              <span style="display:inline-block;font-family:'Courier New',monospace;font-weight:700;font-size:12px;letter-spacing:0.08em;color:#17130A;background-color:#F2B705;padding:4px 9px;border-radius:6px;">1X2</span>
              <span style="font-family:Arial,sans-serif;font-size:18px;letter-spacing:0.03em;color:#F4F1EA;margin-left:8px;">LA POLLA</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:Arial,sans-serif;color:#F4F1EA;">
              <p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#F2B705;">Recuperar contraseña</p>
              <h1 style="margin:0 0 16px;font-size:21px;font-weight:700;">Hola, ${nickname}</h1>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#9397A6;">
                Pediste restablecer tu contraseña. Tocá el botón para elegir una nueva.
                Este enlace vale por <strong style="color:#F4F1EA;">1 hora</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:10px;background-color:#F2B705;">
                    <a href="${resetUrl}" style="display:inline-block;padding:13px 22px;font-family:'Courier New',monospace;font-weight:700;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#17130A;text-decoration:none;">
                      Elegir nueva contraseña
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:26px 0 0;font-size:12px;line-height:1.6;color:#9397A6;">
                Si no pediste esto, ignorá este correo — tu contraseña sigue igual.
                Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br>
                <span style="color:#2FF3E0;word-break:break-all;">${resetUrl}</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;
}

export async function sendPasswordResetEmail(
  to: string,
  nickname: string,
  resetUrl: string
): Promise<void> {
  if (!isMailerConfigured()) {
    console.error(
      `❌ Falta la variable de entorno RESEND_API_KEY — no se pudo enviar el correo de recuperación a ${to}. ` +
      `Configurala en tu .env (local) o en las Environment Variables de Render para habilitar el envío de correos. ` +
      `Enlace generado (solo queda en los logs): ${resetUrl}`
    );
    return;
  }

  const { error } = await getResendClient().emails.send({
    from: MAIL_FROM,
    to,
    subject: "Recuperá tu contraseña — La Polla",
    html: resetPasswordHtml(nickname, resetUrl),
    text: `Hola ${nickname}, pediste restablecer tu contraseña de La Polla. Entrá a este enlace (válido por 1 hora) para elegir una nueva: ${resetUrl}\n\nSi no pediste esto, ignorá este correo.`,
  });

  if (error) {
    throw new Error(`Resend no pudo enviar el correo a ${to}: ${error.message}`);
  }
}
