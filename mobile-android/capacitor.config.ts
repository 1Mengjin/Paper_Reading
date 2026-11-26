import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.paperpocket.reader',
  appName: 'PaperPocket',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#f5efe2',
  },
}

export default config
