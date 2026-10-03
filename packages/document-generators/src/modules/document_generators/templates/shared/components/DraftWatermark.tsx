import { StyleSheet, Text, View } from '../../../providers/react-pdf'
import { documentTheme } from '../theme'

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: documentTheme.fontFamily,
    fontSize: 96,
    fontWeight: 'bold',
    color: documentTheme.colors.watermark,
    opacity: 0.5,
    transform: 'rotate(-35deg)',
  },
})

export function DraftWatermark({ label }: { label: string }) {
  return (
    <View style={styles.layer} fixed>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}
