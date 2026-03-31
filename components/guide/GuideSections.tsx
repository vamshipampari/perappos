import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { type Colors } from '@/lib/theme';
import {
  BulletRow,
  Callout,
  Card,
  CardTitle,
  CodeBlock,
  Divider,
  ExpandableCard,
  PromptBox,
  StepItem,
} from './GuideAtoms';

// ─── Overview ─────────────────────────────────────────────────────────────────

export function OverviewSection({
  theme,
  onNavigate,
}: {
  theme: Colors;
  onNavigate: (id: 'overview' | 'install' | 'share' | 'apikeys' | 'tips' | 'limits' | 'faq') => void;
}) {
  return (
    <>
      <View style={{ borderRadius: 20, padding: 20, marginBottom: 12, backgroundColor: theme.primary }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 6 }}>
          Welcome to Cottix
        </Text>
        <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.88)', lineHeight: 22 }}>
          Turn any web app into a real mobile app — no App Store, no backend required.
        </Text>
      </View>

      <Card theme={theme}>
        <CardTitle text="Three things Cottix gives you" icon="✦" theme={theme} />
        <BulletRow icon="📱" text="Your apps live on your homescreen like real native apps" theme={theme} />
        <BulletRow icon="💾" text="Data saves reliably and works offline" theme={theme} />
        <BulletRow icon="⚡" text="Share apps with your team — everyone sees the same live data" theme={theme} />
      </Card>

      <Card theme={theme}>
        <CardTitle text="How it works" icon="⚙" theme={theme} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 8 }}>
          {[
            { icon: '🤖', label: 'Build with\nAI' },
            { icon: '›', label: '' },
            { icon: '🔗', label: 'Paste\nthe link' },
            { icon: '›', label: '' },
            { icon: '📱', label: 'It becomes\nan app' },
          ].map((item, i) =>
            item.label === '' ? (
              <Text key={i} style={{ fontSize: 22, color: theme.labelTertiary }}>›</Text>
            ) : (
              <View key={i} style={{ alignItems: 'center', gap: 6 }}>
                <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 26 }}>{item.icon}</Text>
                </View>
                <Text style={{ fontSize: 11, color: theme.labelSecondary, textAlign: 'center', lineHeight: 15 }}>
                  {item.label}
                </Text>
              </View>
            )
          )}
        </View>
      </Card>

      <Card theme={theme}>
        <CardTitle text="Works great with" icon="✅" theme={theme} />
        <BulletRow icon="✅" text="Lovable — publish and paste the URL" theme={theme} color={theme.success} />
        <BulletRow icon="✅" text="Bolt.new — deploy and paste the URL" theme={theme} color={theme.success} />
        <BulletRow icon="✅" text="Claude Artifacts — export as HTML and upload" theme={theme} color={theme.success} />
        <BulletRow icon="✅" text="Vercel / Netlify deployments" theme={theme} color={theme.success} />
        <BulletRow icon="✅" text="Any publicly accessible website or web app" theme={theme} color={theme.success} />
      </Card>

      <Pressable
        onPress={() => onNavigate('install' as const)}
        style={({ pressed }) => ({
          backgroundColor: theme.primary,
          borderRadius: 14,
          padding: 16,
          alignItems: 'center',
          marginBottom: 4,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFF' }}>Install Your First App  →</Text>
      </Pressable>
    </>
  );
}

// ─── Install ──────────────────────────────────────────────────────────────────

export function InstallSection({ theme }: { theme: Colors }) {
  return (
    <>
      <Card theme={theme}>
        <CardTitle text="Install from a public URL" icon="🔗" theme={theme} />
        <Text style={{ fontSize: 13, color: theme.labelSecondary, marginBottom: 12, lineHeight: 18 }}>
          A "public URL" means anyone can open it in a browser without logging in.
        </Text>
        <StepItem number={1} text="Tap the + button on the home screen" theme={theme} />
        <StepItem number={2} text="Paste your app URL (e.g. myapp.netlify.app)" theme={theme} />
        <StepItem number={3} text="Give it a name, pick an icon, and tap Install" theme={theme} />
        <StepItem number={4} text="It appears on your home screen instantly" theme={theme} />
      </Card>

      <Card theme={theme} style={{ borderWidth: 2, borderColor: '#7C3AED' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 17 }}>✨</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.label }}>From a Claude Artifact</Text>
          <View style={{ backgroundColor: '#7C3AED', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>FASTEST</Text>
          </View>
        </View>
        <Text style={{ fontSize: 13, color: theme.labelSecondary, marginBottom: 12, lineHeight: 18 }}>
          Idea to app in under 60 seconds.
        </Text>
        <StepItem number={1} text="In Claude, build your app and open the artifact preview" theme={theme} />
        <StepItem number={2} text="Click ⋯ on the artifact → Download → saves as .html file" theme={theme} />
        <StepItem number={3} text='In Cottix → tap + → "Upload HTML File"' theme={theme} />
        <StepItem number={4} text="Select the downloaded file — done!" theme={theme} />
        <PromptBox
          text={`"Build me a [describe your app]. Use localStorage to save all data so it works offline. Make it mobile-responsive. Output as a single HTML file."`}
          theme={theme}
        />
      </Card>

      <ExpandableCard title="Publish from Lovable" icon="💜" preview="Get a shareable .lovable.app URL in 2 clicks" theme={theme}>
        <StepItem number={1} text="Open your project in Lovable" theme={theme} />
        <StepItem number={2} text='Click "Publish" in the top right corner' theme={theme} />
        <StepItem number={3} text="Copy the .lovable.app URL" theme={theme} />
        <StepItem number={4} text="Paste it in Cottix → Install" theme={theme} />
      </ExpandableCard>

      <ExpandableCard title="Deploy to Netlify" icon="🌐" preview="Get a stable URL you own — free, takes about 2 minutes" theme={theme}>
        <Text style={{ fontSize: 13, color: theme.labelSecondary, marginBottom: 12, lineHeight: 18 }}>
          Do this when you want a permanent URL, or when you need more control.
        </Text>
        <StepItem number={1} text="In Lovable → Export to GitHub (creates a repo)" theme={theme} />
        <StepItem number={2} text='Go to netlify.com → "Add new site" → "Import from GitHub"' theme={theme} />
        <StepItem number={3} text="Select your repo → Deploy (no settings needed for most apps)" theme={theme} />
        <StepItem number={4} text="Netlify gives you a yourapp.netlify.app URL" theme={theme} />
        <StepItem number={5} text="Paste that URL in Cottix → Install" theme={theme} />
        <Callout icon="💡" text="You get a stable URL that doesn't change, and you own the deployment." color={theme.primary} theme={theme} />
      </ExpandableCard>

      <ExpandableCard title="Deploy to Vercel" icon="▲" preview="Similar to Netlify — great for Next.js apps" theme={theme}>
        <StepItem number={1} text="Go to vercel.com → New Project → Import GitHub repo" theme={theme} />
        <StepItem number={2} text="Deploy → copy the .vercel.app URL" theme={theme} />
        <StepItem number={3} text="Paste it in Cottix → Install" theme={theme} />
      </ExpandableCard>

      <Card theme={theme} accentLeft="#F59E0B">
        <CardTitle text="My app requires login to use" icon="🔒" theme={theme} />
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22 }}>
          Cottix can still load it, but offline and collaboration features only apply to localStorage — not your app's own database.
        </Text>
      </Card>
    </>
  );
}

