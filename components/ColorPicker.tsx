import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface ColorPickerProps {
  options: string[];
  selected: string;
  onSelect: (color: string) => void;
}

export function ColorPicker({ options, selected, onSelect }: ColorPickerProps) {
  return (
    <View style={styles.row}>
      {options.map((color) => (
        <TouchableOpacity
          key={color}
          onPress={() => onSelect(color)}
          style={[
            styles.swatch,
            { backgroundColor: color },
            selected === color ? styles.swatchSelected : styles.swatchUnselected,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#007AFF',
  },
  swatchUnselected: {
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },
});
