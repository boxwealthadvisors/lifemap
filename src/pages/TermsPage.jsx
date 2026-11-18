import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifemapAdminShell } from '../components/LifemapChrome';
import ApiService from '../services/api';
import { PRIVACY_CONTACT_FALLBACK, PRIVACY_CONTACT_NAME_FALLBACK } from '../lib/password';

export default function TermsPage() {
  const [contact, setContact] = useState({
    name: PRIVACY_CONTACT_NAME_FALLBACK,
    email: PRIVACY_CONTACT_FALLBACK,
  });

  useEffect(() => {
    ApiService.getPrivacyMeta()
      .then((res) => setContact({
        name: res.contactName || PRIVACY_CONTACT_NAME_FALLBACK,
        email: res.contactEmail || res.contact || PRIVACY_CONTACT_FALLBACK,
      }))
      .catch(() => {});
  }, []);

  return (
    <LifemapAdminShell title="Terms of Use" kicker="LifeMap by BOX Wealth">
      <article className="lm-legal">
        <p className="lm-legal-meta">
          Pending final legal review; this is the working text BOX Wealth has approved for use until counsel signs off.
          Courts jurisdiction city is left for legal to confirm.
        </p>

        <h2>1. About LifeMap</h2>
        <p>
          LifeMap is an educational planning tool from BOX Wealth Advisors. Figures shown are illustrations based
          on the assumptions you enter. They are not a forecast, an offer, or investment advice. By creating an
          account or using LifeMap, you agree to these terms.
        </p>

        <h2>2. Who can use LifeMap</h2>
        <p>
          You must be 18 or older and give true and current information. One account is for one person.
        </p>

        <h2>3. Your account</h2>
        <p>
          Keep your sign-in details private and tell us promptly if you suspect misuse. You are responsible for the
          accuracy of the information you enter.
        </p>

        <h2>4. Your BOX Wealth team&rsquo;s access</h2>
        <p>
          If you are a BOX Wealth client, your assigned relationship manager and authorised BOX Wealth staff can
          view your plan and may update it to support you. Every view and change is recorded, as described in our{' '}
          <Link to="/privacy">Privacy Notice</Link>.
        </p>

        <h2>5. Acceptable use</h2>
        <p>
          Do not attempt to access other users&rsquo; data, interfere with the service, upload harmful files, copy
          or resell LifeMap, or use LifeMap for unlawful purposes. We may suspend or close accounts that break
          these terms.
        </p>

        <h2>6. No guarantee of returns</h2>
        <p>
          Investments are subject to market risk. Past performance does not guarantee future results. Speak to a
          qualified adviser before acting on any illustration. Personalised advice from BOX Wealth is given only
          under a separate advisory agreement, not through LifeMap alone.
        </p>

        <h2>7. Privacy</h2>
        <p>
          How we handle your personal data is described in our <Link to="/privacy">Privacy Notice</Link>.
        </p>

        <h2>8. Closing your account</h2>
        <p>
          You can close your account at any time from &ldquo;Privacy &amp; Data&rdquo;. Your data will be handled
          as described in our Privacy Notice.
        </p>

        <h2>9. Governing law</h2>
        <p>
          These terms are governed by the laws of India. Courts at Noida / Gautam Buddha Nagar, Uttar Pradesh
          (to be confirmed by legal counsel) will have jurisdiction.
        </p>

        <h2>10. Changes and contact</h2>
        <p>
          We may update these terms and will tell you about material changes. Questions:{' '}
          <strong>{contact.name}</strong>,{' '}
          <a href={`mailto:${contact.email}`}>{contact.email}</a>
        </p>
      </article>
    </LifemapAdminShell>
  );
}