// ─── Share ────────────────────────────────────────────────────────────────────

export function ShareSection({ theme }: { theme: Colors }) {
  return (
    <>
      <Card theme={theme}>
        <CardTitle text="What is a Shared Instance?" icon="👥" theme={theme} />
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22, marginBottom: 12 }}>
          A live, shared copy of an app. Everyone in the group sees the same data. When one person adds something, everyone else sees it within seconds.
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.labelSecondary, marginBottom: 8 }}>Great for:</Text>
        <BulletRow icon="✅" text="Team expense trackers" theme={theme} />
        <BulletRow icon="✅" text="Shared habit or challenge apps" theme={theme} />
        <BulletRow icon="✅" text="Field team checklists" theme={theme} />
        <BulletRow icon="✅" text="Group inventory management" theme={theme} />
        <Callout icon="📌" text="Everyone needs Cottix installed. Sharing is about shared data — not sharing the app code." color={theme.labelSecondary} theme={theme} />
      </Card>

      <Card theme={theme}>
        <CardTitle text="Create a Shared Instance" icon="✦" theme={theme} />
        <StepItem number={1} text="Open the app you want to share on your home screen" theme={theme} />
        <StepItem number={2} text='Tap the ••• menu → "Share with Team"' theme={theme} />
        <StepItem number={3} text="A 6-character invite code is generated (e.g. XK72PQ)" theme={theme} />
        <StepItem number={4} text="Share that code via WhatsApp, SMS, or anywhere" theme={theme} />
        <StepItem number={5} text="Teammates enter the code in Cottix and everyone is in sync" theme={theme} />
        <Callout icon="💡" text="Creating shared instances requires a Pro or Beta plan." color={theme.primary} theme={theme} />
      </Card>

      <Card theme={theme}>
        <CardTitle text="Join a Shared Instance" icon="🔗" theme={theme} />
        <StepItem number={1} text="Get the 6-character invite code from the creator" theme={theme} />
        <StepItem number={2} text='In Cottix → tap + → "Join Shared App"' theme={theme} />
        <StepItem number={3} text="Enter the code" theme={theme} />
        <StepItem number={4} text="The app installs and loads with the shared data" theme={theme} />
        <Callout icon="✅" text="Joining is always free — only the creator needs a paid plan." color={theme.success} theme={theme} />
      </Card>

      <Card theme={theme}>
        <CardTitle text="How sync works" icon="🔄" theme={theme} />
        <BulletRow icon="⚡" text="Changes appear for everyone within a few seconds" theme={theme} />
        <BulletRow icon="📶" text="Works offline too — changes sync when you reconnect" theme={theme} />
        <BulletRow icon="🔄" text="The app briefly reloads when a teammate makes a change (known limitation — see Limits)" theme={theme} color={theme.labelSecondary} />
      </Card>
    </>
  );
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export function APIKeysSection({ theme }: { theme: Colors }) {
  return (
    <>
      <Card theme={theme}>
        <CardTitle text="Why use API Keys in Cottix?" icon="🔑" theme={theme} />
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22, marginBottom: 10 }}>
          If your app calls an external API (like OpenAI), the key is normally hardcoded in the app's code — visible to anyone who looks at the HTML.
        </Text>
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22 }}>
          Cottix solves this: store your key once in Settings, reference it as{' '}
          <Text style={{ fontFamily: 'monospace', color: theme.primary }}>{'{{openai_key}}'}</Text>
          {', '}and Cottix substitutes the real value at request time — it never appears in your app's code.
        </Text>
      </Card>

      <Card theme={theme}>
        <CardTitle text="Add an API Key" icon="➕" theme={theme} />
        <StepItem number={1} text="Go to Settings → API Keys" theme={theme} />
        <StepItem number={2} text='Tap "Add API Key"' theme={theme} />
        <StepItem number={3} text="Give it a name (e.g. openai_key) and paste the value" theme={theme} />
        <StepItem number={4} text="Tap Save — stored securely on your device" theme={theme} />
        <Callout icon="🔐" text="Keys use the same encryption as your phone's password manager. Never sent to Cottix's servers." color={theme.success} theme={theme} />
      </Card>

      <Card theme={theme}>
        <CardTitle text="Reference a Key in Your App" icon="💻" theme={theme} />
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 20, marginBottom: 4 }}>
          In your fetch headers, use the key name in double curly braces:
        </Text>
        <CodeBlock text={'Authorization: "Bearer {{openai_key}}"'} theme={theme} />
        <Text style={{ fontSize: 13, color: theme.labelSecondary, marginTop: 10, lineHeight: 18 }}>
          Cottix replaces the placeholder at request time. The actual key never reaches your WebView JavaScript.
        </Text>
      </Card>

      <Card theme={theme}>
        <CardTitle text="Building an AI-powered app?" icon="🤖" theme={theme} />
        <PromptBox
          text={`"Build me a [describe app]. Use VaultAPI.secrets.fetch() for any API calls, with {{my_api_key}} as the key placeholder. Use localStorage to save all data. Single HTML file, mobile-responsive."`}
          theme={theme}
        />
      </Card>
    </>
  );
}

