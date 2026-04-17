// app.config.js — extends app.json with runtime env vars for expo-constants
// PostHog keys are injected at build time from .env via process.env

// eslint-disable-next-line @typescript-eslint/no-require-imports
const appJson = require('./app.json')

const plugins = appJson.expo.plugins ?? []
const hasSentryPlugin = plugins.some((plugin) =>
  Array.isArray(plugin) ? plugin[0] === '@sentry/react-native' : plugin === '@sentry/react-native'
)

/** @type {import('@expo/config').ExpoConfig} */
module.exports = {
  ...appJson.expo,
  plugins: hasSentryPlugin ? plugins : [...plugins, '@sentry/react-native'],
  extra: {
    ...appJson.expo.extra,
    posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
    posthogHost: process.env.POSTHOG_HOST,
  },
}
