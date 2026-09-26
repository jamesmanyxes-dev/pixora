import React from 'react';

export function LegalPage({ kind, onBack }: { kind: 'privacy' | 'terms'; onBack: () => void }) {
  const isPrivacy = kind === 'privacy';
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-300">
      <div className="max-w-2xl mx-auto p-6 pb-24">
        <button onClick={onBack} className="text-neutral-400 hover:text-white text-sm mb-4">← Back to Pixora</button>
        <h1 className="text-white text-2xl font-bold mb-6">{isPrivacy ? 'Privacy Policy' : 'Terms of Service'}</h1>
        <p className="text-xs text-neutral-500 mb-8">Last updated: September 26, 2026</p>

        {isPrivacy ? (
          <div className="space-y-6 text-sm leading-relaxed">
            <section><h2 className="text-white font-semibold mb-2">1. What we collect</h2>
              <p><b>Account data:</b> email address, username, display name, profile photo, and — if you verify your phone — your phone number. If you sign in with Google, we receive your Google account name, email, and profile picture.</p>
              <p><b>Content you create:</b> posts, reels, stories, comments, messages, voice notes, and media you upload.</p>
              <p><b>Usage data:</b> login history (device, IP, timestamps), profile visits, post views, and interaction counts used for analytics and recommendations.</p></section>
            <section><h2 className="text-white font-semibold mb-2">2. How we use it</h2>
              <p>To operate the platform: showing your content to followers, delivering messages in real time, personalizing your feed, notifying you about activity you choose, keeping accounts secure (2FA, login alerts), and moderating content to keep Pixora safe.</p></section>
            <section><h2 className="text-white font-semibold mb-2">3. What we don't do</h2>
              <p>We do not sell your personal data. We do not read your private messages — messages are stored to sync across your devices and are accessible only to you and the conversation participants (and only for moderation when a participant reports a message, which shows the reported message to our review team).</p></section>
            <section><h2 className="text-white font-semibold mb-2">4. Your controls</h2>
              <p><b>Data export:</b> Settings → Data & privacy → Download my data gives you a machine-readable copy of your posts, comments, messages, and connections.</p>
              <p><b>Account deletion:</b> Settings → Data & privacy → Delete account permanently removes your account and content. Deactivation is also available if you want a temporary break.</p>
              <p><b>Visibility:</b> Private accounts restrict posts and stories to approved followers only.</p></section>
            <section><h2 className="text-white font-semibold mb-2">5. Security</h2>
              <p>Passwords are stored hashed. Sessions support two-factor authentication with backup codes. You can review every active session and login attempt in Settings → Security.</p></section>
            <section><h2 className="text-white font-semibold mb-2">6. Contact</h2>
              <p>Questions or requests about your data: use the in-app report system or contact the platform owner through the app.</p></section>
          </div>
        ) : (
          <div className="space-y-6 text-sm leading-relaxed">
            <section><h2 className="text-white font-semibold mb-2">1. Your account</h2>
              <p>You must provide accurate registration information and keep your credentials secure. You are responsible for activity on your account. Minimum age: 13 (or higher where required by local law).</p></section>
            <section><h2 className="text-white font-semibold mb-2">2. Acceptable use</h2>
              <p>You may not: harass or threaten others; post illegal content, nudity involving minors, or content promoting violence; spam or artificially inflate engagement; impersonate others; or attempt to access accounts or data that aren't yours.</p></section>
            <section><h2 className="text-white font-semibold mb-2">3. Your content</h2>
              <p>You own what you post. By posting, you grant Pixora the license needed to host, display, and distribute your content within the platform. You can delete your content at any time, which removes it from the platform.</p></section>
            <section><h2 className="text-white font-semibold mb-2">4. Moderation & enforcement</h2>
              <p>Content that violates these terms may be removed and accounts may be suspended or banned. Bans come with a review process: if you believe a ban is a mistake, you can request a review from the ban screen and the platform owner will decide the appeal.</p></section>
            <section><h2 className="text-white font-semibold mb-2">5. Payments</h2>
              <p>Tips, subscriptions, and marketplace purchases are between users. Platform fees and payment provider terms may apply. Digital purchases are as-is unless stated otherwise.</p></section>
            <section><h2 className="text-white font-semibold mb-2">6. Termination</h2>
              <p>You can stop using Pixora and delete your account at any time. We may suspend or ban accounts that violate these terms.</p></section>
            <section><h2 className="text-white font-semibold mb-2">7. Changes</h2>
              <p>We may update these terms; significant changes will be announced in-app. Continued use means acceptance.</p></section>
          </div>
        )}
      </div>
    </div>
  );
}