// ─── Tips ─────────────────────────────────────────────────────────────────────

export function TipsSection({ theme }: { theme: Colors }) {
  return (
    <>
      <Card theme={theme}>
        <CardTitle text="Use localStorage — it just works" icon="💾" theme={theme} />
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22, marginBottom: 10 }}>
          Any app that saves data using localStorage automatically gets persistent, offline-capable storage in Cottix. No extra code needed.
        </Text>
        <Callout icon="💡" text={`Always ask your AI tool: "Use localStorage to save all data."`} color={theme.primary} theme={theme} />
      </Card>

      <Card theme={theme}>
        <CardTitle text="Build offline-first" icon="📶" theme={theme} />
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22 }}>
          The best Cottix apps work without internet. Design your app to read from localStorage first, then sync with any backend.
        </Text>
      </Card>

      <Card theme={theme}>
        <CardTitle text="Keep it single-file when possible" icon="📄" theme={theme} />
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22 }}>
          Apps that are a single HTML file install faster and work more reliably offline. Always ask your AI for "a single HTML file."
        </Text>
      </Card>

      <Card theme={theme}>
        <CardTitle text="What kinds of apps work best" icon="📊" theme={theme} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.success, marginBottom: 8, letterSpacing: 0.5 }}>GREAT FIT</Text>
        <BulletRow icon="✅" text="Personal trackers (habits, workouts, expenses)" theme={theme} color={theme.success} />
        <BulletRow icon="✅" text="Team checklists and field tools" theme={theme} color={theme.success} />
        <BulletRow icon="✅" text="Simple data entry forms and calculators" theme={theme} color={theme.success} />
        <BulletRow icon="✅" text="Offline-first reference utilities" theme={theme} color={theme.success} />
        <Divider theme={theme} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#D97706', marginBottom: 8, letterSpacing: 0.5 }}>WORKS WITH CAVEATS</Text>
        <BulletRow icon="⚠️" text="Apps that need user login (work, but limited offline/collab benefit)" theme={theme} color="#D97706" />
        <Divider theme={theme} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.destructive, marginBottom: 8, letterSpacing: 0.5 }}>NOT RECOMMENDED</Text>
        <BulletRow icon="❌" text="Apps that only work with a live backend (e.g. real-time chat on Firebase)" theme={theme} color={theme.destructive} />
      </Card>
    </>
  );
}

