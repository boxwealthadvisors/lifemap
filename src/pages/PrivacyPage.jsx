import React from 'react';
import { LifemapAdminShell } from '../components/LifemapChrome';
import { PRIVACY_CONTACT_FALLBACK, PRIVACY_NOTICE_VERSION_FALLBACK } from '../lib/password';

// Placeholder copy: legal review is required before this notice is published as final.
export default function PrivacyPage() {
  return (
    <LifemapAdminShell title="Privacy Notice" kicker="LifeMap by BOX Wealth">
      <article className="lm-legal">
        <p className="lm-legal-meta">
          Version {PRIVACY_NOTICE_VERSION_FALLBACK}. This is a placeholder notice pending legal review.
        </p>

        <h2>1. Who we are</h2>
        <p>
          LifeMap is an educational financial planning tool operated by BOX Wealth Advisors
          (&ldquo;BOX Wealth&rdquo;, &ldquo;we&rdquo;). We are the data fiduciary for the personal data you give us
          through LifeMap, as defined in the Digital Personal Data Protection Act, 2023 (DPDP Act).
        </p>

        <h2>2. What we collect and why</h2>
        <ul>
          <li>Account details: your name, email address and a securely hashed password, to create and protect your account.</li>
          <li>Plan details you enter: age, income, assets, goals, loans, expenses and insurance, to calculate and save your plan.</li>
          <li>Security records: sign-in times, device and IP information and activity logs, to keep your account safe and meet audit obligations.</li>
        </ul>
        <p>We use this data only to provide LifeMap and the advisory services you ask for. We do not sell your personal data.</p>

        <h2>3. Who can see your plan</h2>
        <p>
          Your plan is visible to you and to the BOX Wealth advisor assigned to you. Super administrators can
          view accounts for support, security and compliance. Staff actions on client records are logged.
        </p>

        <h2>4. How long we keep it</h2>
        <p>
          We keep your data while your account is active. Deleted accounts are held for 90 days so they can be
          restored, and are then permanently removed unless the law requires us to retain specific records.
        </p>

        <h2>5. Your rights</h2>
        <p>
          You can ask us to correct your data, withdraw your consent, or raise a complaint at any time from
          &ldquo;Privacy &amp; Data&rdquo; in your account. We aim to respond within 90 days. If we cannot resolve your
          complaint you may approach the Data Protection Board of India.
        </p>

        <h2>6. Security</h2>
        <p>
          Sign-in uses a password plus an emailed one-time code. Sessions end after 60 minutes of inactivity,
          and you can sign out of all devices from Privacy &amp; Data.
        </p>

        <h2>7. Contact</h2>
        <p>
          Privacy questions and requests:{' '}
          <a href={`mailto:${PRIVACY_CONTACT_FALLBACK}`}>{PRIVACY_CONTACT_FALLBACK}</a>
        </p>
      </article>
    </LifemapAdminShell>
  );
}
