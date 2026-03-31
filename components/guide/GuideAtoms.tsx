import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { type Colors } from '@/lib/theme';

export function Card({
  children,
  theme,
  accentLeft,
  style,
}: {
  children: React.ReactNode;
  theme: Colors;
  accentLeft?: string;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: 16,
          padding: 16,
          marginBottom: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.07,
          shadowRadius: 4,
          elevation: 2,
          borderLeftWidth: accentLeft ? 3 : 0,
          borderLeftColor: accentLeft ?? 'transparent',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CardTitle({ text, icon, theme }: { text: string; icon?: string; theme: Colors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
      {icon ? <Text style={{ fontSize: 17 }}>{icon}</Text> : null}
      <Text style={{ fontSize: 15, fontWeight: '700', color: theme.label, flex: 1 }}>{text}</Text>
    </View>
  );
}

export function StepItem({ number, text, theme }: { number: number; text: string; theme: Colors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: theme.primary,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
          flexShrink: 0,
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>{number}</Text>
      </View>
      <Text style={{ fontSize: 14, color: theme.label, lineHeight: 22, flex: 1 }}>{text}</Text>
    </View>
  );
}

export function BulletRow({
  icon,
  text,
  color,
  theme,
}: {
  icon: string;
  text: string;
  color?: string;
  theme: Colors;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
      <Text style={{ fontSize: 14, marginTop: 2 }}>{icon}</Text>
      <Text style={{ fontSize: 14, color: color ?? theme.label, lineHeight: 20, flex: 1 }}>{text}</Text>
    </View>
  );
}

export function Callout({
  icon,
  text,
  color,
  theme,
}: {
  icon: string;
  text: string;
  color: string;
  theme: Colors;
}) {
  return (
    <View
      style={{
        borderRadius: 10,
        padding: 10,
        marginTop: 10,
        backgroundColor: theme.inputBackground,
        borderLeftWidth: 3,
        borderLeftColor: color,
      }}
    >
      <Text style={{ fontSize: 13, color: theme.label, lineHeight: 18 }}>
        <Text style={{ color }}>{icon}{'  '}</Text>
        {text}
      </Text>
    </View>
  );
}

export function CodeBlock({ text, theme }: { text: string; theme: Colors }) {
  return (
    <View
      style={{
        backgroundColor: theme.inputBackground,
        borderRadius: 10,
        padding: 12,
        marginTop: 8,
        borderWidth: 1,
        borderColor: theme.separator,
      }}
    >
      <Text selectable style={{ fontSize: 13, fontFamily: 'monospace', color: theme.primary, lineHeight: 20 }}>
        {text}
      </Text>
    </View>
  );
}

export function PromptBox({ text, theme }: { text: string; theme: Colors }) {
  return (
    <View
      style={{
        backgroundColor: theme.inputBackground,
        borderRadius: 10,
        padding: 12,
        marginTop: 8,
        borderWidth: 1,
        borderColor: theme.separator,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.labelSecondary, marginBottom: 4 }}>
        Copy this prompt ↓
      </Text>
      <Text selectable style={{ fontSize: 13, color: theme.label, lineHeight: 20, fontStyle: 'italic' }}>
        {text}
      </Text>
    </View>
  );
}

export function Divider({ theme }: { theme: Colors }) {
  return <View style={{ height: 1, backgroundColor: theme.separator, marginVertical: 10 }} />;
}

export function ExpandableCard({
  title,
  icon,
  preview,
  children,
  theme,
  defaultOpen,
}: {
  title: string;
  icon: string;
  preview?: string;
  children: React.ReactNode;
  theme: Colors;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Card theme={theme}>
      <TouchableOpacity onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Text style={{ fontSize: 17 }}>{icon}</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: theme.label, flex: 1 }}>{title}</Text>
          </View>
          <Text style={{ fontSize: 20, color: theme.labelSecondary, lineHeight: 24 }}>{open ? '⌄' : '›'}</Text>
        </View>
        {!open && preview ? (
          <Text style={{ fontSize: 13, color: theme.labelSecondary, marginTop: 4, marginLeft: 25, lineHeight: 18 }}>
            {preview}
          </Text>
        ) : null}
      </TouchableOpacity>
      {open ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </Card>
  );
}
