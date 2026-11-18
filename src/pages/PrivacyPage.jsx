import React, { useEffect, useState } from 'react';
import { LifemapAdminShell } from '../components/LifemapChrome';
import ApiService from '../services/api';
import {
  PRIVACY_CONTACT_FALLBACK,
  PRIVACY_CONTACT_NAME_FALLBACK,
  PRIVACY_NOTICE_VERSION_FALLBACK,
} from '../lib/password';

// Placeholder copy: legal review is required before this notice is published as final.
// See docs/COMPLIANCE_OPS.md ("Final Privacy Notice handover") for what must be confirmed first.
export default function PrivacyPage() {
  const [meta, setMeta] = useState({
    version: PRIVACY_NOTICE_VERSION_FALLBACK,
    contactName: PRIVACY_CONTACT_NAME_FALLBACK,
    contactEmail: PRIVACY_CONTACT_FALLBACK,
  });

  useEffect(() => {
    ApiService.getPrivacyMeta()
      .then((res) => setMeta((prev) => ({
        ...prev,
        version: res.version || prev.version,
        contactName: res.contactName || prev.contactName,
        contactEmail: res.contactEmail || res.contact || prev.contactEmail,
      })))
      .catch(() => { /* keep the built-in values */ });
  }, []);

  return (
    <LifemapAdminShell title="Privacy Notice" kicker="LifeMap by BOX Wealth">
      <article className="lm-legal">
        <p className="lm-legal-meta">
          Version {meta.version}. This is a placeholder notice pending legal review.
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
          <li>Security records: sign-in times, device and IP information, failed sign-in attempts and activity logs, to keep your account safe and meet audit and legal obligations.</li>
        </ul>
        <p>We use this data only to provide LifeMap and the advisory services you ask for. We do not sell your personal data.</p>

        <h2>3. Who can see your plan</h2>
        <ul>
          <li>You.</li>
          <li>Your assigned relationship manager at BOX Wealth, if you have one.</li>
          <li>BOX Wealth operations staff who support LifeMap (super administrators), for support, security and compliance.</li>
          <li>BOX Wealth&rsquo;s privacy officer, to handle your privacy requests and complaints.</li>
        </ul>
        <p>
          Opening or changing a client&rsquo;s plan, signing in, and changes to accounts are recorded in an
          activity log. You can see your own account activity under &ldquo;Privacy &amp; Data&rdquo;.
        </p>

        <h2>4. How long we keep it</h2>
        <p>
          We keep your data while your account is active. When an account or a plan entry is deleted it is
          soft-deleted: it is held for <strong>90 days</strong> so it can be restored if the deletion was a mistake,
          and is then permanently removed. If a record is subject to a <strong>legal hold</strong> (for example a
          regulator&rsquo;s request, an investigation or litigation) it is kept until the hold is released.
          We may also retain specific records for as long as the law requires.
        </p>
        <p>
          Security and audit logs (the activity log) are retained for at least <strong>one year</strong> and are not
          edited or deleted during that time.
        </p>

        <h2>5. Your rights</h2>
        <p>
          You can ask us to correct your data, withdraw your consent, or raise a complaint at any time from
          &ldquo;Privacy &amp; Data&rdquo; in your account. We aim to respond within 90 days. If we cannot resolve your
          complaint you may approach the Data Protection Board of India.
        </p>

        <h2>6. Security</h2>
        <p>
          Sign-in uses a password plus a one-time code (emailed, or from an authenticator app for staff).
          Accounts are locked for a short time after repeated failed attempts, sessions end after a period of
          inactivity, and you can sign out of all devices from Privacy &amp; Data. Data is encrypted in transit
          and held in an encrypted database. If a personal data breach affects you, we will tell you and the
          Data Protection Board as the law requires.
        </p>

        <h2>7. Grievance officer and contact</h2>
        <p>
          Privacy questions, requests and grievances go to <strong>{meta.contactName}</strong>:{' '}
          <a href={`mailto:${meta.contactEmail}`}>{meta.contactEmail}</a>
        </p>
      </article>
    </LifemapAdminShell>
  );
}
