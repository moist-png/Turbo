import React from 'react';
import { LegalShell, LegalH2, LegalH3, LegalP, LegalUl, LegalLi, LegalTable } from './PublicPages';

const UPDATED = '11 July 2026';
const LINK = { color: '#2FC5AE' };

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={UPDATED}>
      <LegalH2>1. Who we are</LegalH2>
      <LegalP>
        Trbo ("Trbo", "we", "us", "our") is an indoor cycling training application operated by <strong>Trbo</strong> of
        301/19-21 Wilson St, Botany NSW 2019, Australia.
      </LegalP>
      <LegalP>Contact us about privacy at <a href="mailto:Trbo.help@outlook.com" style={LINK}>Trbo.help@outlook.com</a>.</LegalP>
      <LegalP>
        This policy explains what personal information we collect, why, who we share it with, and what rights you
        have. It reflects the Australian Privacy Principles under the Privacy Act 1988 (Cth) and, where they apply
        to you, the EU and UK General Data Protection Regulation ("GDPR").
      </LegalP>

      <LegalH2>2. We do not collect health or biometric data</LegalH2>
      <LegalP>This is the most important thing to know about Trbo, so we have put it first.</LegalP>
      <LegalP>
        <strong>Trbo does not store your heart rate.</strong> If you pair a heart rate monitor, your heart rate is
        read directly from the strap to your device over Bluetooth, shown on screen while you ride, and then
        discarded. It is never transmitted to our servers, never written to our database, and never sent to Strava
        or any other third party.
      </LegalP>
      <LegalP>
        The only place your heart rate persists is inside the workout file (<code>.tcx</code> or <code>.fit</code>)
        that <strong>you</strong> choose to export to <strong>your own device</strong>. That file is generated in
        your browser and downloaded by you. We never receive a copy.
      </LegalP>
      <LegalP>
        We also do <strong>not</strong> collect: biometric identifiers, physiological measurements other than the
        transient heart rate described above, medical history, your weight, Apple Health / HealthKit data, Google
        Fit data, or your location.
      </LegalP>
      <LegalP>
        <strong>We treat the training metrics we do store (power, FTP, Training Stress Score, calories, duration)
        as athletic performance data, not health information.</strong> They describe how hard you pedalled, not your
        physical condition.
      </LegalP>

      <LegalH2>3. What we do collect</LegalH2>
      <LegalH3>3.1 Information you give us</LegalH3>
      <LegalUl>
        <LegalLi><strong>Account information.</strong> Your email address and a securely hashed password, or (if you sign in with Google) your email address, name and Google account identifier.</LegalLi>
        <LegalLi><strong>Training profile.</strong> Your Functional Threshold Power (FTP), FTP history, training plan settings and workout preferences.</LegalLi>
        <LegalLi><strong>Support correspondence.</strong> Anything you send us by email or in-app feedback.</LegalLi>
      </LegalUl>
      <LegalH3>3.2 Information generated when you train</LegalH3>
      <LegalUl>
        <LegalLi><strong>Workout records.</strong> For each completed session: the workout name and category, duration, average and maximum power, Training Stress Score, estimated calories, whether you finished, and the date.</LegalLi>
        <LegalLi><strong>Mini Games records.</strong> Personal bests are stored <strong>only in your browser on your device</strong>. They never reach our servers, and are lost if you clear your browser data.</LegalLi>
      </LegalUl>
      <LegalH3>3.3 Device connections (Bluetooth)</LegalH3>
      <LegalP>
        Trbo talks to your smart trainer and heart rate monitor directly from your browser to the device. <strong>We
        never receive or store Bluetooth device identifiers.</strong> Your browser asks your permission before each
        connection. Power and cadence are processed on your device; only the summary metrics in 3.2 are saved.
      </LegalP>
      <LegalH3>3.4 Payments</LegalH3>
      <LegalP>
        Subscriptions are processed by <strong>Stripe</strong>. We never see or store your card number, CVC or
        expiry date. Stripe tells us only your customer ID, subscription status, plan and billing period, so we can
        unlock paid features. Stripe handles your card details as an independent controller under its own policy.
      </LegalP>
      <LegalH3>3.5 Strava</LegalH3>
      <LegalP>
        If you connect Strava, we store the access and refresh tokens it issues so we can upload your completed
        workouts at your request. We upload the workout name, duration, date and power summary, <strong>not heart
        rate</strong>. Disconnect at any time and we delete the tokens.
      </LegalP>
      <LegalH3>3.6 Technical information</LegalH3>
      <LegalP>Our hosting providers automatically log IP address, browser and device type, pages requested and timestamps, for security and fault diagnosis.</LegalP>
      <LegalP>We use <strong>no advertising cookies and no third-party advertising trackers</strong>. Browser storage is used only for essentials: keeping you signed in, remembering your theme, and Mini Games bests.</LegalP>

      <LegalH2>4. Why we use it</LegalH2>
      <LegalP>
        We use your information to run your account; deliver workouts, Rides, Mini Games and training plans; control
        your trainer in ERG mode; calculate training metrics and show your history and progress; process
        subscriptions; upload to Strava when you ask; provide support; keep the Service secure; and comply with the
        law.
      </LegalP>
      <LegalP>We do <strong>not</strong> sell your personal information. We do <strong>not</strong> use your data for advertising. We do <strong>not</strong> use it to train machine learning models.</LegalP>
      <LegalH3>Legal bases (EU/UK users)</LegalH3>
      <LegalTable
        headers={['Purpose', 'Legal basis']}
        rows={[
          ['Your account and the Service itself', 'Performance of a contract'],
          ['Payments and billing', 'Contract; legal obligation'],
          ['Uploading to Strava', 'Your consent'],
          ['Security, fraud prevention, diagnostics', 'Legitimate interests'],
          ['Tax and accounting records', 'Legal obligation'],
        ]}
      />
      <LegalP>
        Because we do not store heart rate or any other health or biometric data, <strong>we do not process special
        category data under Article 9 GDPR</strong>, and no explicit-consent mechanism is required.
      </LegalP>

      <LegalH2>5. Automated decisions</LegalH2>
      <LegalP>
        Trbo generates workout suggestions, training plans and FTP estimates automatically from your training
        history. These are <strong>recommendations only</strong>. They produce no legal effect and no similarly
        significant effect on you, you are free to ignore them, and no human profiling, scoring or eligibility
        decision is made about you. You may request a human explanation of any suggestion by emailing us.
      </LegalP>

      <LegalH2>6. Who we share it with</LegalH2>
      <LegalTable
        headers={['Provider', 'Purpose', 'Location']}
        rows={[
          ['Supabase', 'Database and authentication', 'United States'],
          ['Vercel', 'Hosting and serverless functions', 'Global edge network'],
          ['Stripe', 'Payments and subscriptions', 'United States / global'],
          ['Strava', 'Activity upload: only if you connect it', 'United States'],
          ['Google', 'Sign-in: only if you use it', 'Global'],
        ]}
      />
      <LegalP>
        We may also disclose information where required by law, to enforce our Terms, or to protect the safety of
        our users or the public. If Trbo is sold or merged, your information may transfer to the acquirer, who will
        remain bound by this policy or one at least as protective; we will tell you first.
      </LegalP>

      <LegalH2>7. Overseas transfers</LegalH2>
      <LegalP>
        We operate from Australia. Our providers store and process data overseas, primarily in the <strong>United
        States</strong>. For transfers of EU and UK personal data we rely on <strong>Standard Contractual
        Clauses</strong> incorporated into our data processing agreements with each provider. For Australian users,
        we take reasonable steps under APP 8 to ensure overseas recipients handle your information consistently with
        the Australian Privacy Principles.
      </LegalP>

      <LegalH2>8. How long we keep it</LegalH2>
      <LegalUl>
        <LegalLi><strong>Account and training data</strong>: while your account is open; deleted within <strong>30 days</strong> of you deleting your account, and purged from backups within <strong>90 days</strong>.</LegalLi>
        <LegalLi><strong>Billing records</strong>: as required by Australian tax law, generally <strong>7 years</strong>.</LegalLi>
        <LegalLi><strong>Strava tokens</strong>: until you disconnect.</LegalLi>
        <LegalLi><strong>Technical logs</strong>: a short retention period set by our providers.</LegalLi>
        <LegalLi><strong>Heart rate</strong>: never retained. There is nothing to delete.</LegalLi>
      </LegalUl>
      <LegalP>You can delete individual workouts from your history at any time.</LegalP>

      <LegalH2>9. Security</LegalH2>
      <LegalP>
        We use HTTPS/TLS in transit, encryption at rest, row-level security so you can only ever read and write your
        own records, and hashed passwords managed by our authentication provider. Card details never touch our
        servers.
      </LegalP>
      <LegalP>
        No system is perfectly secure. If a data breach is likely to cause you serious harm, we will notify you and
        the Office of the Australian Information Commissioner under the Notifiable Data Breaches scheme, and, where
        the GDPR applies, the relevant supervisory authority within 72 hours.
      </LegalP>

      <LegalH2>10. Your rights</LegalH2>
      <LegalP>
        Wherever you live, you can <strong>access</strong> your information, <strong>correct</strong> it,
        <strong> export</strong> your workouts as TCX or FIT, <strong>delete</strong> your account and its data,
        <strong> withdraw consent</strong> to Strava, and <strong>complain</strong> to us.
      </LegalP>
      <LegalP><strong>If you are in the EU or UK</strong>, you additionally have the rights to data portability, to object to or restrict processing, and to lodge a complaint with your local supervisory authority.</LegalP>
      <LegalP><strong>If you are in Australia</strong>, you may complain to the Office of the Australian Information Commissioner at oaic.gov.au.</LegalP>
      <LegalP><strong>If you are in California</strong>, we confirm we do not sell or share your personal information, and we will not discriminate against you for exercising any privacy right.</LegalP>
      <LegalP>Email <a href="mailto:Trbo.help@outlook.com" style={LINK}>Trbo.help@outlook.com</a> to exercise any right. We respond within <strong>30 days</strong>.</LegalP>

      <LegalH2>11. Children</LegalH2>
      <LegalP>
        You must be at least <strong>16 years old</strong> to use Trbo. We do not knowingly collect information from
        anyone under 16. If you believe a child has given us their information, contact us and we will delete it.
      </LegalP>

      <LegalH2>12. Changes</LegalH2>
      <LegalP>
        We may update this policy. If a change is material, we will notify you in the app or by email before it
        takes effect. The version and date at the top always reflect the current text.
      </LegalP>

      <LegalH2>13. Contact</LegalH2>
      <LegalP>
        <strong>Trbo</strong><br />
        Email: <a href="mailto:Trbo.help@outlook.com" style={LINK}>Trbo.help@outlook.com</a><br />
        Address: 301/19-21 Wilson St, Botany NSW 2019
      </LegalP>
    </LegalShell>
  );
}
