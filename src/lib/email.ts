import { Resend } from 'resend';
import { formatCurrency, formatDate } from './formatters';

// Adresse d'expedition du domaine de test Resend (aucune verification de domaine requise).
// Limitation connue : en mode sandbox, Resend n'autorise l'envoi qu'a l'adresse email
// du compte proprietaire, pas a n'importe quel client reel. Pour un envoi reel a tous
// les clients, un domaine verifie (ex. mail.riviera-pms.com) doit etre configure dans
// le dashboard Resend puis utilise ici a la place de FROM_ADDRESS.
const FROM_ADDRESS = 'Riviera Suite PMS <onboarding@resend.dev>';

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

interface ReservationConfirmationParams {
  guestEmail: string;
  guestName: string;
  confirmationNumber: string;
  hotelName: string;
  arrivalDate: string;
  departureDate: string;
  totalAmount: number;
  currencyCode: string;
}

/**
 * BUG-14 - Envoi de la confirmation de reservation. Echoue silencieusement (log seulement)
 * si RESEND_API_KEY est absente ou si l'envoi echoue : une panne d'email ne doit jamais
 * faire echouer la creation de la reservation elle-meme (deja committee en base a ce stade).
 */
export async function sendReservationConfirmation(params: ReservationConfirmationParams): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY absente, confirmation de reservation non envoyee');
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: params.guestEmail,
      subject: `Confirmation de réservation ${params.confirmationNumber} — ${params.hotelName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0E6FA0;">Réservation confirmée</h2>
          <p>Bonjour ${params.guestName},</p>
          <p>Votre réservation à <strong>${params.hotelName}</strong> est confirmée.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 4px 0; color: #5B6B79;">Confirmation</td><td style="text-align: right;">${params.confirmationNumber}</td></tr>
            <tr><td style="padding: 4px 0; color: #5B6B79;">Arrivée</td><td style="text-align: right;">${formatDate(params.arrivalDate)}</td></tr>
            <tr><td style="padding: 4px 0; color: #5B6B79;">Départ</td><td style="text-align: right;">${formatDate(params.departureDate)}</td></tr>
            <tr><td style="padding: 4px 0; color: #5B6B79;">Montant total</td><td style="text-align: right; font-weight: bold;">${formatCurrency(params.totalAmount, params.currencyCode)}</td></tr>
          </table>
          <p>Nous avons hâte de vous accueillir.</p>
        </div>
      `,
    });
    if (error) {
      console.error('[email] Échec envoi confirmation réservation:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] Exception envoi confirmation réservation:', err);
    return false;
  }
}

interface PaymentReceiptParams {
  guestEmail: string;
  guestName: string;
  hotelName: string;
  folioNumber: string;
  amount: number;
  method: string;
  currencyCode: string;
  newBalance: number;
}

const METHOD_LABELS: Record<string, string> = {
  card: 'Carte bancaire',
  cash: 'Espèces',
  bank_transfer: 'Virement',
  online: 'Paiement en ligne',
  voucher: 'Bon d\'échange',
  other: 'Autre',
};

/** BUG-14 - Envoi du reçu de paiement. Meme politique d'echec silencieux que ci-dessus. */
export async function sendPaymentReceipt(params: PaymentReceiptParams): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY absente, reçu de paiement non envoyé');
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: params.guestEmail,
      subject: `Reçu de paiement — Folio ${params.folioNumber} — ${params.hotelName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #2F7D4F;">Paiement reçu</h2>
          <p>Bonjour ${params.guestName},</p>
          <p>Nous avons bien reçu votre paiement pour votre séjour à <strong>${params.hotelName}</strong>.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 4px 0; color: #5B6B79;">Folio</td><td style="text-align: right;">${params.folioNumber}</td></tr>
            <tr><td style="padding: 4px 0; color: #5B6B79;">Méthode</td><td style="text-align: right;">${METHOD_LABELS[params.method] ?? params.method}</td></tr>
            <tr><td style="padding: 4px 0; color: #5B6B79;">Montant payé</td><td style="text-align: right; font-weight: bold;">${formatCurrency(params.amount, params.currencyCode)}</td></tr>
            <tr><td style="padding: 4px 0; color: #5B6B79;">Solde restant</td><td style="text-align: right;">${formatCurrency(params.newBalance, params.currencyCode)}</td></tr>
          </table>
          <p>Merci de votre confiance.</p>
        </div>
      `,
    });
    if (error) {
      console.error('[email] Échec envoi reçu paiement:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] Exception envoi reçu paiement:', err);
    return false;
  }
}
