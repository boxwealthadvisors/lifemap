import React, { useEffect, useState } from 'react';
import { LifemapAdminShell } from '../components/LifemapChrome';
import ApiService from '../services/api';
import {
  PRIVACY_CONTACT_FALLBACK,
  PRIVACY_CONTACT_NAME_FALLBACK,
  PRIVACY_NOTICE_VERSION_FALLBACK,
} from '../lib/password';

export default function PrivacyPage() {
  const [meta, setMeta] = useState({
    version: PRIVACY_NOTICE_VERSION_FALLBACK,
    contactName: PRIVACY_CONTACT_NAME_FALLBACK,
    contactEmail: PRIVACY_CONTACT_FALLBACK,
    hostingRegion: 'Oregon, United States (Render)',
  });

  useEffect(() => {
    ApiService.getPrivacyMeta()
      .then((res) => setMeta((prev) => ({
        ...prev,
        version: res.version || prev.version,
        contactName: res.contactName || prev.contactName,
        contactEmail: res.contactEmail || res.contact || prev.contactEmail,
        hostingRegion: res.hostingRegion || prev.hostingRegion,
      })))
      .catch(() => { /* keep the built-in values */ });
  }, []);

  return (
    <LifemapAdminShell title="Privacy Notice" kicker="LifeMap by BOX Wealth">
      <article className="lm-legal">
        <p className="lm-legal-meta">
          Version {meta.version}. Pending final legal review; this is the working notice BOX Wealth has approved for use until counsel signs off.
        </p>

        <h2>1. Who we are</h2>
        <p>
          LifeMap is an educational financial planning tool operated by BOX Wealth Advisors
          (&ldquo;BOX Wealth&rdquo;, &ldquo;we&rdquo;), D-33, Ground Floor, Sector 2, Noida 201301, Uttar Pradesh.
          We are the data fiduciary for the personal data you give us through LifeMap, as defined in the
          Digital Personal Data Protection Act, 2023 (DPDP Act).
        </p>

        <h2>2. What we collect and why</h2>
        <ul>
          <li>Account details: your name, email address and a securely hashed password, to create and protect your account.</li>
          <li>Plan details you enter: age, work tenure, income, assets, goals, loans, expenses and insurance, to calculate and save your plan.</li>
          <li>Family members: names, relationship and income of family members you add, to include their income and needs in your plan. Please add only what your plan needs.</li>
          <li>Growth assumptions you choose (returns, inflation, life expectancy), to calculate your projections.</li>
          <li>Security records: sign-in times, device and IP information, failed sign-in attempts and activity logs, to keep your account safe and meet audit and legal obligations.</li>
        </ul>
        <p>
          We use this data only to provide LifeMap and the advisory services you ask for. We do not sell your
          personal data and do not use it for advertising.
        </p>

        <h2>3. Your consent</h2>
        <p>
          When you create an account, we ask for your consent to use your data as described in this notice.
          You can withdraw consent at any time from &ldquo;Privacy &amp; Data&rdquo;, as easily as you gave it.
          We will then stop using your data and close your account, except for records we must keep by law
          (see section 6). Withdrawing consent does not affect anything we did with your data before you withdrew it.
        </p>

        <h2>4. Who can see your plan</h2>
        <ul>
          <li>You.</li>
          <li>Your assigned relationship manager at BOX Wealth, if you have one.</li>
          <li>BOX Wealth operations staff who support LifeMap (super administrators), for support, security and compliance.</li>
          <li>BOX Wealth&rsquo;s privacy officer, to handle your privacy requests and complaints.</li>
          <li>Our technology service providers, who host LifeMap and send emails for us, only to run the service and under contracts that require them to protect your data.</li>
        </ul>
        <p>
          Opening or changing a client&rsquo;s plan, signing in, and changes to accounts are recorded in an
          activity log. You can see your own account activity under &ldquo;Privacy &amp; Data&rdquo;. We share
          data with government or regulatory authorities only when the law requires it.
        </p>

        <h2>5. Where your data is stored</h2>
        <p>
          Your data is stored on secure cloud servers operated by Render in{' '}
          <strong>{meta.hostingRegion}</strong>, outside India. Indian law permits this, and we protect your
          data the same way wherever it is stored. If the hosting region changes, we will update this notice.
        </p>

        <h2>6. How long we keep it</h2>
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

        <h2>7. Your rights</h2>
        <p>From &ldquo;Privacy &amp; Data&rdquo; in your account, you can:</p>
        <ul>
          <li>ask for a summary of the personal data we hold about you, how we use it, and who we have shared it with;</li>
          <li>ask us to correct or update your data;</li>
          <li>withdraw your consent, close your account and ask us to delete your data;</li>
          <li>raise a complaint; and</li>
          <li>nominate a person to use these rights on your behalf if you die or are unable to.</li>
        </ul>
        <p>
          Each request gets a reference number. We will respond within 90 days. If we cannot resolve your
          complaint you may approach the Data Protection Board of India.
        </p>

        <h2>8. Security</h2>
        <p>
          Sign-in uses a password plus a one-time code (emailed, or from an authenticator app for staff).
          Accounts are locked for a short time after repeated failed attempts, sessions end after a period of
          inactivity, and you can sign out of all devices from Privacy &amp; Data. Data is encrypted in transit
          and held in an encrypted database. If a personal data breach affects you, we will tell you and the
          Data Protection Board as the law requires, including what happened, what data was affected, what we
          are doing about it and what you can do.
        </p>

        <h2>9. Children</h2>
        <p>
          You must be 18 or older to create a LifeMap account. If you add details about a child (for example,
          an education goal), you do so as their parent or guardian.
        </p>

        <h2>10. Grievance officer and contact</h2>
        <p>
          Privacy questions, requests and grievances go to <strong>{meta.contactName}</strong>:{' '}
          <a href={`mailto:${meta.contactEmail}`}>{meta.contactEmail}</a>, BOX Wealth Advisors,
          D-33, Ground Floor, Sector 2, Noida 201301, Uttar Pradesh.
        </p>

        <h2>11. Changes to this notice</h2>
        <p>
          If we make important changes, we will tell you by email or when you next sign in, and may ask you
          to accept the new version. The version and date are shown at the top.
        </p>
      </article>
    </LifemapAdminShell>
  );
}
