import React, { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  APIKeysSection,
  FAQSection,
  InstallSection,
  LimitsSection,
  OverviewSection,
  ShareSection,
  TipsSection,
} from '@/components/guide/GuideSections';
import { useTheme } from '@/lib/theme';

const SECTIONS = [
  { id: 'overview', icon: '🏠', label: 'Overview' },
  { id: 'install',  icon: '📲', label: 'Install' },
  { id: 'share',    icon: '👥', label: 'Share' },
  { id: 'apikeys',  icon: '🔑', label: 'API Keys' },
  { id: 'tips',     icon: '✨', label: 'Tips' },
  { id: 'limits',   icon: '⚠️', label: 'Limits' },
  { id: 'faq',      icon: '❓', label: 'FAQ' },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

export default function GuideScreen() {
  const theme = useTheme();
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [search, setSearch] = useState('');

  function renderSection() {
    switch (activeSection) {
      case 'overview': return <OverviewSection theme={theme} onNavigate={setActiveSection} />;
      case 'install':  return <InstallSection theme={theme} />;
      case 'share':    return <ShareSection theme={theme} />;
      case 'apikeys':  return <APIKeysSection theme={theme} />;
      case 'tips':     return <TipsSection theme={theme} />;
      case 'limits':   return <LimitsSection theme={theme} />;
      case 'faq':      return <FAQSection theme={theme} />;
    }
  }

  function handleSearchSubmit() {
    if (!search.trim()) return;
    const q = search.toLowerCase();
    const match = SECTIONS.find(s => s.label.toLowerCase().includes(q) || s.id.includes(q));
    if (match) setActiveSection(match.id);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ fontSize: 34, fontWeight: '700', color: theme.label, letterSpacing: 0.3 }}>
          Guide
        </Text>
      </View>

      {/* Search bar */}
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <View
          style={{
            backgroundColor: theme.inputBackground,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.separator,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            height: 40,
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 14, color: theme.labelSecondary }}>🔍</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search the guide..."
            placeholderTextColor={theme.labelSecondary}
            style={{ flex: 1, fontSize: 14, color: theme.label }}
            autoCorrect={false}
            spellCheck={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={handleSearchSubmit}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ fontSize: 15, color: theme.labelSecondary }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Section tab pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, flexDirection: 'row' }}
        style={{ flexGrow: 0, marginBottom: 14 }}
      >
        {SECTIONS.map(section => {
          const active = activeSection === section.id;
          return (
            <TouchableOpacity
              key={section.id}
              onPress={() => setActiveSection(section.id)}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: active ? theme.primary : theme.surface,
                borderWidth: active ? 0 : 1,
                borderColor: theme.separator,
                shadowColor: active ? theme.primary : '#000',
                shadowOffset: { width: 0, height: active ? 2 : 1 },
                shadowOpacity: active ? 0.3 : 0.06,
                shadowRadius: active ? 6 : 3,
                elevation: active ? 4 : 1,
              }}
            >
              <Text style={{ fontSize: 13 }}>{section.icon}</Text>
              <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#FFFFFF' : theme.labelSecondary }}>
                {section.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 2 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderSection()}
      </ScrollView>
    </SafeAreaView>
  );
}