// ─── Limits ───────────────────────────────────────────────────────────────────

const LIMITS = [
  {
    title: 'Everyone in a shared session sees all data',
    detail: 'There is no per-user data separation yet. All members of a shared instance see all shared data. Per-user access control is on the roadmap.',
  },
  {
    title: 'Apps with their own backend get partial benefit',
    detail: "If your app talks to Supabase, Firebase, or any API for its data, Cottix's offline and collaboration features only apply to localStorage. Your app's backend data is unaffected.",
  },
  {
    title: 'Shared app reloads when a teammate edits',
    detail: 'When someone makes a change, the app briefly reloads to show the latest data. In-app navigation resets to the home screen of the mini-app. This is a known limitation being worked on.',
  },
  {
    title: 'URL install requires a public link',
    detail: 'Private or auth-gated apps cannot be installed by URL. Use the HTML upload method instead, or deploy to a public URL first.',
  },
  {
    title: 'No cross-platform discovery',
    detail: 'Invite codes work across iOS and Android, but there is no in-app discovery of shared apps outside your group.',
  },
  {
    title: 'App size limit',
    detail: 'Apps larger than ~10MB may not install correctly. Host large assets externally rather than embedding them.',
  },
];

export function LimitsSection({ theme }: { theme: Colors }) {
  return (
    <>
      <Card theme={theme} accentLeft="#F59E0B">
        <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22 }}>
          Cottix is growing fast. Here are the current limitations — we believe in being upfront rather than hiding them in fine print.
        </Text>
      </Card>
      {LIMITS.map((item, i) => (
        <ExpandableCard key={i} title={item.title} icon="⚠️" preview="Tap to learn more" theme={theme}>
          <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22 }}>{item.detail}</Text>
        </ExpandableCard>
      ))}
    </>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: '"My app installed but the data disappeared after I restarted"',
    a: "Check whether the app uses localStorage to save data. If it talks to its own database or API, Cottix cannot intercept that — the data lives on that server, not on your device.",
  },
  {
    q: '"The app looks different on mobile than on desktop"',
    a: "The app wasn't designed for mobile screens. Ask your AI tool to make it mobile-responsive, or ensure the HTML includes a proper viewport meta tag.",
  },
  {
    q: '"My teammate joined but sees different data"',
    a: "Make sure they joined via the invite code, not by installing fresh from the URL. URL installs create a personal copy — only invite code installs create a shared instance.",
  },
  {
    q: "\"Can I share an app with someone who doesn't have Cottix?\"",
    a: "Not yet — recipients need Cottix installed. A web preview link for non-Cottix users is on the roadmap.",
  },
  {
    q: '"My app stopped working after I updated it"',
    a: "The update replaces the app code but preserves your data. If something broke, use \"Revert to Previous Version\" in the app's ••• menu.",
  },
  {
    q: '"Do I need to pay to share apps?"',
    a: "Creating a shared instance requires a Pro or Beta plan. Joining is always free for teammates.",
  },
  {
    q: '"Is my data private?"',
    a: "Personal app data lives on your device. Shared instance data syncs through Cottix's servers to reach teammates, but is never accessible to anyone outside your invite group.",
  },
  {
    q: '"What happens if I delete Cottix?"',
    a: "Your installed mini-apps and all local data are deleted. There is no cloud backup for personal data yet.",
  },
];

export function FAQSection({ theme }: { theme: Colors }) {
  return (
    <>
      {FAQS.map((faq, i) => (
        <ExpandableCard key={i} title={faq.q} icon="❓" theme={theme}>
          <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22 }}>{faq.a}</Text>
        </ExpandableCard>
      ))}
    </>
  );
}
