import React from 'react';
import { Link } from 'react-router-dom';
import { LifemapAdminShell } from '../components/LifemapChrome';
import { PRIVACY_CONTACT_FALLBACK } from '../lib/password';

// Placeholder copy: legal review is required before these terms are published as final.
export default function TermsPage() {
  return (
    <LifemapAdminShell title="Terms of Use" kicker="LifeMap by BOX Wealth">
      <article className="lm-legal">
        <p className="lm-legal-meta">This is placeholder text pending legal review.</p>

        <h2>1. About LifeMap</h2>
        <p>
          LifeMap is an educational planning tool from BOX Wealth Advisors. Figures shown are illustrations based
          on the assumptions you enter. They are not a forecast, an offer, or investment advice.
        </p>

        <h2>2. Your account</h2>
        <p>
          Keep your sign-in details private and tell us promptly if you suspect misuse. You are responsible for the
          accuracy of the information you enter.
        </p>

        <h2>3. Acceptable use</h2>
        <p>
          Do not attempt to access other users&rsquo; data, interfere with the service, or use LifeMap for unlawful
          purposes.
        </p>

        <h2>4. No guarantee of returns</h2>
        <p>
          Investments are subject to market risk. Past performance does not guarantee future results. Speak to a
          qualified adviser before acting on any illustration.
        </p>

        <h2>5. Privacy</h2>
        <p>
          How we handle your personal data is described in our <Link to="/privacy">Privacy Notice</Link>.
        </p>

        <h2>6. Changes and contact</h2>
        <p>
          We may update these terms and will tell you about material changes. Questions:{' '}
          <a href={`mailto:${PRIVACY_CONTACT_FALLBACK}`}>{PRIVACY_CONTACT_FALLBACK}</a>
        </p>
      </article>
    </LifemapAdminShell>
  );
}
