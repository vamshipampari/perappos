{
"framework": "expo",
"version": "sdk-55",
"routing": "expo-router",
"architecture": "new",
"preferred_packages": [
"expo-sqlite",
"expo-notifications",
"expo-haptics",
"expo-file-system",
"expo-document-picker",
"expo-local-authentication",
"expo-sharing",
"react-native-webview",
"react-native-reanimated",
"nativewind"
],
"style": "nativewind (Tailwind for React Native)",
"state": "react context + expo-sqlite",
"testing": "manual on device via Expo Go or dev build",
"rules": [
"Always use expo-router for navigation (file-based routing in app/ directory)",
"Use expo-sqlite for ALL local storage, never AsyncStorage",
"Use expo-sqlite/kv-store for simple key-value needs",
"Use react-native-webview for loading mini-apps, never iframes",
"Use NativeWind for styling (className prop on RN components)",
"Use TypeScript for all files",
"Use functional components with hooks only",
"Target Android first, but keep iOS compatibility",
"Design: iOS-native aesthetic — white backgrounds, system font, subtle gray borders, #007AFF for primary blue",
"Never use expo-camera/legacy or expo-sqlite/legacy — use current APIs only",
"For animations use react-native-reanimated, not Animated API"
]
}
