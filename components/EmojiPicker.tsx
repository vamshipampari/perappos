import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface EmojiPickerProps {
  options: string[];
  selected: string;
  bgColor: string;
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ options, selected, bgColor, onSelect }: EmojiPickerProps) {
  return (
    <View style={styles.grid}>
      {options.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          onPress={() => onSelect(emoji)}
          style={[
            styles.cell,
            { backgroundColor: bgColor },
            selected === emoji && styles.cellSelected,
          ]}
        >
          <Text style={styles.char}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cellSelected: {
    borderColor: '#007AFF',
  },
  char: {
    fontSize: 24,
  },
});
