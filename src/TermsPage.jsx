import React from 'react';
import { LegalShell, LegalH2, LegalH3, LegalP, LegalUl, LegalLi, LegalTable } from './PublicPages';

const UPDATED = '11 July 2026';

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated={UPDATED}>
      <LegalP>
        These Terms are a legal agreement between you and <strong>Trbo</strong> ("Trbo", "we", "us", "our") governing
        your use of the Trbo indoor cycling training application, website and related services (the "Service").
      </LegalP>
      <LegalP><strong>By creating an account or using the Service, you agree to these Terms.</strong> If you do not agree, do not use the Service.</LegalP>
      <LegalP><strong>Please read section 5 (Health and safety) carefully.</strong> It is the most important part of this agreement.</LegalP>

      <LegalH2>1. Eligibility and your account</LegalH2>
      <LegalP>
        You must be at least <strong>16 years old</strong>. You are responsible for keeping your login secure and
        for activity under your account. Tell us at <a href="mailto:Trbo.help@outlook.com" style={{ color: '#2FC5AE' }}>Trbo.help@outlook.com</a> if
        you think it has been compromised. Give us accurate information and keep it current.
      </LegalP>

      <LegalH2>2. The Service</LegalH2>
      <LegalP>
        Trbo provides structured indoor cycling workouts, long-form Rides, Mini Games, a periodised training plan
        builder, FTP tracking, training-load analysis, workout history, activity export, and — where your hardware
        and browser support it — control of a compatible smart trainer's resistance in ERG mode.
      </LegalP>
      <LegalP>
        We may add, change, suspend or remove features. We will try to give reasonable notice before removing a
        feature you rely on, but we are not obliged to keep any particular feature available.
      </LegalP>

      <LegalH2>3. Hardware and browser compatibility — important</LegalH2>
      <LegalP>
        Trbo connects to trainers and heart rate monitors using <strong>Web Bluetooth</strong>, a browser technology
        that <strong>Apple does not support on iPhone or iPad in any browser</strong>. Chrome and Edge on iOS are
        affected too, because Apple requires all iOS browsers to use its own engine.
      </LegalP>
      <LegalP>
        <strong>This means Trbo's trainer control does not currently work on iPhone or iPad.</strong> Trbo works on
        Android (Chrome), ChromeOS, and desktop Chrome or Edge. Support also varies between trainer models and
        browser versions.
      </LegalP>
      <LegalP>
        <strong>Please confirm the Service works with your equipment before you subscribe.</strong> We do not
        guarantee compatibility with any particular device, and we are not the manufacturer of your trainer or heart
        rate monitor and are not responsible for their performance, firmware or defects.
      </LegalP>
      <LegalP>
        <strong>Metrics are estimates.</strong> Power, Training Stress Score, calories, FTP estimates and
        training-load figures are approximations that depend on your equipment's accuracy and calibration. Do not
        rely on them for medical, clinical or competitive purposes.
      </LegalP>

      <LegalH2>4. Third-party services</LegalH2>
      <LegalP>
        The Service integrates with Stripe, Strava and Google. Your use of those services is governed by their own
        terms and privacy policies, and we are not responsible for their availability or acts.
      </LegalP>

      <LegalH2>5. Health and safety — read this</LegalH2>
      <LegalP><strong>Trbo is a fitness tool, not a medical device. Nothing in the Service is medical advice.</strong></LegalP>
      <LegalUl>
        <LegalLi><strong>Consult a doctor before starting.</strong> Indoor cycling is strenuous. Seek medical advice before beginning any training program, particularly if you have a heart condition, high blood pressure, chest pain, dizziness, a joint or bone condition, are pregnant, are recovering from illness or injury, or are over 35 and inactive.</LegalLi>
        <LegalLi><strong>Stop immediately</strong> if you feel pain, chest tightness, faintness, severe breathlessness, nausea, or anything else that concerns you, and seek medical attention.</LegalLi>
        <LegalLi><strong>ERG mode.</strong> In ERG mode your trainer changes resistance automatically to hold a target wattage, including sudden increases when an interval begins. This can strain muscles, joints and equipment and can cause loss of control if you are unprepared. You are responsible for setting a sensible FTP, choosing appropriate workouts, and remaining in control of your bike. You may pause, reduce intensity or stop at any time.</LegalLi>
        <LegalLi><strong>Trbo does not monitor you.</strong> We do not store your heart rate, we do not watch for signs of distress, we cannot detect a medical emergency, and we will not call for help. Never train alone if a condition makes that unsafe.</LegalLi>
        <LegalLi><strong>You train at your own risk.</strong> You alone judge whether a workout, Ride, Mini Game or plan is safe and appropriate for you, and you are responsible for your bike, trainer, setup, ventilation and hydration.</LegalLi>
      </LegalUl>
      <LegalP>To the maximum extent permitted by law, you assume all risk arising from exercise you undertake using the Service.</LegalP>

      <LegalH2>6. Subscriptions and payments</LegalH2>
      <LegalP>
        <strong>Plans.</strong> Trbo offers a monthly subscription at <strong>US$8.99 per month</strong> and an
        annual subscription at <strong>US$89.99 per year</strong> (10 months paid upfront, 2 months free). Prices are
        shown at checkout and may exclude taxes, which are added where applicable.
      </LegalP>
      <LegalP>
        <strong>Auto-renewal.</strong> Subscriptions renew automatically at the end of each billing period and your
        payment method is charged until you cancel. By subscribing you authorise us and Stripe to charge you on a
        recurring basis.
      </LegalP>
      <LegalP><strong>Cancelling.</strong> Cancel any time in the app or by emailing us. Cancellation takes effect at the end of your current billing period and you keep access until then.</LegalP>
      <LegalP><strong>Price changes.</strong> We will give you at least <strong>30 days' notice</strong> before a price change affects a renewal. You may cancel before it takes effect.</LegalP>
      <LegalP><strong>Failed payments.</strong> We may retry a failed payment and may suspend paid features until it succeeds.</LegalP>
      <LegalP><strong>Free access.</strong> Some parts of the Service, including any demo ride, may be free. We may change or withdraw free access at any time.</LegalP>

      <LegalH2>7. Refunds and your statutory rights</LegalH2>
      <LegalP>
        <strong>Australian consumers.</strong> Nothing in these Terms excludes, restricts or modifies the consumer
        guarantees under the Competition and Consumer Act 2010 (Cth). Our services come with guarantees that cannot
        be excluded under the Australian Consumer Law, including that they will be supplied with due care and skill.
        If the Service fails to meet a consumer guarantee you may be entitled to a refund, a re-supply, or
        compensation for reasonably foreseeable loss.
      </LegalP>
      <LegalP>
        <strong>EU and UK consumers — 14-day right of withdrawal.</strong> If you are a consumer in the EU or UK, you
        normally have <strong>14 days</strong> from the date you subscribe to withdraw from the contract and receive
        a full refund, without giving a reason.
      </LegalP>
      <LegalP>
        Because Trbo gives you immediate access to paid features the moment you subscribe, <strong>at checkout you
        will be asked to expressly request that we begin supplying the Service immediately, and to acknowledge that
        you therefore lose your right of withdrawal once supply has begun.</strong> If you do not give that
        acknowledgement, we will not start your subscription until the 14-day period has passed. To withdraw within
        any applicable period, email <a href="mailto:Trbo.help@outlook.com" style={{ color: '#2FC5AE' }}>Trbo.help@outlook.com</a>.
      </LegalP>
      <LegalP>
        <strong>Everyone else.</strong> Outside the rights described above, subscription fees are non-refundable.
        Nothing in these Terms removes any right you have under the mandatory consumer law of your own country.
      </LegalP>

      <LegalH2>8. Acceptable use</LegalH2>
      <LegalP>
        You agree not to: share, resell or sublicense your account; reverse engineer, decompile, scrape or copy the
        Service, its workout library or its code (except where that right cannot lawfully be excluded); circumvent
        paywalls, authentication, rate limits or security controls; upload false or manipulated activity data, or
        upload activity to Strava that you did not perform; use the Service unlawfully or to harass, defame or harm
        anyone; or interfere with the Service or attempt unauthorised access to our systems or another user's
        account.
      </LegalP>
      <LegalP>We may suspend or terminate your account if you breach this section.</LegalP>

      <LegalH2>9. Intellectual property</LegalH2>
      <LegalP>
        The Service — its software, design, artwork, workout library, Rides, Mini Games and branding — is owned by
        us or our licensors. We grant you a limited, personal, non-exclusive, non-transferable, revocable licence to
        use it for your own non-commercial training. All other rights are reserved.
      </LegalP>

      <LegalH2>10. Your data</LegalH2>
      <LegalP>
        Your training data belongs to you. You grant us a licence to store, process and display it solely to operate
        the Service for you. Our handling of your personal information is set out in our <a href="/privacy" style={{ color: '#2FC5AE' }}>Privacy Policy</a>, which
        forms part of these Terms.
      </LegalP>
      <LegalP>
        <strong>We do not store your heart rate.</strong> It is displayed live and written into any workout file you
        export to your own device, and is otherwise discarded.
      </LegalP>
      <LegalP>You can export your workouts as TCX or FIT files, and delete your account, at any time.</LegalP>

      <LegalH2>11. Availability</LegalH2>
      <LegalP>
        We aim to keep the Service running but do not promise it will be uninterrupted, error-free or available at
        any particular time. It may be unavailable due to maintenance, updates, or failures of our providers. We are
        not liable for interruptions outside our reasonable control.
      </LegalP>

      <LegalH2>12. Disclaimers and limitation of liability</LegalH2>
      <LegalP><strong>Subject to section 7 and to any rights that cannot lawfully be excluded:</strong></LegalP>
      <LegalP>
        The Service is provided <strong>"as is" and "as available"</strong>, without warranties of any kind, express
        or implied, including implied warranties of merchantability, fitness for a particular purpose, accuracy and
        non-infringement.
      </LegalP>
      <LegalP>
        To the maximum extent permitted by law, we are not liable for: any personal injury, death, illness or
        aggravation of an existing condition arising from exercise undertaken using the Service; any indirect,
        incidental, special, consequential or punitive loss, or loss of data, profits, revenue, goodwill or training
        records; damage to your bike, trainer or other equipment; or the acts, omissions, outages or data handling
        of third parties, including Stripe, Strava, Google, Supabase and Vercel.
      </LegalP>
      <LegalP>
        Where our liability can be limited but not excluded, our total aggregate liability for all claims is
        limited, at our option, to re-supplying the Service or to <strong>the amount you paid us in the 12 months
        before the claim arose</strong>.
      </LegalP>

      <LegalH2>13. Indemnity</LegalH2>
      <LegalP>
        You agree to indemnify us against any claim, loss, damage or cost (including reasonable legal costs) arising
        from your breach of these Terms, your misuse of the Service, or your violation of another person's rights —
        except to the extent caused by our own negligence or breach.
      </LegalP>

      <LegalH2>14. Termination</LegalH2>
      <LegalP>
        You may stop using the Service and delete your account at any time. We may suspend or terminate your access
        if you breach these Terms, if required by law, or if we discontinue the Service. If we discontinue the
        Service entirely, we will give reasonable notice and refund the unused portion of any prepaid subscription.
      </LegalP>
      <LegalP>Sections 5, 9, 10, 12, 13 and 15 survive termination.</LegalP>

      <LegalH2>15. General</LegalH2>
      <LegalP>
        <strong>Changes to these Terms.</strong> We may update these Terms. If a change is material we will notify
        you in the app or by email at least <strong>14 days</strong> before it takes effect. Continuing to use the
        Service after that means you accept the new Terms; if you do not, you may cancel.
      </LegalP>
      <LegalP>
        <strong>Governing law.</strong> These Terms are governed by the laws of <strong>New South Wales,
        Australia</strong>, and you and we submit to the non-exclusive jurisdiction of its courts. <strong>If you
        are a consumer, this does not deprive you of the protection of the mandatory laws of your country of
        residence, or of your right to bring proceedings there.</strong>
      </LegalP>
      <LegalP><strong>Severability.</strong> If any part of these Terms is unenforceable, the rest remains in force.</LegalP>
      <LegalP><strong>Entire agreement.</strong> These Terms and the Privacy Policy are the entire agreement between us about the Service.</LegalP>
      <LegalP><strong>No waiver.</strong> If we do not enforce a right, that is not a waiver of it.</LegalP>

      <LegalH2>16. Contact</LegalH2>
      <LegalP>
        <strong>Trbo</strong><br />
        Email: <a href="mailto:Trbo.help@outlook.com" style={{ color: '#2FC5AE' }}>Trbo.help@outlook.com</a><br />
        Address: 301/19-21 Wilson St, Botany NSW 2019
      </LegalP>
    </LegalShell>
  );
}
