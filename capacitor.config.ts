import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.tsport.fitness",
  appName: "Tsport 训练日记",
  webDir: "dist",
  android: { backgroundColor: "#f5f7f7" },
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_training", iconColor: "#174d3e" },
  },
};
export default config;
